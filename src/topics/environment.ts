/**
 * What the Host Server pushes about a Host in its `snapshot` subscription, as
 * the phone holds it. It has the layout of `muxify environment show --json`.
 *
 * The JSON has no version field, so this file is the one place that decides
 * what a shape means. Every array keeps the order it came in: the order is the
 * Mac's Sidebar order, and sorting it on the phone would put a card somewhere
 * the Mac does not.
 */

import { array, number, object, string } from './json-shape';
import { parseTagColor, type TagColor } from './tag-color';

export type SessionId = string & { readonly __brand: 'SessionId' };
export type TopicId = string & { readonly __brand: 'TopicId' };
/** The id of a Board Session's row in the Host's state database. Only a Dormant card carries it. */
export type BoardSessionId = string & { readonly __brand: 'BoardSessionId' };

export type Mark = 'blocked' | 'failed' | 'unread' | 'done' | 'working';

/** `dormant` and `empty` are the two states with no live Session. */
export type TopicState = 'live' | 'dormant' | 'empty';

export interface TopicSummary {
  id: TopicId;
  label: string;
  note: string | null;
  tags: string[];
  state: TopicState;
}

export type Card =
  | { kind: 'topic'; mark: Mark | null; sessions: SessionId[]; topic: TopicSummary }
  /** A live Board Session: a Session in no Topic with its own card, named only by its tmux id. */
  | { kind: 'session'; mark: Mark | null; sessions: [SessionId] }
  /** A Dormant Board Session: its card stays after a tmux restart, named only by its Board Session id. */
  | { kind: 'dormant_session'; id: BoardSessionId; name: string }
  | { kind: 'open_place'; id: string }
  /** A kind this phone does not know. Drawn as a plain row, never a failure. */
  | { kind: 'unknown'; sourceKind: string; mark: Mark | null; sessions: SessionId[] };

/** The cards that are not Pinned: the In Play places, the Guests and the Bench. */
export interface Unpinned {
  limit: number;
  places: Card[];
  guests: Card[];
  bench: Card[];
}

/**
 * A Host CLI that answers with a layout this phone no longer reads: the flat
 * `list` of a desktop Muxify from before In Play was the only Topics mode.
 * The Host needs the Host CLI update, so it is not a malformed answer.
 */
export class HostCliTooOld extends Error {
  constructor() {
    super('The Host CLI answers with the flat Topics list.');
  }
}

/** A Tag the Host's Config defines. A colour this phone cannot read is null. */
export interface Tag {
  name: string;
  color: { light: TagColor | null; dark: TagColor | null };
}

export interface SnapshotWindow {
  id: string;
  index: number;
  name: string;
  active: boolean;
  mark: Mark | null;
}

export interface SnapshotSession {
  id: SessionId;
  name: string;
  activity: number;
  mark: Mark | null;
  topic: TopicId | null;
  windows: SnapshotWindow[] | null;
}

/** Which views the Mac's Sidebar shows, from the Config keys `sidebar.topics` and `sidebar.sessions`. */
export interface Sidebar {
  topics: boolean;
  sessions: boolean;
}

export interface EnvironmentSnapshot {
  /** Null from a Host CLI that does not say, which shows both views. */
  sidebar: Sidebar | null;
  /** In Config order. */
  tags: Tag[];
  sessions: SnapshotSession[];
  pinned: Card[];
  unpinned: Unpinned;
  no_topic: SessionId[];
}

/** Every card on the Board, in the Mac's order. */
export function boardCards({ pinned, unpinned }: EnvironmentSnapshot): Card[] {
  return [...pinned, ...unpinned.places, ...unpinned.guests, ...unpinned.bench];
}

/** The open Topics, in Board order. */
export function openTopics(snapshot: EnvironmentSnapshot): TopicSummary[] {
  return boardCards(snapshot).flatMap((card) => (card.kind === 'topic' ? [card.topic] : []));
}

/**
 * The name of each Session the Host has: live, or a Board Session that the
 * Board lists as Dormant, whose card opens it again by that name.
 */
export function sessionNamesHad(snapshot: EnvironmentSnapshot): Set<string> {
  const dormant = boardCards(snapshot).flatMap((card) => (card.kind === 'dormant_session' ? [card.name] : []));
  return new Set([...snapshot.sessions.map((session) => session.name), ...dormant]);
}

/**
 * Parses the answer once, at the boundary, so nothing past it checks a shape.
 *
 * Throws with the path of the first thing that is wrong, and `HostCliTooOld`
 * for the one answer that is not wrong but old. Three things never
 * throw, because a newer desktop Muxify may send them: a card `kind` this
 * phone does not know becomes an `unknown` card, a `mark` it does not know
 * becomes no mark, and a Tag colour it cannot read becomes no colour. A Topic
 * `state` it does not know becomes `live`: that draws the card undimmed and
 * says nothing about Sessions, where `dormant` would claim "No live Sessions" about a Topic the phone cannot describe.
 */
export function parseEnvironment(json: unknown): EnvironmentSnapshot {
  const root = object(json, 'environment');
  const unpinned = object(root.unpinned, 'unpinned');
  return {
    sidebar: parseSidebar(root.sidebar),
    tags: parseTags(root.tags),
    sessions: array(root.sessions, 'sessions').map((session, index) => {
      const at = `sessions[${index}]`;
      const entry = object(session, at);
      return {
        id: sessionId(entry.id, `${at}.id`),
        name: string(entry.name, `${at}.name`),
        activity: number(entry.activity, `${at}.activity`),
        windows: entry.windows === undefined ? null : array(entry.windows, `${at}.windows`).map((value, i) => {
          const where = `${at}.windows[${i}]`;
          const window = object(value, where);
          if (typeof window.active !== 'boolean') throw new Error(`${where}.active: expected a boolean`);
          return { id: string(window.id, `${where}.id`), index: number(window.index, `${where}.index`),
            name: string(window.name, `${where}.name`), active: window.active, mark: parseMark(window.mark) };
        }),
        mark: parseMark(entry.mark),
        topic: entry.topic === null ? null : topicId(entry.topic, `${at}.topic`),
      };
    }),
    pinned: cards(root.pinned, 'pinned'),
    unpinned: parseUnpinned(unpinned),
    no_topic: array(root.no_topic, 'no_topic').map((id, index) =>
      sessionId(id, `no_topic[${index}]`),
    ),
  };
}

function parseSidebar(value: unknown): Sidebar | null {
  if (value === undefined) return null;
  const sidebar = object(value, 'sidebar');
  if (typeof sidebar.topics !== 'boolean') throw new Error('sidebar.topics: expected a boolean');
  if (typeof sidebar.sessions !== 'boolean') throw new Error('sidebar.sessions: expected a boolean');
  return { topics: sidebar.topics, sessions: sidebar.sessions };
}

function parseUnpinned(unpinned: Record<string, unknown>): Unpinned {
  switch (unpinned.kind) {
    case 'in_play':
      return {
        limit: number(unpinned.limit, 'unpinned.limit'),
        places: cards(unpinned.places, 'unpinned.places'),
        guests: cards(unpinned.guests, 'unpinned.guests'),
        bench: cards(unpinned.bench, 'unpinned.bench'),
      };
    case 'list':
      throw new HostCliTooOld();
    default:
      throw new Error(`unpinned.kind: unknown value ${JSON.stringify(unpinned.kind)}`);
  }
}

function cards(value: unknown, at: string): Card[] {
  return array(value, at).map((card, index) => parseCard(card, `${at}[${index}]`));
}

function parseCard(value: unknown, at: string): Card {
  const card = object(value, at);
  switch (card.kind) {
    case 'topic': {
      const topic = object(card.topic, `${at}.topic`);
      return {
        kind: 'topic',
        mark: parseMark(card.mark),
        sessions: array(card.sessions, `${at}.sessions`).map((id, i) =>
          sessionId(id, `${at}.sessions[${i}]`),
        ),
        topic: {
          id: topicId(topic.id, `${at}.topic.id`),
          label: string(topic.label, `${at}.topic.label`),
          note: topic.note === null ? null : string(topic.note, `${at}.topic.note`),
          tags: array(topic.tags, `${at}.topic.tags`).map((tag, i) =>
            string(tag, `${at}.topic.tags[${i}]`),
          ),
          state: parseTopicState(topic.state),
        },
      };
    }
    case 'session': {
      const sessions = array(card.sessions, `${at}.sessions`);
      if (sessions.length !== 1) throw new Error(`${at}.sessions: a live Board Session has one Session`);
      return {
        kind: 'session',
        mark: parseMark(card.mark),
        sessions: [sessionId(sessions[0], `${at}.sessions[0]`)],
      };
    }
    case 'dormant_session':
      return {
        kind: 'dormant_session',
        id: string(card.id, `${at}.id`) as BoardSessionId,
        name: string(card.name, `${at}.name`),
      };
    case 'open_place':
      return { kind: 'open_place', id: string(card.id, `${at}.id`) };
    default:
      return {
        kind: 'unknown',
        sourceKind: typeof card.kind === 'string' ? card.kind : 'unknown',
        mark: parseMark(card.mark),
        sessions: Array.isArray(card.sessions)
          ? card.sessions.filter((id): id is SessionId => typeof id === 'string')
          : [],
      };
  }
}

const MARKS: readonly string[] = ['blocked', 'failed', 'unread', 'done', 'working'];

export function parseMark(value: unknown): Mark | null {
  return typeof value === 'string' && MARKS.includes(value) ? (value as Mark) : null;
}

/** The `tags` of `environment show --json`, in the order they came in. */
export function parseTags(value: unknown): Tag[] {
  return array(value, 'tags').map((tag, index) => {
    const at = `tags[${index}]`;
    const entry = object(tag, at);
    const color = object(entry.color, `${at}.color`);
    return {
      name: string(entry.name, `${at}.name`),
      color: {
        light: parseTagColor(string(color.light, `${at}.color.light`)),
        dark: parseTagColor(string(color.dark, `${at}.color.dark`)),
      },
    };
  });
}

export function parseTopicState(value: unknown): TopicState {
  return value === 'dormant' || value === 'empty' ? value : 'live';
}

export const sessionId = (value: unknown, at: string) => string(value, at) as SessionId;
export const topicId = (value: unknown, at: string) => string(value, at) as TopicId;
