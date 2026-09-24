/**
 * The slice of TmuxClient needed to make a Session presentable. Narrow on
 * purpose: this is the whole of what taking over a Session involves, and
 * keeping it small keeps that visible.
 */
export interface SessionChrome {
  readStatusLine(sessionName: string): Promise<string | undefined>;
  setStatusLine(sessionName: string, value: string): Promise<void>;
  redrawClient(clientTty?: string): Promise<void>;
}

export interface SessionPreparer {
  /** Makes a Session fit to show on the Surface. */
  prepare(sessionName: string, clientTty?: string): Promise<void>;
  /** Puts every Session this has changed back the way it was found. */
  restoreAll(): Promise<void>;
}

/**
 * Takes a Session over for the Surface, and gives it back afterwards.
 *
 * A Session is not ready to be shown on a phone as found: tmux draws a status
 * line that duplicates what the Dock already shows. It is a session option, so
 * it is visible to every other Client and outlives the Connection — which is
 * the price of attaching a real client rather than using control mode, see
 * ADR 0001.
 *
 * Sizing is deliberately not here. It has one owner, the resize scheduler,
 * because two things setting the remote size race each other — which is
 * exactly what left the Window at the size it had before layout settled.
 *
 * This exists because Attaching is not the only time it has to happen.
 * Switching Session lands on a Session nobody has prepared, so the same work
 * runs again — and every Session touched along the way has to be handed back
 * on teardown, not just the last one.
 */
export function createSessionPreparer(chrome: SessionChrome): SessionPreparer {
  /** Session name to the status line it had before Muxify touched it. */
  const borrowed = new Map<string, string | undefined>();

  return {
    async prepare(sessionName: string, clientTty?: string): Promise<void> {
      // Read before hiding, and only once: coming back to a Session already
      // prepared would otherwise record 'off' as its original and lose the
      // user's setting for good.
      if (!borrowed.has(sessionName)) {
        borrowed.set(sessionName, await chrome.readStatusLine(sessionName));
      }
      await chrome.setStatusLine(sessionName, 'off');

      await chrome.redrawClient(clientTty);
    },

    async restoreAll(): Promise<void> {
      const owed = [...borrowed.entries()];
      // Forget as we go: a second teardown must not undo a change made since.
      borrowed.clear();
      for (const [sessionName, statusLine] of owed) {
        // Undefined means tmux would not say what it was, so there is nothing
        // honest to put back.
        if (statusLine !== undefined) {
          await chrome.setStatusLine(sessionName, statusLine);
        }
      }
    },
  };
}
