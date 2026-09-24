import type { Grid } from './tmux-client';

/** Just the resize of a Shell Channel, so this is testable without SSH. */
interface Resizable {
  resize(cols: number, rows: number): void;
}

/**
 * Tells the Shell Channel how big the Surface is, and tries to make it stick.
 *
 * `@osuki-dev/react-native-ssh` does not reliably deliver a window-change.
 * Measured with a scripted sequence — a resize every three seconds, alone,
 * with an outbound write, with inbound output, twice in a tick, four times in
 * a tick — the remote did not move once in eighteen seconds. The same call
 * made alongside the exec channel traffic of a tmux resize sometimes lands and
 * sometimes does not, which makes it a race rather than a rule.
 *
 * So this is best effort and nothing depends on it. A second call one row
 * shorter is what has the best chance of flushing the first, and one row
 * *shorter* specifically: a Client smaller than the Window makes tmux draw
 * less for an instant, where a Client larger makes it pad the difference with
 * dots. If the size lands, that is a bonus; the Window size, which goes over
 * the exec channel, is what the Surface actually depends on.
 *
 * The Rust core ships prebuilt in an xcframework, so this cannot be fixed at
 * source the way `expo-libghostty` was. It needs an upstream report.
 */
export function resizeShellChannel(shell: Resizable, grid: Grid): void {
  shell.resize(grid.cols, grid.rows);
  shell.resize(grid.cols, Math.max(1, grid.rows - 1));
}
