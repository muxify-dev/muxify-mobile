/**
 * A tmux command that failed.
 *
 * Its own module so that the Control Connection and the Client can both throw
 * it without importing each other.
 */
export class TmuxError extends Error {
  constructor(
    message: string,
    /** What tmux itself said, with no framing around it. */
    readonly detail: string = message,
  ) {
    super(message);
    this.name = 'TmuxError';
  }
}
