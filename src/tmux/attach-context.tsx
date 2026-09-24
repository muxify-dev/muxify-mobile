import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { deviceHostStore } from '@/storage/device-store';

import { openAttach, type Attach, type AttachState, type LifecyclePhase } from './attach';
import { createAttachHolder, type AttachHolder } from './attach-holder';
import { sshConnection } from './ssh-connection';

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
      createAttachHolder((request) =>
        openAttach({
          ...request,
          store: deviceHostStore(),
          openConnection: sshConnection(deviceHostStore()),
        }),
      ),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
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
  const [state, setState] = useState<AttachState | null>(() => attach?.state() ?? null);
  useEffect(() => {
    if (!attach) {
      setState(null);
      return;
    }
    return attach.subscribe(setState);
  }, [attach]);
  return state;
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
