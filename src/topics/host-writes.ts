/**
 * Every Host Write of the phone, as the `EnvironmentCommand` of MuxifyCore
 * that the Host Server runs. Each goes out once, with its Request id, by
 * `sendEnvironment`. Nothing is read after a write: the Host Server pushes the
 * change. The JSON is pinned by MuxifyCore's `TopicWireTests`.
 */
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import { parseAddedSession, type AddSessionRead } from './add-session';
import { cardRef, cardTarget, type BoardCard } from './board-card';
import { parseEnvironment, type BoardSessionId, type EnvironmentSnapshot, type SessionId, type TopicId } from './environment';
import { array, object } from './json-shape';
import { firstPush, sendEnvironment, type EnvironmentAnswer, type EnvironmentCommand, type ServerConnections } from './host-write-request';
import { parseMoved, type MoveDestination, type Moved } from './move-to-topic';
import { parseNewTopic, type NewTopicRead } from './new-topic';
import type { RequestId } from './request';
import { isReadable, READ_SCOPES, type CardAction, type TopicAction } from './topic-action';
import { parseTopicDetail, TOPIC_GONE, type TopicDetail } from './topic-detail';
import type { Drop } from './topic-drop';
import type { TopicChange, TopicWrite } from './topic-edit';
import type { Wake } from './wake-topic';

/** `create`: an Empty Topic with this title and these Tags. The Host gives it the Request's id. */
export function createCommand(title: string, tags: readonly string[]): EnvironmentCommand {
  return { create: tags.length === 0 ? { title } : { title, tags: [...tags] } };
}

/** `rename`, `note` (no `text` for no Note) or `tags` with the whole set. */
export function changeCommand(change: TopicChange): EnvironmentCommand {
  switch (change.field) {
    case 'title':
      return { rename: { title: change.title } };
    case 'note':
      return { note: change.note === null ? {} : { text: change.note } };
    case 'tags':
      return { tags: { change: { set: { tags: [...change.tags] } } } };
  }
}

/** The menu orders that close a Topic with the Sessions `topic_choices` offers. */
export type ClosingAction = Extract<TopicAction, 'settle' | 'settle-stopping-sessions' | 'forget' | 'forget-stopping-sessions'>;

const CLOSING: Record<ClosingAction, { close: 'settle' | 'forget'; stopSessions: boolean }> = {
  settle: { close: 'settle', stopSessions: false },
  'settle-stopping-sessions': { close: 'settle', stopSessions: true },
  forget: { close: 'forget', stopSessions: false },
  'forget-stopping-sessions': { close: 'forget', stopSessions: true },
};

/**
 * The command of a menu order on this kind of card that needs nothing from
 * the Host first. Mark as Read and Mark as Unread take the card's scope from
 * `READ_SCOPES`; no menu offers them on a card with nothing to read.
 */
export function actionCommand(action: CardAction, card: BoardCard['kind']): EnvironmentCommand {
  switch (action) {
    case 'mark-read':
    case 'mark-unread':
      if (!isReadable(card)) throw new Error(`A ${card} card has nothing to read.`);
      return { mark_read: { change: action === 'mark-read' ? 'read' : 'unread', scope: READ_SCOPES[card][action] } };
    case 'move-up':
      return { move_card: { move: { up: {} } } };
    case 'move-down':
      return { move_card: { move: { down: {} } } };
    case 'bench':
      return { bench_topic: {} };
    case 'make-guest':
      return { make_guest: {} };
    case 'pin':
      return { pin: {} };
    case 'unpin':
      return { unpin: {} };
  }
}

/**
 * `settle` with the Sessions that `topic_choices` offered: each kept with no
 * Topic, or each stopped. No Worktree is removed, as the Host CLI's Settle
 * without `--remove-worktrees` does.
 */
export function settleCommand(choices: readonly object[], stopSessions: boolean): EnvironmentCommand {
  return { settle: { choices: disposed(choices, stopSessions) } };
}

/**
 * `forget` with the Sessions that `topic_choices` offered for it, kept or
 * stopped as in Settle. No Worktree is removed, as the Host CLI's Forget
 * without `--remove-worktrees` does.
 */
export function forgetCommand(choices: readonly object[], stopSessions: boolean): EnvironmentCommand {
  return { forget: { choices: disposed(choices, stopSessions), worktrees: [] } };
}

function disposed(choices: readonly object[], stopSessions: boolean): object[] {
  return choices.map((choice) => ({ ...choice, disposition: stopSessions ? 'kill' : 'keep', remove_worktree: false }));
}

/** The command of Settle or Forget, with the Sessions the Host offers for it now. */
export async function closingCommand(
  host: Host,
  topic: TopicId,
  action: ClosingAction,
  connections: ServerConnections = appConnections(),
): Promise<EnvironmentCommand> {
  const { close, stopSessions } = CLOSING[action];
  const choices = await topicChoices(host, topic, close, connections);
  return close === 'settle' ? settleCommand(choices, stopSessions) : forgetCommand(choices, stopSessions);
}

/** `move_card` next to or in trade with a card, or `fill_open_place`. */
export function dropCommand(drop: Drop): EnvironmentCommand {
  switch (drop.kind) {
    case 'place':
      return { move_card: { move: { [drop.side]: { card: cardRef(drop.anchor) } } } };
    case 'trade':
      return { move_card: { move: { trade: { card: cardRef(drop.with) } } } };
    case 'fill':
      return { fill_open_place: { place: drop.place } };
  }
}

export function wakeCommand(wake: Wake): EnvironmentCommand {
  return wake === 'reopen' ? { reopen: {} } : { start_fresh: {} };
}

/**
 * `move` of a Session into an open Topic, or into a new Topic with this
 * title. The Session keeps running, and the Host renames it for the Topic.
 */
export function moveCommand(to: MoveDestination): EnvironmentCommand {
  return { move: { to: to.kind === 'topic' ? { topic: { ref: { id: to.topic } } } : { new_topic: { title: to.title } } } };
}

/** A folder to add a Session at, as a row of the Host's Session Paths gives it, or as the user typed it. */
export interface SessionFolder {
  /** Absolute on the Host. */
  directory: string;
  /** The row's checkout: a Worktree, or a repository's own folder. Null for a plain folder, or one that was typed. */
  worktree: { path: string } | null;
  /** The row's Session name, which the Host starts the Session's name with. */
  name?: string;
}

/**
 * `add_session` at the folder, in the checkout of its row, or in a new
 * Worktree from that checkout. `chosenName` is the Session's exact name in
 * the Topic: a second run finds the Session that has it and makes no second
 * one. See `freeSessionName`.
 */
export function addSessionCommand(
  folder: SessionFolder,
  options: { newWorktree?: boolean; chosenName?: string } = {},
): EnvironmentCommand | { error: string } {
  const checkout = folder.worktree?.path;
  if (options.newWorktree && checkout === undefined) {
    return { error: `A new Worktree needs a git repository, and ${folder.directory} is not one.` };
  }
  const workingCopy = checkout === undefined
    ? { directory: {} }
    : options.newWorktree ? { new_worktree: { from: checkout } } : { worktree: { path: checkout } };
  return {
    add_session: {
      directory: folder.directory,
      working_copy: workingCopy,
      ...(folder.name === undefined ? {} : { name: folder.name }),
      ...(options.chosenName === undefined ? {} : { chosen_name: options.chosenName }),
    },
  };
}

/** `new_session`: a Session in no Topic at the folder. A name that a Session has gets `+2`, and so on. */
export function newSessionCommand(directory: string, name: string): EnvironmentCommand {
  return { new_session: { directory, name } };
}

/** Makes an Empty Topic with this title and these Tags. A refusal, such as a Tag the Config does not define, fails with the Host's reason. */
export async function createTopic(
  host: Host,
  title: string,
  tags: readonly string[],
  request: RequestId,
  sending?: () => void,
): Promise<NewTopicRead> {
  const answer = await sendEnvironment(host, { command: createCommand(title, tags), request }, sending);
  return answered(answer, (value) => ({ kind: 'created', topic: parseNewTopic(value) }));
}

/** Changes one field of a Topic. A refusal fails with the Host's reason, and the Host changes nothing. */
export async function changeTopic(
  host: Host,
  topic: TopicId,
  change: TopicChange,
  request: RequestId,
  sending?: () => void,
): Promise<TopicWrite> {
  return changed(await sendEnvironment(host, { command: changeCommand(change), target: { topic }, request }, sending));
}

/** Sends one write for a card whose command is known. */
export async function writeCard(
  host: Host,
  card: BoardCard,
  command: EnvironmentCommand,
  request: RequestId,
  sending?: () => void,
): Promise<TopicWrite> {
  return changed(await sendEnvironment(host, { command, target: cardTarget(card), request }, sending));
}

/** How a wake of a Dormant Board Session ended: the name of the Session the Host made, or why there is none. */
export type BoardSessionWake = { kind: 'woke'; session: string } | Exclude<EnvironmentAnswer, { kind: 'answered' }>;

/**
 * Reopens or Starts Fresh a Dormant Board Session. The Host answers with the
 * name of its Session, which the phone attaches to: there is no Topic to read.
 */
export async function wakeBoardSession(
  host: Host,
  id: BoardSessionId,
  wake: Wake,
  request: RequestId,
  sending?: () => void,
): Promise<BoardSessionWake> {
  const answer = await sendEnvironment(host, { command: wakeCommand(wake), target: { board_session: id }, request }, sending);
  return answered(answer, (value) => ({ kind: 'woke', session: parseAddedSession(value) }));
}

/** How a Move to Topic ended: where the Session is now, or why it did not move. */
export type SessionMove = ({ kind: 'moved' } & Moved) | Exclude<EnvironmentAnswer, { kind: 'answered' }>;

/** Moves a Session into a Topic. A refusal fails with the Host's reason, and the Host moves nothing. */
export async function moveSession(
  host: Host,
  session: SessionId,
  to: MoveDestination,
  request: RequestId,
  sending?: () => void,
): Promise<SessionMove> {
  const answer = await sendEnvironment(host, { command: moveCommand(to), target: { session }, request }, sending);
  return answered(answer, (value) => ({ kind: 'moved', ...parseMoved(value) }));
}

/**
 * The Sessions that Settle or Forget offers for the Topic, as the Host reads
 * them now: `topic_choices`. It changes nothing.
 */
export async function topicChoices(
  host: Host,
  topic: TopicId,
  action: 'settle' | 'forget',
  connections: ServerConnections = appConnections(),
): Promise<object[]> {
  const answer = await connections.onServer(host, (server) =>
    server.request({ topic_choices: { action, target: { topic: { id: topic } } } }));
  return array(object(answer, 'topic choices').sessions, 'sessions').map((session, index) => object(session, `sessions[${index}]`));
}

/**
 * Adds a Session to a Topic at the folder. A folder that starts with `~` is
 * the Host's home: the Host Server takes only absolute folders. A folder that
 * is not there, or any other refusal, fails with the Host's reason, and the
 * Host makes nothing.
 */
export async function addSession(
  host: Host,
  topic: TopicId,
  folder: SessionFolder,
  options: { newWorktree?: boolean; chosenName?: string },
  request: RequestId,
  sending?: () => void,
): Promise<AddSessionRead> {
  const command = addSessionCommand({ ...folder, directory: await onHost(host, folder.directory) }, options);
  if ('error' in command) return { kind: 'failed', error: String(command.error) };
  const answer = await sendEnvironment(host, { command, target: { topic }, request }, sending);
  return answered(answer, (value) => ({ kind: 'added', session: parseAddedSession(value) }));
}

/** Makes a Session in no Topic at a folder on the Host, as a Go to pick does. */
export async function newSession(
  host: Host,
  directory: string,
  name: string,
  request: RequestId,
  sending?: () => void,
): Promise<AddSessionRead> {
  const command = newSessionCommand(await onHost(host, directory), name);
  const answer = await sendEnvironment(host, { command, request }, sending);
  return answered(answer, (value) => ({ kind: 'added', session: parseAddedSession(value) }));
}

/**
 * The folder with a leading `~` made the Host's home, which one exec of the
 * Host's shell gives. Any other folder is as it was given.
 */
export async function onHost(host: Host, folder: string): Promise<string> {
  if (folder !== '~' && !folder.startsWith('~/')) return folder;
  const home = await appConnections().read(host, async (transport) => (await transport.exec('printf %s "$HOME"')).stdout.trim());
  if (!home.startsWith('/')) throw new Error(`Could not find the home folder of ${host.displayName}.`);
  return folder === '~' ? home : `${home.replace(/\/+$/, '')}/${folder.slice(2)}`;
}

function changed(answer: EnvironmentAnswer): TopicWrite {
  return answer.kind === 'answered' ? { kind: 'changed' } : answer;
}

/** The parsed answer, or why it could not be read. The Host made the change either way. */
function answered<T>(answer: EnvironmentAnswer, parse: (value: unknown) => T): T | Exclude<EnvironmentAnswer, { kind: 'answered' }> {
  if (answer.kind !== 'answered') return answer;
  try {
    return parse(answer.answer);
  } catch (error) {
    return { kind: 'failed', error: `Could not read the answer of the Host: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The Host's Listing as its Host Server pushes it now. It is how a sheet checks a write it is unsure of. */
export async function pushedListing(host: Host, signal?: AbortSignal): Promise<EnvironmentSnapshot> {
  return parseEnvironment(await appConnections().onServer(host, (server) => firstPush(server, { snapshot: {} }, signal)));
}

/** One Topic as its Host Server pushes it now. A Topic that is gone fails with the reason. */
export async function pushedTopic(host: Host, topic: TopicId): Promise<TopicDetail> {
  const item = await appConnections().onServer(host, (server) => firstPush(server, { topic: { id: topic } }));
  if (item === null) throw new Error(TOPIC_GONE);
  return parseTopicDetail(item);
}
