import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { deviceLog } from '@/diagnostics/device-log';
import { deviceHostStore } from '@/storage/device-store';
import { useSettings } from '@/settings/settings-context';
import { readTopic } from '@/topics/read-topic';

import { openAttach, type Attach, type AttachState, type LifecyclePhase, type SessionDestination } from './attach';
import { createAttachHolder, type AttachHolder, type AttachOrigin } from './attach-holder';
import { appConnections } from './ssh-connection';

const AttachContext = createContext<AttachHolder | null>(null);

/**
 * The app's Attach, held at the root.
 *
 * Here rather than in the Terminal Screen because a Connection is the app's
 * and not a screen's: tapping Home is navigation, and the Session stays
 * attached until the user disconnects it, opens another, or the transport is
 * lost and cannot be restored. See ADR 0007.
 *
 * It also forwards React Native's app-state to the Attach as a *fact*. What
 * background and foreground mean — cancel the reads, stop drawing, ask the
 * transport whether the link survived, restore once — is the Attach's policy,
 * tested with a fake transport. Nothing here decides anything.
 */
export function AttachProvider({ children }: { children: ReactNode }) {
  const holder = useMemo(
    () =>
      createAttachHolder(
        (request) =>
          openAttach({
            ...request,
            store: deviceHostStore(),
            readTopic,
            openConnection: appConnections().openConnection,
            log: deviceLog(),
          }),
        deviceHostStore(),
        deviceLog(),
      ),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      appConnections().lifecycleChanged(lifecycleOf(status));
      holder.lifecycleChanged(lifecycleOf(status));
    });
    return () => subscription.remove();
  }, [holder]);

  return <AttachContext.Provider value={holder}>{children}</AttachContext.Provider>;
}

export function useAttachHolder(): AttachHolder {
  const holder = useContext(AttachContext);
  if (!holder) throw new Error('No AttachProvider above this screen');
  return holder;
}

/** Whatever Session is attached, or null. Re-renders when it changes. */
export function useCurrentAttach(): Attach | null {
  const holder = useAttachHolder();
  const [attach, setAttach] = useState<Attach | null>(() => holder.current());
  useEffect(() => holder.subscribe(setAttach), [holder]);
  return attach;
}

/**
 * What the attached Session is doing, or null when nothing is.
 *
 * The whole of what a screen reads from an Attach. Subscribing on mount and
 * unsubscribing on unmount is all a screen does to one — it starts and stops
 * nothing.
 */
export function useAttachState(attach: Attach | null): AttachState | null {
  // Kept with the Attach it came from, and read back only against that
  // Attach. A state held on its own outlives the Attach by a render: the
  // holder swaps Attaches, the screen re-renders with the new one and the old
  // one's Topology, and for that render the old Session's Panes are still on
  // screen — mounting their Surfaces onto an Attach that has never heard of
  // them. Nothing here may be a render behind the Attach.
  const [held, setHeld] = useState<{ of: Attach | null; state: AttachState | null }>(() => ({
    of: attach,
    state: attach?.state() ?? null,
  }));
  useEffect(() => {
    if (!attach) {
      setHeld({ of: null, state: null });
      return;
    }
    return attach.subscribe((state) => setHeld({ of: attach, state }));
  }, [attach]);
  return held.of === attach ? held.state : (attach?.state() ?? null);
}

/**
 * React Native's app-state, as the phases the Attach knows.
 *
 * `inactive` is the moment between — the app switcher, a notification shade
 * coming down — and iOS reports several others on the way. Anything that is
 * not plainly active or plainly backgrounded is treated as the in-between,
 * which the Attach does nothing about.
 */
function lifecycleOf(status: AppStateStatus): LifecyclePhase {
  if (status === 'active') return 'active';
  if (status === 'background') return 'background';
  return 'inactive';
}

export function useOpenSession() {
  const holder = useAttachHolder();
  const { settings } = useSettings();
  return useCallback(async (request: {
    hostId: string;
    destination: SessionDestination;
    origin?: AttachOrigin;
    isCurrent?: () => boolean;
  }): Promise<Attach> => {
    const records = await deviceHostStore().load();
    const host = records.hosts.find((candidate) => candidate.id === request.hostId);
    if (!host) throw new Error('This Host is no longer saved.');
    return holder.open({ host, destination: request.destination, origin: request.origin, isCurrent: request.isCurrent,
      zoomed: settings.zoomMultipaneWindows });
  }, [holder, settings.zoomMultipaneWindows]);
}
