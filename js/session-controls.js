/** Button decisions only: gameplay clocks and recording remain owned by app.js. */
export function sessionControlsFor(state) {
  const {running, starting, replaying, replayPreparing, replayPaused, recorded, afterAttemptAction, isDwb, presetLoading, hasVideo, videoReady} = state;
  const busy = running || starting || replayPreparing;
  const pendingVideo = hasVideo && !videoReady && !replaying;
  const retry = recorded && afterAttemptAction === 'retry' && !replayPaused;
  const phase = replayPreparing ? 'preparingReplay' : starting ? 'starting' : running ? 'live' : replaying ? 'replay' : recorded ? 'recorded' : isDwb ? 'warmup' : 'ready';
  return {
    phase,
    primary: {
      label: replaying ? 'Pause' : recorded ? (replayPaused ? 'Resume' : retry ? 'Retry' : 'Replay') : 'Start',
      disabled: !!(busy || presetLoading || pendingVideo || (isDwb && !recorded)),
      action: replaying ? 'pauseReplay' : recorded ? (retry ? 'startRun' : 'startReplay') : isDwb ? null : 'startRun',
    },
    secondary: {
      label: recorded && !busy && !replaying ? 'Clear' : 'Stop',
      disabled: !(busy || replaying || recorded),
      action: replaying || replayPreparing ? 'stopReplayAtStart' : 'stopRun',
    },
    replayLabel: replaying ? 'Pause' : 'Replay',
  };
}

export function createSessionControls({getState, actions, buttons}) {
  function invoke(side) {
    const control = sessionControlsFor(getState())[side];
    if (!control.disabled && control.action) return actions[control.action]();
  }
  function update() {
    const state = sessionControlsFor(getState());
    for (const [side, button] of [['primary', buttons.start], ['secondary', buttons.stop]]) {
      if (button.textContent !== state[side].label) button.textContent = state[side].label;
      button.disabled = state[side].disabled;
    }
    buttons.stop.hidden = false;
    if (buttons.replay.textContent !== state.replayLabel) buttons.replay.textContent = state.replayLabel;
  }
  return {primary: () => invoke('primary'), secondary: () => invoke('secondary'), update};
}
