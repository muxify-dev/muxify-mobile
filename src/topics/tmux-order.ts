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
  | { kind: 'kill-session'; session: SessionId }
  | { kind: 'rename-window'; window: string; name: string }
  | { kind: 'close-window'; window: string }
  | { kind: 'mark-all-read' };

export type TmuxOrderKind = TmuxOrder['kind'];

/** The Mac's words for each order, as an alert names it. */
export const TMUX_ORDER_LABEL: Record<TmuxOrderKind, string> = {
  'rename-session': 'Rename Session',
  'remove-from-topic': 'Remove from Topic',
  'kill-session': 'Kill Session',
  'rename-window': 'Rename Window',
  'close-window': 'Close Window',
  'mark-all-read': 'Mark All as Read',
};

/** The confirm alert of Kill Session… and Close Window…: its title, its words and its destructive button. */
export function endAlert(action: Extract<TmuxOrderKind, 'kill-session' | 'close-window'>, name: string) {
  return action === 'kill-session'
    ? {
        title: `Kill ${name}?`,
        message: 'Its Windows and what runs in them end on the Host.',
        confirm: TMUX_ORDER_LABEL['kill-session'],
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
    case 'kill-session':
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
