#!/usr/bin/env python3
"""Native USB bridge and local web server for Ultimate SDI Lab."""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import threading
import time
import urllib.parse
import webbrowser
from preset_catalog import discover_presets
from preset_save import PresetExists, save_preset
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parent
VID = 0x057E
PID = 0x0337


def parse_adapter_report(data: bytes, timestamp_ms: float) -> dict[str, Any]:
    if len(data) != 37:
        raise ValueError(f"Unexpected adapter report length: {len(data)}")
    if data[0] != 0x21:
        raise ValueError(f"Unexpected adapter report type: 0x{data[0]:02X}")
    ports = []
    for port in range(4):
        offset = 1 + port * 9
        status = data[offset]
        controller_type = "wired" if status & 0x10 else "wireless" if status & 0x20 else "none"
        ports.append({
            "port": port + 1,
            "connected": controller_type != "none",
            "controllerType": controller_type,
            "status": status,
            "buttons1": data[offset + 1],
            "buttons2": data[offset + 2],
            "stickX": data[offset + 3],
            "stickY": data[offset + 4],
            "cStickX": data[offset + 5],
            "cStickY": data[offset + 6],
            "triggerL": data[offset + 7],
            "triggerR": data[offset + 8],
        })
    return {"timestamp": timestamp_ms, "ports": ports}


class AdapterService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connect_requested = threading.Event()
        self._stop_requested = threading.Event()
        self._wake = threading.Event()
        self._samples: collections.deque[dict[str, Any]] = collections.deque(maxlen=2048)
        self._sample_times: collections.deque[float] = collections.deque(maxlen=100)
        self._sequence = 0
        self._status: dict[str, Any] = {
            "state": "idle",
            "stage": "waiting",
            "message": "Click Connect adapter in the trainer.",
            "device": None,
            "pollRate": 0,
        }
        self._device = None
        self._usb_util = None
        self._interface_number: int | None = None
        self._endpoint_in: int | None = None
        self._endpoint_out: int | None = None
        self._thread = threading.Thread(target=self._run, name="GC adapter reader", daemon=True)
        self._thread.start()

    def request_connect(self) -> None:
        with self._lock:
            if self._device is not None and self._connect_requested.is_set():
                self._status.update({"state": "connected", "stage": "reading", "message": "Native adapter connected."})
                return
            self._samples.clear()
            self._sample_times.clear()
            self._sequence = 0
            self._status.update({
                "state": "connecting",
                "stage": "device scan",
                "message": "Looking for WUP-028 (057E:0337)…",
                "pollRate": 0,
            })
        self._connect_requested.set()
        self._wake.set()

    def request_disconnect(self) -> None:
        self._connect_requested.clear()
        self._wake.set()
        self._close_device()
        self._set_status("idle", "waiting", "Adapter disconnected.", None)

    def stop(self) -> None:
        self._stop_requested.set()
        self._connect_requested.clear()
        self._wake.set()
        self._close_device()
        self._thread.join(timeout=2)

    def status(self) -> dict[str, Any]:
        with self._lock:
            return self._status_snapshot_locked()

    def samples_after(self, sequence: int) -> dict[str, Any]:
        with self._lock:
            samples = [sample for sample in self._samples if sample["seq"] > sequence]
            return {"samples": samples, "latestSequence": self._sequence, "status": self._status_snapshot_locked()}

    def _status_snapshot_locked(self) -> dict[str, Any]:
        result = dict(self._status)
        if len(self._sample_times) >= 2:
            elapsed = self._sample_times[-1] - self._sample_times[0]
            result["pollRate"] = round((len(self._sample_times) - 1) * 1000 / elapsed) if elapsed > 0 else 0
        return result

    def _set_status(self, state: str, stage: str, message: str, device: dict[str, Any] | None = None) -> None:
        with self._lock:
            self._status.update({"state": state, "stage": stage, "message": message, "device": device})

    def _run(self) -> None:
        while not self._stop_requested.is_set():
            if not self._connect_requested.is_set():
                self._wake.wait(0.25)
                self._wake.clear()
                continue
            try:
                self._open_device()
                self._read_reports()
            except Exception as error:
                if self._connect_requested.is_set():
                    stage = self.status().get("stage", "native USB")
                    self._set_status("error", stage, str(error), self._device_info())
                self._close_device()
                self._wake.wait(1.0)
                self._wake.clear()

    def _open_device(self) -> None:
        self._set_status("connecting", "native backend", "Loading PyUSB and libusb…")
        try:
            import libusb_package
            import usb.core
            import usb.util
        except ImportError as error:
            raise RuntimeError("Native dependencies are missing. Close the launcher and run Start-SDI-Trainer.cmd again.") from error

        self._usb_util = usb.util
        backend = libusb_package.get_libusb1_backend()
        if backend is None:
            raise RuntimeError("libusb-package did not provide a usable Windows libusb backend.")

        self._set_status("connecting", "device scan", "Looking for WUP-028 (057E:0337)…")
        device = usb.core.find(idVendor=VID, idProduct=PID, backend=backend)
        if device is None:
            raise RuntimeError("WUP-028 (057E:0337) was not found. Reconnect the adapter in Wii U mode.")
        self._device = device

        self._set_status("connecting", "configuration", "Reading the adapter configuration…", self._device_info())
        try:
            configuration = device.get_active_configuration()
        except Exception:
            device.set_configuration()
            configuration = device.get_active_configuration()

        selected_interface = None
        endpoint_in = None
        endpoint_out = None
        for interface in configuration:
            candidate_in = None
            candidate_out = None
            for endpoint in interface:
                direction = usb.util.endpoint_direction(endpoint.bEndpointAddress)
                if direction == usb.util.ENDPOINT_IN:
                    candidate_in = endpoint
                elif direction == usb.util.ENDPOINT_OUT:
                    candidate_out = endpoint
            if candidate_in is not None and candidate_out is not None:
                selected_interface = interface
                endpoint_in = candidate_in
                endpoint_out = candidate_out
                break
        if selected_interface is None or endpoint_in is None or endpoint_out is None:
            raise RuntimeError("The adapter has no native interface with both input and output endpoints.")

        self._interface_number = selected_interface.bInterfaceNumber
        self._endpoint_in = endpoint_in.bEndpointAddress
        self._endpoint_out = endpoint_out.bEndpointAddress
        self._set_status("connecting", "interface claim", f"Claiming native interface {self._interface_number}…", self._device_info())
        usb.util.claim_interface(device, self._interface_number)

        self._set_status("connecting", "initialization", "Sending native 0x13 initialization…", self._device_info())
        device.write(self._endpoint_out, bytes([0x13]), timeout=500)
        self._set_status("connected", "reading", "Native adapter connected.", self._device_info())

    def _read_reports(self) -> None:
        invalid_reports = 0
        while self._connect_requested.is_set() and not self._stop_requested.is_set():
            try:
                data = bytes(self._device.read(self._endpoint_in, 37, timeout=100))
            except Exception as error:
                if "timed out" in str(error).lower() or getattr(error, "errno", None) in {60, 110, 10060}:
                    continue
                raise
            timestamp = time.monotonic_ns() / 1_000_000
            try:
                report = parse_adapter_report(data, timestamp)
                invalid_reports = 0
            except ValueError:
                invalid_reports += 1
                if invalid_reports <= 30:
                    continue
                raise RuntimeError("The adapter did not provide valid native 37-byte reports after initialization.")

            with self._lock:
                self._sequence += 1
                report["seq"] = self._sequence
                self._samples.append(report)
                self._sample_times.append(timestamp)

    def _device_info(self) -> dict[str, Any] | None:
        if self._device is None:
            return None
        return {
            "productName": "WUP-028",
            "manufacturerName": "Nintendo-compatible",
            "vendorId": "057E",
            "productId": "0337",
            "interfaceNumber": self._interface_number,
            "endpointIn": self._endpoint_in,
            "endpointOut": self._endpoint_out,
            "transport": "native libusb",
        }

    def _close_device(self) -> None:
        device = self._device
        usb_util = self._usb_util
        interface_number = self._interface_number
        self._device = None
        self._interface_number = None
        self._endpoint_in = None
        self._endpoint_out = None
        if device is None or usb_util is None:
            return
        try:
            if interface_number is not None:
                usb_util.release_interface(device, interface_number)
        except Exception:
            pass
        try:
            usb_util.dispose_resources(device)
        except Exception:
            pass


class ControllerService:
    def __init__(self):
        from pro_controller import ProControllerService
        self.adapter=AdapterService()
        self.pro=ProControllerService()
        self.active=self.adapter

    def request_connect(self, kind='adapter'):
        target=self.pro if kind=='pro' else self.adapter
        if target is not self.active:
            self.active.request_disconnect()
            self.active=target
        self.active.request_connect()

    def request_disconnect(self):self.active.request_disconnect()
    def status(self):return self.active.status()
    def samples_after(self, sequence):return self.active.samples_after(sequence)
    def stop(self):
        self.adapter.stop()
        self.pro.stop()


class TrainerHandler(SimpleHTTPRequestHandler):
    server_version = "UltimateSDILab/1.2.13"

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    @property
    def adapter(self) -> AdapterService:
        return self.server.adapter  # type: ignore[attr-defined]

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/presets":
            self._json(discover_presets(ROOT / "presets"))
            return
        if parsed.path == "/api/status":
            self._json(self.adapter.status())
            return
        if parsed.path == "/api/samples":
            query = urllib.parse.parse_qs(parsed.query)
            try:
                after = int(query.get("after", ["0"])[0])
            except ValueError:
                after = 0
            self._json(self.adapter.samples_after(after))
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/presets":
            self._save_editor_preset()
            return
        if parsed.path == "/api/connect":
            self.adapter.request_connect(urllib.parse.parse_qs(parsed.query).get("kind", ["adapter"])[0])
            self._json(self.adapter.status(), 202)
            return
        if parsed.path == "/api/disconnect":
            self.adapter.request_disconnect()
            self._json(self.adapter.status())
            return
        self._json({"error": "Not found"}, 404)

    def _save_editor_preset(self) -> None:
        port = self.server.server_address[1]
        valid_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        host = self.headers.get("Host")
        if host not in valid_hosts or self.headers.get("Origin") != f"http://{host}":
            self._json({"error": "Open the trainer directly on its local address to save presets."}, 403)
            return
        if self.headers.get("Content-Type") != "application/octet-stream":
            self._json({"error": "Invalid preset upload."}, 415)
            return
        try:
            self.connection.settimeout(30)
            catalog = save_preset(ROOT / "presets", self.rfile, int(self.headers.get("Content-Length", "")),
                                  int(self.headers.get("X-Preset-Metadata-Length", "")))
        except PresetExists as error:
            self._json({"error": str(error)}, 409)
        except ValueError as error:
            self._json({"error": str(error)}, 400)
        except OSError:
            self._json({"error": "The local helper could not write the preset. Check disk space and try again."}, 500)
        else:
            self._json(catalog, 201)

    def log_message(self, fmt: str, *args: Any) -> None:
        if self.path.startswith("/api/"):
            return
        super().log_message(fmt, *args)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    adapter = ControllerService()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), TrainerHandler)
    server.adapter = adapter  # type: ignore[attr-defined]
    url = f"http://127.0.0.1:{args.port}/"
    print(f"\n  Ultimate SDI Lab v1.2.13 is running at {url}")
    print("  Keep this window open while training. Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        adapter.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
