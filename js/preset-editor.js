const FPS = 60;
const MAX_BYTES = 250 * 1024 * 1024;
const VIDEO_FILE = /\.(mp4|webm|mov)$/i;

export function createPresetEditor({canOpen, onModeChange, onSave}) {
  const get = id => document.getElementById('editor' + id);
  const toggle = document.getElementById('openPresetEditor');
  const video = get('Video'), drop = get('Drop'), picker = get('File'), scrub = get('Scrub');
  const annotations = get('Annotations'), markers = get('Markers'), playhead = get('Playhead');
  const form = get('Annotation'), start = get('Start'), length = get('Length');
  const saveDialog = get('SaveDialog'), nameField = get('Name');
  const help = get('Help'), helpWrap = get('HelpWrap'), helpText = get('HelpText');
  let active = false, saving = false, file = null, url = null, frames = 0, frame = 0;
  let windows = [], diMarkers = [], selected = null, pendingHit = null;
  let callback, pictureTime = null, targetTime = null;
  let helpPinned = false, helpDismissed = false;

  function message(text, error = false) {
    get('Status').textContent = text;
    get('Status').classList.toggle('editor-error', error);
  }

  function updateAvailability() {
    const disabled = active || !canOpen();
    if (toggle.disabled !== disabled) toggle.disabled = disabled;
  }

  function showHelp() {
    const open = !helpDismissed && (helpPinned || helpWrap.matches(':hover, :focus-within'));
    helpText.hidden = !open;
    help.setAttribute('aria-expanded', String(open));
  }

  helpWrap.addEventListener('pointerenter', () => { helpDismissed = false; showHelp(); });
  helpWrap.addEventListener('pointerleave', () => {
    if (!helpPinned && !helpText.contains(document.activeElement)) helpDismissed = true;
    showHelp();
  });
  helpWrap.addEventListener('focusin', () => { helpDismissed = false; showHelp(); });
  helpWrap.addEventListener('focusout', event => {
    if (!helpWrap.contains(event.relatedTarget)) {
      helpPinned = false;
      helpDismissed = !helpWrap.matches(':hover');
      helpText.hidden = helpDismissed;
      help.setAttribute('aria-expanded', String(!helpDismissed));
    }
  });
  help.onclick = () => {
    helpPinned = !helpPinned;
    helpDismissed = !helpPinned;
    showHelp();
  };
  document.addEventListener('pointerdown', event => {
    if (!active || helpText.hidden || helpWrap.contains(event.target)) return;
    helpPinned = false;
    helpDismissed = true;
    showHelp();
  });

  function close() {
    active = false;
    document.body.classList.remove('preset-editor-active');
    for (const id of ['Clip', 'Controls', 'Timeline']) get(id).hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
    get('Close').hidden = true;
    helpPinned = false;
    helpDismissed = true;
    showHelp();
    clearClip();
    onModeChange(false);
    updateAvailability();
    toggle.focus();
  }

  toggle.onclick = () => {
    if (active || !canOpen()) return;
    active = true;
    document.body.classList.add('preset-editor-active');
    for (const id of ['Clip', 'Controls', 'Timeline']) get(id).hidden = false;
    toggle.setAttribute('aria-pressed', 'true');
    get('Close').hidden = false;
    onModeChange(true);
    updateAvailability();
    message('Choose a clip to begin.');
    get('Choose').focus();
  };
  get('Close').onclick = close;

  function clearClip() {
    if (callback != null) video.cancelVideoFrameCallback(callback);
    callback = null;
    video.removeAttribute('src');
    video.load();
    if (url) URL.revokeObjectURL(url);
    url = file = null;
    frames = frame = 0;
    pictureTime = targetTime = null;
    windows = [];
    diMarkers = [];
    selected = pendingHit = null;
    video.hidden = true;
    get('DropPrompt').hidden = false;
    get('FileName').textContent = '';
    form.hidden = true;
    renderAnnotations();
    renderTicks();
    renderFrame();
  }

  function loadClip(candidate) {
    if (!candidate || !VIDEO_FILE.test(candidate.name) || !candidate.size || candidate.size > MAX_BYTES) {
      message('Choose a nonempty MP4, WebM or MOV clip up to 250 MB.', true);
      return;
    }
    if (!video.requestVideoFrameCallback) {
      message('Update your browser to use frame stepping.', true);
      return;
    }
    if ((windows.length || diMarkers.length || pendingHit) && !confirm('Replace this clip and clear its annotations?')) return;
    clearClip();
    file = candidate;
    url = URL.createObjectURL(file);
    get('FileName').textContent = file.name;
    video.hidden = false;
    get('DropPrompt').hidden = true;
    message('Opening clip…');
    video.src = url;
    const presented = (_, metadata) => {
      pictureTime = metadata.mediaTime;
      updatePicture();
      callback = video.requestVideoFrameCallback(presented);
    };
    callback = video.requestVideoFrameCallback(presented);
  }

  function clipError(text) {
    clearClip();
    message(text, true);
  }

  video.addEventListener('loadeddata', () => {
    if (!url || frames || video.currentSrc !== url) return;
    if (!Number.isFinite(video.duration) || video.duration < 2 || video.duration > 60 || !video.videoWidth) {
      clipError('Choose a playable video clip between 2 and 60 seconds long.');
      return;
    }
    frames = Math.round(video.duration * FPS);
    scrub.max = frames - 1;
    renderTicks();
    renderAnnotations();
    selectFrame(0);
    message('Find the impact frame, then step forward once to add a hitlag window.');
  });
  video.addEventListener('error', () => {
    if (url && video.error) clipError('This clip could not be decoded. Try another MP4, WebM or MOV.');
  });

  get('Choose').onclick = () => picker.click();
  picker.onchange = () => { loadClip(picker.files[0]); picker.value = ''; };
  drop.ondragover = event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    drop.classList.add('editor-drag-over');
  };
  drop.ondragleave = event => {
    if (!drop.contains(event.relatedTarget)) drop.classList.remove('editor-drag-over');
  };
  drop.ondrop = event => {
    event.preventDefault();
    drop.classList.remove('editor-drag-over');
    if (event.dataTransfer.files.length !== 1) message('Drop one video clip at a time.', true);
    else loadClip(event.dataTransfer.files[0]);
  };

  function updatePicture() {
    const picture = get('Picture');
    if (!frames) picture.textContent = '';
    else if (video.seeking || targetTime !== timeForFrame() || pictureTime === null || pictureTime > targetTime + .001) {
      picture.textContent = 'Seeking…';
    } else {
      picture.textContent = `Video picture at ${pictureTime.toFixed(3)} s`;
    }
  }

  // Sample inside each trainer tick to avoid landing on a rounded media timestamp.
  const timeForFrame = () => Math.min((frame + .5) / FPS, video.duration - .001);
  function seekLatest() {
    if (!frames || video.seeking) return;
    const time = timeForFrame();
    if (targetTime !== time) {
      targetTime = time;
      video.currentTime = time;
    }
    updatePicture();
  }
  video.addEventListener('seeked', seekLatest);

  function selectFrame(next) {
    if (!frames) return;
    frame = Math.max(0, Math.min(frames - 1, next));
    seekLatest();
    renderFrame();
  }

  function renderFrame() {
    scrub.disabled = !frames;
    scrub.value = frame;
    get('Prev').disabled = !frames || frame === 0;
    get('Next').disabled = !frames || frame === frames - 1;
    get('Frame').textContent = frames ? `Frame ${frame} / ${frames - 1}` : 'No clip loaded';
    scrub.setAttribute('aria-valuetext', get('Frame').textContent);
    playhead.hidden = !frames;
    if (frames) playhead.style.left = position(frame + .5);
    updatePicture();
  }

  const position = value => `${100 * value / frames}%`;
  get('Prev').onclick = () => selectFrame(frame - 1);
  get('Next').onclick = () => selectFrame(frame + 1);
  scrub.oninput = () => selectFrame(Number(scrub.value));
  get('Track').addEventListener('pointerdown', event => {
    if (!frames || event.button !== 0 || event.target.closest('button')) return;
    const track = event.currentTarget;
    track.setPointerCapture(event.pointerId);
    scrubAt(event);
  });
  get('Track').addEventListener('pointermove', event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubAt(event);
  });
  function scrubAt(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    selectFrame(Math.floor((event.clientX - rect.left) / rect.width * frames));
  }

  document.addEventListener('keydown', event => {
    if (!active || saveDialog.open || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && !helpText.hidden) {
      helpPinned = false;
      if (helpText.contains(document.activeElement)) help.focus();
      helpDismissed = true;
      showHelp();
      event.preventDefault();
    } else if (frames && !event.altKey && !event.ctrlKey && !event.metaKey &&
        !event.target.closest('input, select, textarea, a, #editorHelp') &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      selectFrame(frame + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });

  function renderTicks() {
    get('Ticks').replaceChildren();
    if (!frames) return;
    const interval = frames <= 15 * FPS ? FPS : frames <= 30 * FPS ? 2 * FPS : 5 * FPS;
    for (let tick = 0; tick < frames; tick += interval) {
      const label = document.createElement('span');
      label.style.left = position(tick);
      label.textContent = `${tick / FPS}s`;
      get('Ticks').append(label);
    }
  }

  const isHit = annotation => 'length' in annotation;
  function renderAnnotations() {
    const sorted = [...windows, ...diMarkers].sort((a, b) => a.start - b.start);
    annotations.replaceChildren(new Option(sorted.length ? 'Choose an annotation…' : 'No annotations', ''));
    const buttons = [];
    sorted.forEach((annotation, index) => {
      const hit = isHit(annotation);
      const label = hit ? `Hitlag ${annotation.start}–${annotation.start + annotation.length - 1}` : `DI at ${annotation.start}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = hit ? 'editor-hit-marker' : 'editor-di-marker';
      button.style.left = position(annotation.start + (hit ? 0 : .5));
      if (hit) button.style.width = position(annotation.length);
      else button.textContent = '↓ DI';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(selected === annotation));
      button.onclick = () => {
        selectAnnotation(annotation);
        markers.children[index].focus({preventScroll: true});
      };
      buttons.push(button);
      annotations.add(new Option(label, String(index)));
      if (annotation === selected) annotations.value = String(index);
    });
    markers.replaceChildren(...buttons);
    annotations.disabled = !sorted.length;
    annotations.onchange = () => selectAnnotation(annotations.value === '' ? null : sorted[Number(annotations.value)]);
    get('AddHit').disabled = get('AddDI').disabled = !frames;
    get('Save').disabled = !windows.length;
  }

  function editAnnotation(annotation, adding = false) {
    const hit = isHit(annotation);
    form.hidden = false;
    get('AnnotationTitle').textContent = hit ? (adding ? 'New hitlag window' : 'Hitlag window') : 'DI marker';
    get('StartLabel').textContent = hit ? 'Start frame' : 'Frame';
    start.value = annotation.start;
    start.max = frames - 1;
    start.readOnly = adding;
    get('LengthLabel').hidden = get('EndLabel').hidden = !hit;
    length.disabled = !hit;
    length.value = hit ? annotation.length : '';
    length.max = frames;
    get('Apply').textContent = adding ? 'Add window' : 'Apply';
    get('Remove').textContent = adding ? 'Discard window' : 'Delete';
    showEndFrame();
  }

  function selectAnnotation(annotation) {
    pendingHit = null;
    selected = annotation;
    form.hidden = !annotation;
    if (annotation) {
      editAnnotation(annotation);
      selectFrame(annotation.start);
    }
    renderAnnotations();
    message(annotation ? 'Edit by one frame with the field arrows. Press Enter to apply.' : '');
  }

  function showEndFrame() {
    const end = start.valueAsNumber + length.valueAsNumber - 1;
    get('End').textContent = Number.isInteger(end) && end >= start.valueAsNumber ? String(end) : '—';
  }
  start.oninput = length.oninput = showEndFrame;

  get('AddHit').onclick = () => {
    if (windows.some(hit => frame >= hit.start && frame < hit.start + hit.length)) {
      message('The selected frame is already inside a hitlag window.', true);
      return;
    }
    selected = null;
    pendingHit = {start: frame, length: 1};
    editAnnotation(pendingHit, true);
    renderAnnotations();
    message('Enter the full hitlag length and press Enter.');
    length.focus();
    length.select();
  };

  get('AddDI').onclick = () => {
    let marker = diMarkers.find(item => item.start === frame);
    if (!marker) {
      marker = {start: frame};
      diMarkers.push(marker);
    }
    selectAnnotation(marker);
    start.focus();
  };

  form.onsubmit = event => {
    event.preventDefault();
    const annotation = pendingHit ?? selected;
    const hit = isHit(annotation), first = start.valueAsNumber, count = hit ? length.valueAsNumber : 1;
    if (first < 0 || count < 1 || first + count > frames) {
      message('The annotation must fit within the clip.', true);
      return;
    }
    if (hit && windows.some(other => other !== annotation && first < other.start + other.length && first + count > other.start)) {
      message('Hitlag windows cannot overlap.', true);
      return;
    }
    if (!hit && diMarkers.some(other => other !== annotation && first === other.start)) {
      message('That frame already has a DI marker.', true);
      return;
    }
    const moved = !pendingHit && first !== annotation.start;
    annotation.start = first;
    if (hit) annotation.length = count;
    if (pendingHit) windows.push(annotation);
    pendingHit = null;
    selected = annotation;
    editAnnotation(annotation);
    renderAnnotations();
    if (moved) selectFrame(first);
    message(hit ? 'Hitlag window saved to draft.' : 'DI marker saved to draft.');
  };

  get('Remove').onclick = () => {
    windows = windows.filter(hit => hit !== selected);
    diMarkers = diMarkers.filter(marker => marker !== selected);
    selectAnnotation(null);
    get('AddHit').focus();
  };

  get('Save').onclick = () => {
    if (pendingHit || (selected && (start.valueAsNumber !== selected.start ||
        (isHit(selected) && length.valueAsNumber !== selected.length)))) {
      message('Apply or discard the annotation changes before saving.', true);
      return;
    }
    get('SaveStatus').textContent = '';
    saveDialog.showModal();
  };
  get('SaveBack').onclick = () => saveDialog.close();
  saveDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  get('SaveForm').onsubmit = async event => {
    event.preventDefault();
    if (saving || !file || !frames || !windows.length) return;
    const name = nameField.value.trim().replace(/\s+/g, ' ');
    const metadata = JSON.stringify({
      name, extension: '.' + file.name.match(VIDEO_FILE)[1].toLowerCase(), frames,
      windows: windows.map(hit => [hit.start, hit.length]), diFrames: diMarkers.map(marker => marker.start),
    });
    const details = new Blob([metadata]);
    saving = true;
    nameField.disabled = get('SaveConfirm').disabled = get('SaveBack').disabled = true;
    get('SaveStatus').textContent = 'Saving preset…';
    let catalog;
    try {
      const response = await fetch('/api/presets', {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream', 'X-Preset-Metadata-Length': details.size},
        body: new Blob([details, file]),
      });
      catalog = await response.json();
      if (!response.ok) throw new Error(catalog.error ?? 'The local helper could not save this preset.');
    } catch (error) {
      get('SaveStatus').textContent = error instanceof SyntaxError || error instanceof TypeError
        ? 'The local helper did not respond. Check that the trainer is running and try again.' : error.message;
      return;
    } finally {
      saving = false;
      nameField.disabled = get('SaveConfirm').disabled = get('SaveBack').disabled = false;
    }
    saveDialog.close();
    nameField.value = '';
    close();
    onSave(catalog, name);
  };

  return {get active() { return active; }, updateAvailability};
}
