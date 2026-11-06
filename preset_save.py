"""Validate and publish a local Preset Editor upload."""
import json
import os
import re
import tempfile
import threading
from pathlib import Path

from preset_catalog import discover_presets

MAX_CLIP_BYTES = 250 * 1024 * 1024
MAX_METADATA_BYTES = 128 * 1024
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov'}
RESERVED_NAMES = {'Diddy Kong Want Banana!', 'Meta Knight Up-Airs', 'Steve Fair', 'SDI Endurance'}
WINDOWS_RESERVED = re.compile(r'^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)', re.I)
PUBLISH_LOCK = threading.Lock()


class PresetExists(ValueError):
    pass


def preset_files(metadata: dict) -> tuple[str, str, str]:
    name = metadata.get('name')
    if (not isinstance(name, str) or not 1 <= len(name) <= 64 or name != ' '.join(name.split())
            or name.endswith('.') or WINDOWS_RESERVED.match(name)
            or any(ch in '<>:"/\\|?*' or ord(ch) < 32 or ord(ch) == 127 for ch in name)):
        raise ValueError('Enter a name of 1–64 characters that can be used as a Windows folder name.')
    extension = metadata.get('extension')
    if not isinstance(extension, str) or extension not in VIDEO_EXTENSIONS:
        raise ValueError('Choose an MP4, WebM or MOV clip.')
    frames = metadata.get('frames')
    if type(frames) is not int or not 120 <= frames <= 3600:
        raise ValueError('Combo clips must be 2–60 seconds long.')

    windows = metadata.get('windows')
    if not isinstance(windows, list) or not windows or len(windows) > frames:
        raise ValueError('Add at least one hitlag window.')
    for window in windows:
        if (not isinstance(window, list) or len(window) != 2 or any(type(n) is not int for n in window)
                or window[0] < 0 or window[1] < 1 or sum(window) > frames):
            raise ValueError('Each hitlag window must fit within the clip.')
    windows = sorted(windows)
    if any(start + length > following[0] for (start, length), following in zip(windows, windows[1:])):
        raise ValueError('Hitlag windows cannot overlap.')

    di = metadata.get('diFrames')
    if not isinstance(di, list) or any(type(frame) is not int or not 0 <= frame < frames for frame in di):
        raise ValueError('Each DI marker must fit within the clip.')
    if len(set(di)) != len(di):
        raise ValueError('Only one DI marker is allowed per frame.')

    video = 'clip' + extension
    lines = ['SDI-LAB-SEQUENCE 3', f'name {name}', f'video {video}', 'fps 60', f'frames {frames}']
    if di:
        lines.append('di_frames ' + ' '.join(map(str, sorted(di))))
    lines.extend(f'window {start} {length} 180' for start, length in windows)
    return name, video, '\n'.join(lines) + '\n'


def save_preset(root: Path, source, content_length: int, metadata_length: int) -> dict:
    clip_size = content_length - metadata_length
    if not 0 < metadata_length <= MAX_METADATA_BYTES or not 0 < clip_size <= MAX_CLIP_BYTES:
        raise ValueError('Choose a clip no larger than 250 MB.')
    try:
        metadata = json.loads(source.read(metadata_length))
    except (UnicodeError, ValueError) as error:
        raise ValueError('The preset details could not be read.') from error
    if not isinstance(metadata, dict):
        raise ValueError('The preset details could not be read.')
    name, video, sequence = preset_files(metadata)
    header = source.read(min(32, clip_size))
    if video.endswith('.webm'):
        recognized = header.startswith(b'\x1a\x45\xdf\xa3')
    else:
        recognized = len(header) >= 12 and header[4:8] in (b'ftyp', b'moov', b'mdat', b'wide', b'free', b'skip')
    if not recognized:
        raise ValueError('The uploaded file does not match the selected video format.')

    # Publish both files together. Staging outside the catalog keeps interrupted uploads out of the list.
    with tempfile.TemporaryDirectory(prefix='.preset-upload-', dir=root.parent) as temp:
        staging = Path(temp) / 'preset'
        staging.mkdir()
        with (staging / video).open('wb') as target:
            target.write(header)
            remaining = clip_size - len(header)
            while remaining:
                chunk = source.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError('The clip upload did not finish.')
                target.write(chunk)
                remaining -= len(chunk)
        (staging / 'combo.txt').write_text(sequence, encoding='utf-8')
        with PUBLISH_LOCK:
            current = discover_presets(root)
            used_names = RESERVED_NAMES | {item['name'] for item in current['presets']}
            used_names.update(path.name for path in root.iterdir())
            if name.casefold() in {used.casefold() for used in used_names}:
                raise PresetExists('That preset name is already in use. Choose another name.')
            try:
                os.rename(staging, root / name)
            except FileExistsError as error:
                raise PresetExists('That preset name is already in use. Choose another name.') from error
            return discover_presets(root)

