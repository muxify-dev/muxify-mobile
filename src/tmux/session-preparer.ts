/**
 * The slice of TmuxClient needed to make a Session presentable. Narrow on
 * purpose: this is the whole of what taking over a Session involves, and
 * keeping it small keeps that visible.
 */
export interface SessionChrome {
  readStatusLine(sessionName: string): Promise<string | undefined>;
  setStatusLine(sessionName: string, value: string): Promise<void>;
  readWindowSizing(sessionName: string): Promise<string | undefined>;
  setWindowSizing(sessionName: string, value: string): Promise<void>;
  redrawClient(clientTty?: string): Promise<void>;
}

export interface SessionPreparer {
  /** Makes a Session fit to show on the Surface. */
  prepare(sessionName: string, clientTty?: string): Promise<void>;
  /** Puts every Session this has changed back the way it was found. */
  restoreAll(): Promise<void>;
}

/** The Session options Muxify borrows, as they were found. */
interface Borrowed {
  /** Undefined means tmux would not say, so there is nothing to put back. */
  statusLine: string | undefined;
  windowSizing: string | undefined;
}

/**
 * Takes a Session over for the Surface, and gives it back afterwards.
 *
 * A Session is not ready to be shown on a phone as found. Two session options
 * are in the way:
 *
 * - `status`, a status line duplicating what the Dock already shows, on a
 *   screen with no rows to spare.
 * - `window-size`, which by default lets the Window grow past the Surface —
 *   and tmux pads every row of the difference with dots. `smallest` keeps the
 *   Window no bigger than the smallest attached Client, so the padding has
 *   nothing to fill. See readWindowSizingCommand.
 *
 * Both are session options, so both are visible to every other Client and
 * outlive the Connection — the price of attaching a real client rather than
 * using control mode, see ADR 0001. Hence the borrowing: read first, put back
 * on teardown.
 *
 * Sizing the Window itself is deliberately not here, and is now nobody's job:
 * with `window-size smallest` the Window follows the Client, and the Client's
 * pty is the one thing the resize scheduler sets.
 *
 * This exists because Attaching is not the only time it has to happen.
 * Switching Session lands on a Session nobody has prepared, so the same work
 * runs again — and every Session touched along the way has to be handed back
 * on teardown, not just the last one.
 */
export function createSessionPreparer(chrome: SessionChrome): SessionPreparer {
  /** Session name to the options it had before Muxify touched it. */
  const borrowed = new Map<string, Borrowed>();

  return {
    async prepare(sessionName: string, clientTty?: string): Promise<void> {
      // Read before changing anything, and only once: coming back to a Session
      // already prepared would otherwise record Muxify's own settings as the
      // originals and lose the user's for good.
      if (!borrowed.has(sessionName)) {
        borrowed.set(sessionName, {
          statusLine: await chrome.readStatusLine(sessionName),
          windowSizing: await chrome.readWindowSizing(sessionName),
        });
      }
      await chrome.setStatusLine(sessionName, 'off');
      await chrome.setWindowSizing(sessionName, 'smallest');

      await chrome.redrawClient(clientTty);
    },

    async restoreAll(): Promise<void> {
      const owed = [...borrowed.entries()];
      // Forget as we go: a second teardown must not undo a change made since.
      borrowed.clear();
      for (const [sessionName, original] of owed) {
        if (original.statusLine !== undefined) {
          await chrome.setStatusLine(sessionName, original.statusLine);
        }
        if (original.windowSizing !== undefined) {
          await chrome.setWindowSizing(sessionName, original.windowSizing);
        }
      }
    },
  };
}
