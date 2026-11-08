/**
 * What `muxify environment show --json` says about a Host, as the phone holds it.
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
  /** A Locked Session: a Session shown as its own card, with no Topic. */
  | { kind: 'session'; mark: Mark | null; sessions: [SessionId] }
  | { kind: 'open_place'; id: string }
  /** A kind this phone does not know. Drawn as a plain row, never a failure. */
  | { kind: 'unknown'; sourceKind: string; mark: Mark | null; sessions: SessionId[] };

export type Unpinned =
  | { kind: 'in_play'; limit: number; places: Card[]; guests: Card[]; bench: Card[] }
  | { kind: 'list'; cards: Card[] };

export interface SnapshotSession {
  id: SessionId;
  name: string;
  activity: number;
  mark: Mark | null;
  topic: TopicId | null;
}

export interface EnvironmentSnapshot {
  /** In Config order. A colour this phone cannot read is null. */
  tags: { name: string; color: { light: TagColor | null; dark: TagColor | null } }[];
  sessions: SnapshotSession[];
  pinned: Card[];
  unpinned: Unpinned;
  no_topic: SessionId[];
}

/**
 * Parses the answer once, at the boundary, so nothing past it checks a shape.
 *
 * Throws with the path of the first thing that is wrong. Three things never
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
    tags: array(root.tags, 'tags').map((tag, index) => {
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
    }),
    sessions: array(root.sessions, 'sessions').map((session, index) => {
      const at = `sessions[${index}]`;
      const entry = object(session, at);
      return {
        id: sessionId(entry.id, `${at}.id`),
        name: string(entry.name, `${at}.name`),
        activity: number(entry.activity, `${at}.activity`),
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

function parseUnpinned(unpinned: Record<string, unknown>): Unpinned {
  switch (unpinned.kind) {
    case 'in_play':
      return {
        kind: 'in_play',
        limit: number(unpinned.limit, 'unpinned.limit'),
        places: cards(unpinned.places, 'unpinned.places'),
        guests: cards(unpinned.guests, 'unpinned.guests'),
        bench: cards(unpinned.bench, 'unpinned.bench'),
      };
    case 'list':
      return { kind: 'list', cards: cards(unpinned.cards, 'unpinned.cards') };
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
      if (sessions.length !== 1) throw new Error(`${at}.sessions: a Locked Session has one Session`);
      return {
        kind: 'session',
        mark: parseMark(card.mark),
        sessions: [sessionId(sessions[0], `${at}.sessions[0]`)],
      };
    }
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

function parseMark(value: unknown): Mark | null {
  return typeof value === 'string' && MARKS.includes(value) ? (value as Mark) : null;
}

export function parseTopicState(value: unknown): TopicState {
  return value === 'dormant' || value === 'empty' ? value : 'live';
}

export const sessionId = (value: unknown, at: string) => string(value, at) as SessionId;
export const topicId = (value: unknown, at: string) => string(value, at) as TopicId;
