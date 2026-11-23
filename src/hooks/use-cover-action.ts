import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { actionLabel, type CoverAction } from '@/domain/cover';
import { deviceHostStore } from '@/storage/device-store';
import type { Attach } from '@/tmux/attach';

import type { RouteSessionState } from './use-route-session';

/** Back to the Host Screen of `hostId`, over Home, or to Home when there is no Host. */
export function useGoHost(hostId: string | undefined): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (hostId) router.dismissTo({ pathname: '/hosts/[id]', params: { id: hostId } });
    else router.dismissTo('/');
  }, [hostId, router]);
}

/**
 * A Cover's button, on the Terminal Screen or on the Web View a cold start
 * opened. Each is the same act wherever it shows: the Connection Screen or a card.
 */
export function useCoverAction({ opening, attach, hostId, openSessionsOnly, say }: {
  opening: RouteSessionState;
  attach: Attach | null;
  hostId: string | undefined;
  openSessionsOnly: () => void;
  say: (line: string) => void;
}): (action: CoverAction) => void {
  const router = useRouter();
  const goHost = useGoHost(hostId);
  const { lookup, tryAgain } = opening;
  return useCallback((action: CoverAction) => {
    say(`Cover: ${actionLabel(action)}`);
    switch (action) {
      case 'reconnect':
      case 'try-again':
        // The cold start's visit, if that is what stopped; else the Attach,
        // which reads the Host record again, so an edit to it counts.
        if (lookup?.kind === 'failed' || !attach) tryAgain();
        else attach.reconnect();
        return;
      case 'edit-host':
        if (hostId) router.push({ pathname: '/host-form', params: { id: hostId } });
        return;
      case 'accept-key':
        if (lookup?.kind === 'failed' && lookup.step === 'checking-host-key') {
          const fingerprint = lookup.fingerprint;
          void (async () => {
            if (hostId) await deviceHostStore().rememberFingerprint(hostId, fingerprint);
            tryAgain();
          })();
        } else {
          void attach?.acceptHostKey();
        }
        return;
      case 'choose-session':
        openSessionsOnly();
        return;
      case 'go-to-host':
        goHost();
        return;
      case 'go-to-hosts':
        router.dismissTo('/');
        return;
    }
  }, [lookup, attach, hostId, router, tryAgain, openSessionsOnly, goHost, say]);
}
