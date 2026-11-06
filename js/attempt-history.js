import {fullHitCoverage} from './practice-range.js';

export function trimAttemptHistory(entries) {
  const counts = new Map();
  return entries.filter(entry => {
    const count = (counts.get(entry.preset) ?? 0) + 1;
    counts.set(entry.preset, count);
    return count <= 10;
  });
}

export function personalBestStorageKey(preset, recording = {}, defaults = {}) {
  if (preset !== 'Diddy Kong Want Banana!') return preset;
  const mode = recording.orbMode ?? defaults.mode;
  const timed = recording.orbTimed ?? defaults.timed;
  return `${preset}:${mode}:${timed ? 'timed' : 'untimed'}`;
}

export function eligibleForPersonalBest(entry, lastFrame) {
  if (entry.results.orb) return standardDwbSettings(entry.recording);
  const range = entry.recording.practiceRange ?? {start: 0, end: entry.drill.durationFrames};
  return fullHitCoverage(entry.drill, range) && lastFrame >= range.end - 1;
}

export function standardDwbSettings(recording = {}) {
  const burst = recording.orbMode === 'burst';
  if (!burst && recording.orbMode !== 'endurance') return false;
  if (recording.orbTimed !== true || recording.orbStandardSettings === false) return false;
  const defaults = {
    orbTimerFrames: burst ? 60 : 120, orbMinTimerFrames: burst ? 45 : 90,
    orbRampBananas: 15, orbSpawnDistance: burst ? 53 : 90, orbMovement: 'fixed',
  };
  if (Object.entries(defaults).some(([key,value]) => recording[key] !== value)) return false;
  if (burst && recording.orbBreakFrames !== 18) return false;
  const directions = recording.orbDirections;
  return recording.orbFixedDirections === false && recording.orbDirectionSlices === 16 &&
    Array.isArray(directions) && directions.length === 16 && new Set(directions).size === 16 &&
    directions.every(direction => Number.isInteger(direction) && direction >= 0 && direction < 16);
}

export function beatsPersonalBest(entry, previous) {
  if (!previous) return true;
  const result = entry.results, old = previous.results;
  if (result.orb) return result.orb.score > old.orb.score ||
    result.orb.score === old.orb.score && result.orb.survived > old.orb.survived;
  return result.acceptedCount > old.acceptedCount ||
    result.acceptedCount === old.acceptedCount && (
      entry.earlyStartCount < (previous.earlyStartCount ?? Infinity) ||
      entry.earlyStartCount === (previous.earlyStartCount ?? Infinity) && result.firstFrameCount > old.firstFrameCount
    );
}

/** Preserve the existing database, store and keys so saved attempts need no migration. */
export function createAttemptHistory(indexedDB = globalThis.indexedDB) {
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('sdi-attempt-history', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('history');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Storage can be unavailable; callers report failures without interrupting gameplay.
  database.catch(() => {});
  async function read(key) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const request = db.transaction('history').objectStore('history').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function write(key, value) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('history', 'readwrite');
      transaction.objectStore('history').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('History save aborted'));
    });
  }
  return {
    async load() {
      const [bests, attempts] = await Promise.all([read('bests'), read('attempts')]);
      return {bests: bests ?? {}, attempts: trimAttemptHistory(attempts ?? [])};
    },
    saveAttempts: entries => write('attempts', entries),
    saveBests: bests => write('bests', bests),
  };
}
