import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { PathOpening } from '@/domain/go-to';
import type { Host } from '@/storage/records';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin } from '@/tmux/attach-holder';
import { newSession, pushedListing } from '@/topics/host-writes';
import { recordVisit } from '@/topics/visit';

import { useHostWrite, type HostWriteRun } from './use-host-write';

type NewSession = Extract<PathOpening, { kind: 'new' }>;

/**
 * The Host Write of a Go to pick that makes a Session: `new_session` at the
 * folder, then the Attach, then the visit. A second try at the same folder
 * and name is the same Request, so it makes no second Session.
 *
 * A pick that waits for the Connection goes only while the screen has the
 * focus. After the user leaves, it sends nothing.
 */
export function useGoToPick(hostId: string, onOpened: () => void) {
  const holder = useAttachHolder();
  const openSession = useOpenSession();
  const { write, hostName, check, request } = useHostWrite(hostId);
  const [picked, setPicked] = useState<NewSession | null>(null);
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));

  const attach = async (session: string, folder: string, host: Host, step: HostWriteRun['step']) => {
    if (!focused.current) return undefined;
    step('attaching');
    await openSession({ hostId, destination: { sessionName: session, topic: null }, origin: captureAttachOrigin(holder.current()), keyboard: 'up' });
    recordVisit(host, folder);
    return true as const;
  };
  const opened = (done: true | undefined) => { if (done && focused.current) onOpened(); };

  const make = (opening: NewSession) => {
    setPicked(opening);
    void request(
      JSON.stringify([opening.directory, opening.name]),
      ({ host, step, refuse }, id) => newSession(host, opening.directory, opening.name, id, () => {
        if (!focused.current) refuse('You left the Host Screen before the Connection was up.');
        step('sending');
      }),
      (added, { host, step }) => attach(added.session, opening.directory, host, step),
    ).then(opened);
  };

  return {
    write,
    hostName,
    /** The Session that the last pick makes, for the words of its Host Write. */
    picked,
    make,
    retry: () => { if (picked) make(picked); },
    /** Looks in the Listing the Host Server pushes for the Session an unanswered pick asked for, and opens it. */
    check: () => {
      const opening = picked;
      if (!opening) return;
      void check(async ({ host, step, refuse }) => {
        const { sessions } = await pushedListing(host);
        if (!sessions.some((session) => session.name === opening.name)) {
          return refuse(`${opening.name} is not on ${host.displayName}. Pick the folder again to make it.`);
        }
        return attach(opening.name, opening.directory, host, step);
      }).then(opened);
    },
  };
}
