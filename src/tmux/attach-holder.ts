import type { Host } from '@/storage/records';

import type { Attach, LifecyclePhase } from './attach';

/** What opening a Session needs. Everything else the Attach works out itself. */
export interface AttachRequest {
  host: Host;
  sessionName: string;
  /** The Zoom preference at the moment it is opened. */
  zoomed: boolean;
}

export interface AttachHolder {
  /** The attached Session, or null when nothing is. */
  current(): Attach | null;
  /**
   * Opens a Session, closing whatever was attached first.
   *
   * Asking for the Session that is already attached changes nothing and
   * returns it: tapping its row on the Host Screen is navigation, not a
   * reason to remake a Connection that is working.
   */
  open(request: AttachRequest): Promise<Attach>;
  /** Ends it on purpose. It does not come back on its own. */
  disconnect(): Promise<void>;
  /** Called whenever the attached Session changes, including to none. */
  subscribe(listener: (attach: Attach | null) => void): () => void;
  /** React Native's app-state, forwarded as a fact. The Attach decides. */
  lifecycleChanged(phase: LifecyclePhase): void;
}

/**
 * The one Attach the app holds.
 *
 * A Connection belongs to the app, not to a screen. Going Home is navigation
 * and leaves the Session attached; what ends an Attach is the user
 * disconnecting, another Session being opened, or a transport that was lost
 * and could not be restored. See ADR 0007.
 *
 * **One at a time**, which is the one place Muxify deliberately does less than
 * `remux` — it holds a collection. The slot is shaped so a collection could
 * replace it later without the Attach module changing at all: nothing here
 * reaches inside an Attach, and an Attach knows nothing about this.
 *
 * **The app's lifecycle is forwarded as a fact, not as an instruction.** What
 * background and foreground *mean* is the Attach's policy; this only knows
 * which Attach to tell.
 */
export function createAttachHolder(open: (request: AttachRequest) => Attach): AttachHolder {
  let current: Attach | null = null;
  let session = '';
  const listeners = new Set<(attach: Attach | null) => void>();

  function publish(): void {
    for (const listener of [...listeners]) listener(current);
  }

  return {
    current: () => current,

    async open(request: AttachRequest): Promise<Attach> {
      const attached = current;
      if (
        attached &&
        attached.hostId === request.host.id &&
        session === request.sessionName &&
        attached.state().phase.kind !== 'closed'
      ) {
        return attached;
      }

      // Closed *first*, and awaited: two Connections to account for is exactly
      // what holding one at a time is meant to avoid, and a Host that sees the
      // new one before the old one has gone is a Host with two Clients sizing
      // the same Session.
      if (attached) {
        current = null;
        publish();
        await attached.close();
      }

      const next = open({ ...request });
      current = next;
      session = request.sessionName;
      publish();
      return next;
    },

    async disconnect(): Promise<void> {
      const attached = current;
      if (!attached) return;
      current = null;
      session = '';
      publish();
      await attached.close();
    },

    subscribe(listener: (attach: Attach | null) => void): () => void {
      listeners.add(listener);
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },

    lifecycleChanged(phase: LifecyclePhase): void {
      current?.lifecycleChanged(phase);
    },
  };
}
