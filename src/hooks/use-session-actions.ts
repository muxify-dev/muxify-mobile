import { useCallback } from 'react';

import type { MoveToTopicParams } from '@/app/move-to-topic';
import type { RenameParams } from '@/app/rename';
import type { NamedSession, SessionAction } from '@/topics/session-action';

import { useTmuxWrites } from './use-tmux-writes';

export type SessionSheet =
  | { pathname: '/rename'; params: RenameParams }
  | { pathname: '/move-to-topic'; params: MoveToTopicParams };

/**
 * The Session Actions of every menu that offers them. `open` shows a sheet;
 * a screen that must close something first passes its own.
 */
export function useSessionActions(hostId: string, open: (sheet: SessionSheet) => void) {
  const tmuxWrites = useTmuxWrites(hostId);
  const act = useCallback(({ id, name }: NamedSession, action: SessionAction) => {
    switch (action) {
      case 'rename-session':
        open({ pathname: '/rename', params: { hostId, kind: 'session', id, name } });
        return;
      case 'move-to-topic':
        open({ pathname: '/move-to-topic', params: { hostId, session: id, name } });
        return;
      case 'remove-from-topic':
        void tmuxWrites.order({ kind: 'remove-from-topic', session: id });
        return;
      case 'kill-session':
        tmuxWrites.confirm({ kind: 'kill-session', session: id }, name);
        return;
    }
  }, [hostId, open, tmuxWrites]);
  return { ...tmuxWrites, act };
}
