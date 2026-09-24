/**
 * The project's single test seam.
 *
 * Everything above this interface — command construction, output parsing,
 * topology reading — is pure logic driven in tests by a fake transport.
 * Everything below it is the SSH library, which is never unit-tested: asserting
 * that a mock was called proves nothing about whether bytes reach a terminal.
 * That half is verified by running the app.
 *
 * Deliberately narrow, and shaped to match what an SSH client already offers so
 * the adapter over the real library stays thin.
 */

export interface TmuxExecResult {
  stdout: string;
  stderr: string;
  /** -1 when the server closed the channel without reporting a status. */
  exitCode: number;
}

export interface TmuxShellOptions {
  term: string;
  cols: number;
  rows: number;
  /** The command the channel runs instead of a login shell. */
  command: string;
}

export interface TmuxShellEvents {
  /** Raw bytes from the remote side. */
  onData: (data: ArrayBuffer) => void;
  onClosed: (exitCode?: number) => void;
}

export interface TmuxShell {
  write(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): Promise<void>;
}

export interface TmuxTransport {
  /** Run one Control Command and collect its output. No stdin, never interactive. */
  exec(command: string): Promise<TmuxExecResult>;
  /** Open the PTY-backed Shell Channel that carries a Session. */
  openShell(options: TmuxShellOptions, events: TmuxShellEvents): Promise<TmuxShell>;
}
