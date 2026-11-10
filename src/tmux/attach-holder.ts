import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';

import type { Attach, LifecyclePhase, SessionDestination } from './attach';

export interface AttachOrigin {
  attach: Attach | null;
  sessionName: string | null;
  topicId: string | null;
}

export function captureAttachOrigin(attach: Attach | null): AttachOrigin {
  const state = attach?.state();
  return { attach, sessionName: state?.sessionName ?? null, topicId: state?.topic?.id ?? null };
}

/** What opening a Session needs. Everything else the Attach works out itself. */
export interface AttachRequest {
  host: Host;
  destination: SessionDestination;
  origin?: AttachOrigin;
  isCurrent?: () => boolean;
  /** The Zoom preference at the moment it is opened. */
  zoomed: boolean;
}

export interface AttachHolder {
  /** The attached Session, or null when nothing is. */
  current(): Attach | null;
  /** Reuses a connected Attach on the same Host, or closes it before opening another. */
  open(request: AttachRequest): Promise<Attach>;
  /**
   * Ends it on purpose. It does not come back on its own, and the Last Place
   * is forgotten, so the next cold start does not bring it back either.
   */
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
export function createAttachHolder(
  open: (request: Pick<AttachRequest, 'host' | 'destination' | 'zoomed'>) => Attach,
  lastPlace: Pick<HostStore, 'forgetLastPlace'>,
  log: Log = silentLog,
): AttachHolder {
  let current: Attach | null = null;
  let opening = false;
  let revision = 0;
  let pendingClose: Promise<void> | null = null;
  let disconnecting: Promise<void> | null = null;
  const listeners = new Set<(attach: Attach | null) => void>();
  const say = speakingAs(log, 'holder');

  function publish(): void {
    for (const listener of [...listeners]) listener(current);
  }

  return {
    current: () => current,

    async open(request: AttachRequest): Promise<Attach> {
      if (opening || disconnecting) throw new Error('A Session is already being opened or disconnected.');
      opening = true;
      const mine = revision;
      try {
        if (request.isCurrent && !request.isCurrent()) throw new Error('This Session request is no longer current.');
        const origin = request.origin;
        const state = current?.state();
        if (origin && (current !== origin.attach || (state?.sessionName ?? null) !== origin.sessionName ||
            (state?.topic?.id ?? null) !== origin.topicId)) {
          throw new Error('The attached Session or Topic changed. Open the Session from Home.');
        }
        const attached = current;
        if (attached && attached.hostId === request.host.id && attached.state().phase.kind !== 'closed' &&
            (attached.state().phase.kind === 'connected' || attached.state().sessionName === request.destination.sessionName)) {
          await attached.switchSession(request.destination);
          return attached;
        }

        // Closed *first*, and awaited: two Connections to account for is exactly
        // what holding one at a time is meant to avoid, and a Host that sees the
        // new one before the old one has gone is a Host with two Clients sizing
        // the same Session.
        if (attached) {
          say(`open ${request.host.displayName}:${request.destination.sessionName}: closing ${attached.hostName}:${attached.state().sessionName} first`);
          current = null;
          publish();
          pendingClose = attached.close();
          try { await pendingClose; } finally { pendingClose = null; }
        } else {
          say(`open ${request.host.displayName}:${request.destination.sessionName}`);
        }

        if (mine !== revision) throw new Error('The Attach was disconnected before the Session opened.');
        if (request.isCurrent && !request.isCurrent()) throw new Error('This Session request is no longer current.');
        const next = open({ host: request.host, destination: request.destination, zoomed: request.zoomed });
        current = next;
        publish();
        return next;
      } finally { opening = false; }
    },

    async disconnect(): Promise<void> {
      if (disconnecting) return disconnecting;
      revision += 1;
      const attached = current;
      const closing = pendingClose;
      if (!attached && !closing) return;
      current = null;
      disconnecting = Promise.resolve().then(async () => {
        if (attached) {
          say(`disconnect ${attached.hostName}:${attached.state().sessionName}`);
          await attached.close();
        } else {
          await closing;
        }
        await lastPlace.forgetLastPlace();
      });
      publish();
      try { await disconnecting; } finally { disconnecting = null; }
    },

    subscribe(listener: (attach: Attach | null) => void): () => void {
      listeners.add(listener);
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },

    lifecycleChanged(phase: LifecyclePhase): void {
      say(`app ${phase}${current ? '' : ', nothing attached'}`);
      current?.lifecycleChanged(phase);
    },
  };
}
