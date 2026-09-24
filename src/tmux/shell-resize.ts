import type { Grid } from './tmux-client';

/** Just the resize of a Shell Channel, so this is testable without SSH. */
interface Resizable {
  resize(cols: number, rows: number): void;
}

/**
 * Tells the Shell Channel how big the Surface is, twice.
 *
 * `@osuki-dev/react-native-ssh` does not send the size it is given. It sends
 * the one it was given *before*, and ignores a call that repeats the size it
 * already holds. Measured across a keyboard cycle, the remote is always
 * exactly one resize behind:
 *
 *     surface=38x32  client=38x34      (the size at attach)
 *     surface=38x16  client=38x32
 *     surface=38x32  client=38x16
 *
 * So a second call with a deliberately different size flushes the first, and
 * the remote ends up correct. One row shorter is the right dummy: a Client
 * smaller than the Window makes tmux draw less for an instant, where a Client
 * larger than the Window makes it pad the difference with dots — which is the
 * whole problem this exists to solve.
 *
 * Why it matters at all, given the Window is sized through tmux anyway: tmux
 * pads every row between the Window and the Client, and those rows are beyond
 * the Surface's grid, so the Surface scrolls to fit them and the terminal
 * fills with dots. A correct Client size is the only thing that stops it.
 *
 * The Rust core ships prebuilt in an xcframework, so this cannot be fixed at
 * source the way `expo-libghostty` was. It needs an upstream report.
 */
export function resizeShellChannel(shell: Resizable, grid: Grid): void {
  shell.resize(grid.cols, grid.rows);
  shell.resize(grid.cols, Math.max(1, grid.rows - 1));
}
