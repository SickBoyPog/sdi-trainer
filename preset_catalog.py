"""Discover self-contained combo folders without a shared manifest."""
from pathlib import Path
from urllib.parse import quote


def discover_presets(root: Path) -> dict:
    presets, errors, names = [], [], set()
    for folder in sorted(root.iterdir(), key=lambda p: p.name.casefold()):
        if not folder.is_dir():
            continue
        try:
            if folder.is_symlink():
                raise ValueError('linked folders are not supported')
            texts = sorted(folder.glob('*.txt'))
            if len(texts) != 1:
                raise ValueError('expected exactly one combo TXT')
            text = texts[0]
            if text.is_symlink():
                raise ValueError('linked TXT files are not supported')
            fields = {}
            for raw in text.read_text(encoding='utf-8-sig').splitlines():
                key, _, value = raw.strip().partition(' ')
                if key in ('name', 'video', 'order', 'di_frames'):
                    if key in fields:
                        raise ValueError(f'duplicate {key}')
                    fields[key] = value.strip()
            name, video = fields.get('name', ''), fields.get('video', '')
            if not name or not video:
                raise ValueError('missing name or video in TXT')
            if name == 'Diddy Kong Want Banana!' or name in names:
                raise ValueError('duplicate or reserved combo name')
            if '/' in video or '\\' in video or Path(video).suffix.lower() not in ('.mp4', '.webm', '.mov'):
                raise ValueError('video must be a local video filename')
            video_path = folder / video
            if not video_path.is_file() or video_path.is_symlink():
                raise ValueError('video file missing or linked')
            order = int(fields.get('order', '1000'))
            di_frames = [int(f) for f in fields.get('di_frames', '').split()]
            if any(f < 0 for f in di_frames):
                raise ValueError('DI frames cannot be negative')
            url = lambda p: 'presets/' + quote(folder.name, safe='') + '/' + quote(p.name, safe='')
            presets.append(dict(name=name, sequence=url(text), video=url(video_path), diFrames=di_frames, order=order))
            names.add(name)
        except (ValueError, OSError, UnicodeError) as exc:
            errors.append(f'{folder.name}: {exc}')
    presets.sort(key=lambda p: (p['order'], p['name'].casefold()))
    return dict(presets=presets, errors=errors)
