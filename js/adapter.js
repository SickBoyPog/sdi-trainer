export function parseAdapterReport(data, timestamp = performance.now()) {
  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength !== 37) throw new Error(`Unexpected adapter report length: ${bytes.byteLength}`);
  if (bytes[0] !== 0x21) throw new Error(`Unexpected adapter report type: 0x${bytes[0].toString(16)}`);
  const ports = [];
  for (let port = 0; port < 4; port += 1) {
    const offset = 1 + port * 9;
    const status = bytes[offset];
    const controllerType = status & 0x10 ? "wired" : status & 0x20 ? "wireless" : "none";
    ports.push({
      port: port + 1,
      connected: controllerType !== "none",
      controllerType,
      status,
      buttons1: bytes[offset + 1],
      buttons2: bytes[offset + 2],
      stickX: bytes[offset + 3],
      stickY: bytes[offset + 4],
      cStickX: bytes[offset + 5],
      cStickY: bytes[offset + 6],
      triggerL: bytes[offset + 7],
      triggerR: bytes[offset + 8],
    });
  }
  return { timestamp, ports };
}

export class AdapterConnectionError extends Error {
  constructor(stage, message, details = null) {
    super(message);
    this.name = "AdapterConnectionError";
    this.stage = stage;
    this.details = details;
  }
}

export class GCAdapterNativeBridge extends EventTarget {
  constructor() {
    super();
    this.reading = false;
    this.lastSequence = 0;
    this.initialSampleBatch = true;
    this.pollRate = 0;
    this.session = new AbortController();
    this.lastSampleAt = null;
    this.requestMs = 0;
  }

  async api(path, options = {}) {
    let response;
    const controller=new AbortController();
    const signal=options.signal;
    const abort=()=>controller.abort();
    if(signal?.aborted)abort();
    else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(),1500);
    try {
      response = await fetch(path, { cache: "no-store", ...options, signal:controller.signal });
      if (!response.ok) throw new Error(`Bridge HTTP error ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new AdapterConnectionError(
        "native bridge",
        "The native adapter bridge is not running. Close this page and launch Start-SDI-Trainer.cmd.",
        { cause: error?.message || String(error) },
      );
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }

  newSession() {
    this.session.abort();
    this.session = new AbortController();
    return this.session;
  }

  isCurrentSession(session) {
    return session === this.session && !session.signal.aborted;
  }

  // Cancellation must settle the wait, not just clear its timer.
  wait(milliseconds, signal) {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      signal.addEventListener('abort', finish, {once:true});
    });
  }

  async connect(kind="adapter") {
    if (this.reading) return;
    const session=this.newSession();
    try {
    this.emitStage("native bridge", "Starting native adapter connection…");
    await this.api(`/api/connect?kind=${encodeURIComponent(kind)}`, { method: "POST", signal:session.signal });
    if(!this.isCurrentSession(session))return;
    const deadline = performance.now() + 7000;
    let status;
    while (performance.now() < deadline) {
      status = await this.api("/api/status", {signal:session.signal});
      if(!this.isCurrentSession(session))return;
      this.emitStage(status.stage, status.message, status.device);
      if(!this.isCurrentSession(session))return;
      if (status.state === "connected") {
        this.reading = true;
        this.lastSequence = 0;
        this.initialSampleBatch = true;
        this.lastSampleAt = null;
        this.requestMs = 0;
        this.pollRate = status.pollRate || 0;
        this.dispatchEvent(new CustomEvent("status", {
          detail: { connected: true, label: status.device?.productName || "WUP-028", device: status.device },
        }));
        void this.pollSamples(session);
        return;
      }
      if (status.state === "error") throw new AdapterConnectionError(status.stage, status.message, status.device);
      await this.wait(100,session.signal);
      if(!this.isCurrentSession(session))return;
    }
    throw new AdapterConnectionError(status?.stage || "native USB", status?.message || "Timed out while connecting to the adapter.", status?.device);
    } catch(error) {
      if(this.isCurrentSession(session))throw error;
    }
  }

  async pollSamples(session=this.session) {
    const active=()=>this.reading&&this.isCurrentSession(session);
    let failures=0;
    while (active()) {
      try {
        const requestAt=performance.now();
        const payload = await this.api(`/api/samples?after=${this.lastSequence}`, {signal:session.signal});
        if(!active())return;
        const receivedAt=performance.now();
        this.requestMs=receivedAt-requestAt;
        failures=0;
        const batch = payload.samples || [];
        const samples = this.initialSampleBatch && batch.length ? batch.slice(-1) : batch;
        if(batch.length)this.initialSampleBatch=false;
        if (samples.length) {
          this.lastSampleAt=receivedAt;
          const latestBridgeTime = samples.at(-1).timestamp;
          for (const sample of samples) {
            if(!active())return;
            this.lastSequence = Math.max(this.lastSequence, sample.seq);
            const timestamp = receivedAt - (latestBridgeTime - sample.timestamp);
            this.dispatchEvent(new CustomEvent("sample", { detail: { timestamp, ports: sample.ports } }));
          }
        }
        if(!active())return;
        if (payload.status?.state === "error") {
          throw new AdapterConnectionError(payload.status.stage, payload.status.message, payload.status.device);
        }
        this.pollRate = payload.status?.pollRate || this.pollRate;
      } catch (error) {
        if(!active())return;
        failures+=1;
        if(error.stage === "native bridge" && failures<3){
          this.emitStage("poll retry", "Input request delayed; retrying…");
          await this.wait(40,session.signal);
          continue;
        }
        if (active()) {
          this.reading = false;
          this.dispatchEvent(new CustomEvent("error", { detail: error }));
        }
        return;
      }
      await this.wait(8,session.signal);
    }
  }

  async disconnect(reason = "Disconnected") {
    this.reading = false;
    const session=this.newSession();
    try { await this.api("/api/disconnect", { method: "POST", signal:session.signal }); } catch { /* Launcher may be closing. */ }
    if(this.isCurrentSession(session))this.dispatchEvent(new CustomEvent("status", { detail: { connected: false, label: reason } }));
  }

  emitStage(stage, message, device = null) {
    this.dispatchEvent(new CustomEvent("stage", { detail: { stage, message, device } }));
  }
}
