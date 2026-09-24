/**
 * The project's single test seam.
 *
 * Everything above this interface — command construction, protocol parsing,
 * topology — is pure logic driven in tests by a fake transport. Everything
 * below it is the SSH library, which is never unit-tested: asserting that a
 * mock was called proves nothing about whether bytes reach a terminal. That
 * half is verified by running the app.
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

export interface ControlChannelEvents {
  /** Raw bytes from the remote side, mid-line as often as not. */
  onData: (data: ArrayBuffer) => void;
  onClosed: (exitCode?: number) => void;
}

export interface ControlChannel {
  write(bytes: Uint8Array): void;
  /**
   * Whether the channel is still there.
   *
   * The one question this seam gained for the lifecycle policy. iOS suspends
   * an app without telling it whether its socket survived, so a Surface that
   * looks connected on the way back may be talking to nothing — and the only
   * honest way to find out is to ask the thing underneath. The SSH adapter
   * answers from the library's own connected and open flags; the local one
   * from whether the child process is alive. Neither sends anything.
   */
  isOpen(): boolean;
  close(): Promise<void>;
}

export interface TmuxTransport {
  /**
   * Runs one command on its own channel and collects its output.
   *
   * Only for the screens above the terminal, which have no Session to attach
   * to and so no Control Connection to ask: listing a Host's Sessions, and
   * making one. Everything after Attach goes down the Control Connection.
   */
  exec(command: string): Promise<TmuxExecResult>;

  /**
   * Opens the channel that carries a Control Connection.
   *
   * **No PTY.** The channel runs `tmux -C attach`, which needs no terminal —
   * and that is the whole point: a control client sets no Session option, so
   * there is nothing to borrow and nothing to give back. See ADR 0006.
   */
  openControl(command: string, events: ControlChannelEvents): Promise<ControlChannel>;
}
