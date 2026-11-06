// Trainer time is authoritative; displayed frame timestamps only measure/correct video drift.
export function syncDecision(errorSeconds, badSince, now) {
  const bad = Math.abs(errorSeconds) > 0.1;
  const since = bad ? (badSince ?? now) : null;
  return { badSince: since, interrupted: since !== null && now - since >= 250,
    rate: Math.abs(errorSeconds) <= 1 / 60 ? 1 : Math.max(.95, Math.min(1.05, 1 - errorSeconds * .5)) };
}

export class ComboVideo {
  constructor(video, onState, onInterrupt) {
    Object.assign(this, { video, onState, onInterrupt, state: 'empty', generation: 0, url: null, speed:1 });
  }
  setState(state, label) { this.state = state; this.onState(state, label); }
  cancel() {
    this.generation++;
    if (this.callback != null) this.video.cancelVideoFrameCallback(this.callback);
    this.callback = null;
    this.video.pause(); this.video.playbackRate = 1;
  }
  clear() {
    this.cancel();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.video.removeAttribute('src'); this.video.load();
    this.setState('empty', '');
  }
  async load(path) {
    this.clear(); const generation = this.generation;
    this.setState('loading', 'Preparing video…');
    try {
      if (!this.video.requestVideoFrameCallback) throw new Error('Update your browser to use combo video.');
      const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Could not load the preset video.');
      const blob = await response.blob();
      if (generation !== this.generation) return null;
      this.url = URL.createObjectURL(blob); this.video.src = this.url; this.video.load();
      await this.waitReady(generation);
      if (generation !== this.generation) return null;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration < 2 || duration > 60) throw new Error('Combo clips must be 2–60 seconds long.');
      this.setState('ready', 'Ready'); return duration;
    } catch (error) {
      if (generation === this.generation) this.setState('error', error.message);
      return null;
    }
  }
  waitReady(generation) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        if (generation !== this.generation) return reject(new Error('Cancelled'));
        if (this.video.error) return reject(new Error('This video could not be decoded.'));
        if (!this.video.seeking && this.video.readyState >= 3) return resolve();
        if (performance.now() - started > 10000) return reject(new Error('Video preparation timed out. Retry the preset.'));
        setTimeout(check, 25);
      }; check();
    });
  }
  async reset(label = 'Ready') {
    this.cancel(); const generation = this.generation;
    if (!this.url) return;
    this.setState('loading', 'Preparing video…'); this.video.currentTime = 0;
    try { await this.waitReady(generation); if (generation === this.generation) this.setState('ready', label); }
    catch (error) { if (generation === this.generation) this.setState('error', error.message); }
  }
  async seek(seconds,label='Ready') {
    this.cancel();const generation=this.generation;if(!this.url)return;
    this.setState('loading','Seeking…');this.video.currentTime=Math.max(0,Math.min(this.video.duration-.001,seconds));
    try{await this.waitReady(generation);if(generation===this.generation)this.setState('ready',label);}catch(error){if(generation===this.generation)this.setState('error',error.message);}
  }
  async start(onStart, speed = 1, { audio = true } = {}) {
    this.audioEnabled = audio;
    this.video.muted = !audio;
    this.speed=speed;
    // Pitch correction can suppress audio at very slow replay speeds.
    this.video.preservesPitch = speed >= .5;
    this.video.playbackRate=speed;
    this.lastRateChange = -Infinity;
    if (this.state !== 'ready') return;
    const generation = this.generation;
    this.setState('starting', 'Starting…');
    this.badSince = null; this.errorSeconds = 0;
    const timeout = setTimeout(() => { if (generation === this.generation && this.state === 'starting') this.interrupt('Video could not start. Retry.'); }, 3000);
    const frame = (now, metadata) => {
      if (generation !== this.generation) return;
      if (this.state === 'starting') {
        clearTimeout(timeout);
        this.origin = metadata.expectedDisplayTime - metadata.mediaTime * 1000 / this.speed;
        this.lastFrameAt = now;
        this.setState('playing', 'Playing'); onStart(this.origin);
      }
      if (this.state !== 'playing') return;
      this.lastFrameAt = now;
      this.errorSeconds = metadata.mediaTime - (metadata.expectedDisplayTime - this.origin) / 1000 * this.speed;
      const decision = syncDecision(this.errorSeconds, this.badSince, now);
      this.badSince = decision.badSince;
      if (decision.interrupted) return this.interrupt('Video lost sync. Run interrupted — retry.');
      // Avoid reconfiguring the audio renderer every displayed frame.
      // Frame timestamp jitter does not warrant a playback-rate change.
      if (!this.audioEnabled && now - this.lastRateChange >= 250) {
        const desired = Math.abs(this.errorSeconds) <= 2 / 60 ? this.speed : decision.rate * this.speed;
        if (Math.abs(this.video.playbackRate - desired) >= .005 * this.speed) {
          this.video.playbackRate = desired;
          this.lastRateChange = now;
        }
      }
      this.callback = this.video.requestVideoFrameCallback(frame);
    };
    this.callback = this.video.requestVideoFrameCallback(frame);
    try { await this.video.play(); }
    catch { clearTimeout(timeout); if (generation === this.generation) this.interrupt('Playback blocked. Click Start drill, then retry.'); }
  }
  tick(now) {
    if (this.state === 'playing' && this.video.ended && (now - this.origin) / 1000 * this.speed < this.video.duration - .1)
      return this.interrupt('Video ended early. Run interrupted — retry.');
    if (this.state === 'playing' && now - this.lastFrameAt > 250 / Math.min(1,this.speed) && !this.video.ended)
      this.interrupt('Video stalled. Run interrupted — retry.');
  }
  interrupt(message) { this.cancel(); this.setState('error', message); this.onInterrupt(message); }
}
