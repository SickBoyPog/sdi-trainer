# SDI simulation limitations

The goal is to match Ultimate’s SDI rules as closely as possible. The current simulation has the following accuracy limits.

## Stick zones and C-Stick SDI

- **Main-stick boundaries are approximate.** They were traced from explanatory video diagrams rather than independently verified against Ultimate. Inputs close to a boundary may register differently in the game.
- **C-Stick eligibility zones are also approximate.** Their shape follows the current model of how C-Stick inputs interact with the held main-stick direction. The exact activation, rearming and directional boundaries still need verification.
- Manual testing supports a C-Stick activation generating a refresh without first returning to neutral. That supports the mechanism, but does not verify every eligible angle, stick depth or buffered-input case.

Treat Active zones as a visual explanation of the current simulation, rather than a precise map of Ultimate’s physical stick boundaries.

## Controller input processing

- **GameCube:** the conversion uses nominal controller values. Differences between individual sticks, calibration and adapters can affect where physical positions fall relative to the simulated boundaries.
- **Pro Controller:** the conversion to simulated Ultimate values is provisional. Its input reader already applies calibration and scaling, so the Physical marker is not an untouched raw stick reading. Exact cardinal, diagonal and partial-stick agreement with Ultimate remains unverified.

## Input timing and buffering

The trainer models early C-Stick reactivation on release, or reactivation three frames after activation when held. A main-stick input buffered before C-Stick activation keeps priority. New main-stick entries during the delay can change the direction without shortening it. The normal four-frame SDI lockout still applies. Exact timing at some boundaries and C-Stick interactions remains unverified against Ultimate.

End-to-end responsiveness depends on the controller, adapter, browser and display. The trainer adds three frames (50 ms) of input delay by default. Use the same delay setting when comparing versions.

## Direction and movement

The white timeline arrow shows the combined direction of the accepted SDI inputs. Actual movement in Ultimate also depends on the move’s SDI multiplier, grounded restrictions, collisions, and ASDI.
