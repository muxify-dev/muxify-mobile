/**
 * What went wrong, in one line, for a user who is looking at a terminal.
 *
 * Both halves of the stack throw things worth reading: the SSH library tags
 * its failures with a `code` that says which problem it is, and tmux answers
 * in its own words. Keeping the code where there is one is the difference
 * between "AUTH_FAILED — …" and a sentence that could mean anything.
 *
 * For the quiet trouble line, not for a phase: classifying an ending into
 * something the reconnect policy can act on is `disconnect-reason.ts`.
 */
export function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    const message = error instanceof Error ? error.message : String(error);
    return code ? `${String(code)} — ${message}` : message;
  }
  return error instanceof Error ? error.message : String(error);
}
