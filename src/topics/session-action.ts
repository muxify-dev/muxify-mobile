import type { SFSymbol } from 'expo-symbols';

import type { SessionId } from './environment';

/** The Actions of a Session's menu. */
export type SessionAction = 'rename-session' | 'move-to-topic' | 'remove-from-topic' | 'kill-session';

/** The Actions of a Window's menu. */
export type WindowAction = 'rename-window' | 'close-window';

/** A Session a Session Action names: by tmux's id on the Host, and by the name the user sees. */
export interface NamedSession {
  id: SessionId;
  name: string;
}

/** What the Host Server says of a Session, which its Actions need. */
export interface SessionOnHost {
  id: SessionId;
  /** Whether it is in a Topic, which is when Remove from Topic is offered. */
  inTopic: boolean;
}

/**
 * The Actions a Session offers in every menu, in the Mac's order: Remove from
 * Topic only for a Session in a Topic.
 */
export function sessionActions(session: SessionOnHost): SessionAction[] {
  return session.inTopic
    ? ['rename-session', 'move-to-topic', 'remove-from-topic', 'kill-session']
    : ['rename-session', 'move-to-topic', 'kill-session'];
}

export const WINDOW_ACTIONS: readonly WindowAction[] = ['rename-window', 'close-window'];

/**
 * The menu item of each Action. The label has an ellipsis where a sheet or a
 * confirm comes first, and an Action that ends something is destructive.
 */
export const MENU_ITEM: Record<SessionAction | WindowAction, { label: string; icon: SFSymbol; destructive: boolean }> = {
  'rename-session': { label: 'Rename Session…', icon: 'pencil', destructive: false },
  'move-to-topic': { label: 'Move to Topic…', icon: 'rectangle.stack.badge.plus', destructive: false },
  'remove-from-topic': { label: 'Remove from Topic', icon: 'minus.circle', destructive: false },
  'kill-session': { label: 'Kill Session…', icon: 'stop.circle', destructive: true },
  'rename-window': { label: 'Rename Window…', icon: 'pencil', destructive: false },
  'close-window': { label: 'Close Window…', icon: 'xmark.circle', destructive: true },
};
