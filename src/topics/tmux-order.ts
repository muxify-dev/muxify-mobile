import type { SFSymbol } from 'expo-symbols';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import type { Host } from '@/storage/records';

import type { SessionId } from './environment';
import { sendEnvironment, type EnvironmentCommand, type WriteTarget } from './host-write-request';
import { newRequestId } from './request';
import type { TopicWrite } from './topic-edit';

const say = speakingAs(deviceLog(), 'topic');

/**
 * One write of the Mac's Session and Window Actions, or Mark All as Read.
 * Each names its Session or Window by tmux's id, so the Host acts on that one
 * whatever the Attach shows. The Host Server pushes the Listing and the Topic
 * that show the result: the phone reads nothing after it.
 */
export type TmuxOrder =
  | { kind: 'rename-session'; session: SessionId; name: string }
  | { kind: 'remove-from-topic'; session: SessionId }
  | { kind: 'stop-session'; session: SessionId }
  | { kind: 'rename-window'; window: string; name: string }
  | { kind: 'close-window'; window: string }
  | { kind: 'mark-all-read' };

export type TmuxOrderKind = TmuxOrder['kind'];

/** The Actions of a Session's menu. Rename Session… opens the name sheet, and Stop Session… asks first. */
export type SessionAction = Extract<TmuxOrderKind, 'rename-session' | 'remove-from-topic' | 'stop-session'>;

/** The Actions of a Window's menu. Rename Window… opens the name sheet, and Close Window… asks first. */
export type WindowAction = Extract<TmuxOrderKind, 'rename-window' | 'close-window'>;

/** The Mac's words for each order, as an alert names it. */
export const TMUX_ORDER_LABEL: Record<TmuxOrderKind, string> = {
  'rename-session': 'Rename Session',
  'remove-from-topic': 'Remove from Topic',
  'stop-session': 'Stop Session',
  'rename-window': 'Rename Window',
  'close-window': 'Close Window',
  'mark-all-read': 'Mark All as Read',
};

/** The menu item of each Action: an ellipsis where a sheet or a confirm comes first. */
export const TMUX_MENU_LABEL: Record<SessionAction | WindowAction, string> = {
  'rename-session': 'Rename Session…',
  'remove-from-topic': 'Remove from Topic',
  'stop-session': 'Stop Session…',
  'rename-window': 'Rename Window…',
  'close-window': 'Close Window…',
};

export const TMUX_ORDER_ICON: Record<TmuxOrderKind, SFSymbol> = {
  'rename-session': 'pencil',
  'remove-from-topic': 'minus.circle',
  'stop-session': 'stop.circle',
  'rename-window': 'pencil',
  'close-window': 'xmark.circle',
  'mark-all-read': 'envelope.open',
};

/** What the Host Server says of a Session, which its Actions need. */
export interface SessionOnHost {
  id: SessionId;
  /** Whether it is in a Topic, which is when Remove from Topic is offered. */
  inTopic: boolean;
}

/** The Actions a Session offers: Remove from Topic only for a Session in a Topic. */
export function sessionActions(session: SessionOnHost): SessionAction[] {
  return session.inTopic ? ['rename-session', 'remove-from-topic', 'stop-session'] : ['rename-session', 'stop-session'];
}

export const WINDOW_ACTIONS: readonly WindowAction[] = ['rename-window', 'close-window'];

/** The confirm alert of Stop Session… and Close Window…: its title, its words and its destructive button. */
export function endAlert(action: Extract<TmuxOrderKind, 'stop-session' | 'close-window'>, name: string) {
  return action === 'stop-session'
    ? {
        title: `Stop ${name}?`,
        message: 'Its Windows and what runs in them end on the Host.',
        confirm: TMUX_ORDER_LABEL['stop-session'],
      }
    : {
        title: `Close ${name}?`,
        message: 'Its Panes and what runs in them end on the Host.',
        confirm: TMUX_ORDER_LABEL['close-window'],
      };
}

/** The `environment` command of an order, and the Session or Window it targets. Mark All as Read targets none. */
export function tmuxWrite(order: TmuxOrder): { command: EnvironmentCommand; target?: WriteTarget } {
  switch (order.kind) {
    case 'rename-session':
      return { command: { rename_session: { name: order.name } }, target: { session: order.session } };
    case 'remove-from-topic':
      return { command: { remove_from_topic: {} }, target: { session: order.session } };
    case 'stop-session':
      return { command: { kill_session: {} }, target: { session: order.session } };
    case 'rename-window':
      return { command: { rename_window: { name: order.name } }, target: { window: order.window } };
    case 'close-window':
      return { command: { kill_window: {} }, target: { window: order.window } };
    case 'mark-all-read':
      return { command: { mark_all_read: {} } };
  }
}

/** What one order runs on, which has one write at a time: its Session, its Window, or the whole Host. */
export function tmuxOrderTarget(order: TmuxOrder): string {
  if ('session' in order) return order.session;
  if ('window' in order) return order.window;
  return 'host';
}

/**
 * Sends one order to its Host as one `environment` request on the Host
 * Server. The Host's refusal is a failed write, and a Request in doubt an
 * unknown one. A break of the Connection throws, as in `sendTopicOrder`.
 * Each call is one tap, so each has its own Request id.
 */
export async function sendTmuxOrder(host: Host, order: TmuxOrder, sending: () => void): Promise<TopicWrite> {
  const label = TMUX_ORDER_LABEL[order.kind];
  try {
    const answer = await sendEnvironment(host, { ...tmuxWrite(order), request: newRequestId() }, sending);
    const write: TopicWrite = answer.kind === 'answered' ? { kind: 'changed' } : answer;
    say(describeWrite(host.displayName, label, write));
    return write;
  } catch (error) {
    say(`${host.displayName} broke off ${label}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function describeWrite(host: string, label: string, write: TopicWrite): string {
  switch (write.kind) {
    case 'changed':
      return `${host} did ${label}`;
    case 'failed':
      return `${host} refused ${label}: ${write.error}`;
    case 'unknown':
      return `${host} did not finish ${label}, which may have happened: ${write.message}`;
  }
}
