/**
 * What `muxify topic show --json --topic <id>` says about one Topic, as the
 * Topic Screen holds it. Sessions and Windows keep the order they came in,
 * which is the Mac's order.
 */

import {
  parseTopicState,
  sessionId,
  topicId,
  type Mark,
  type SessionId,
  type TopicId,
  type TopicState,
} from './environment';
import { array, number, object, string } from './json-shape';

/** The marks one Agent can give. Weakest first, as desktop Muxify's `AgentMark` orders them. */
export type AgentMark = Extract<Mark, 'working' | 'done' | 'failed' | 'blocked'>;

const AGENT_MARKS: readonly AgentMark[] = ['working', 'done', 'failed', 'blocked'];

export interface TopicWindow {
  id: string;
  index: number;
  name: string;
  /** The strongest Agent mark of the Window's Panes. */
  mark: AgentMark | null;
}

export interface TopicSession {
  id: SessionId;
  name: string;
  windows: TopicWindow[];
}

export interface TopicDetail {
  id: TopicId;
  label: string;
  note: string | null;
  tags: string[];
  state: TopicState;
  /** The live Sessions. A Dormant or Empty Topic has none. */
  sessions: TopicSession[];
}

/**
 * Parses the answer once, at the boundary. Throws with the path of the first
 * thing that is wrong. An Agent field that is missing or unknown gives no
 * mark and never throws, because a newer desktop Muxify may send a status
 * this phone does not know.
 */
export function parseTopicDetail(json: unknown): TopicDetail {
  const topic = object(object(json, 'answer').topic, 'topic');
  return {
    id: topicId(topic.id, 'topic.id'),
    label: string(topic.label, 'topic.label'),
    note: topic.note === null ? null : string(topic.note, 'topic.note'),
    tags: array(topic.tags, 'topic.tags').map((tag, i) => string(tag, `topic.tags[${i}]`)),
    state: parseTopicState(topic.state),
    sessions: array(topic.sessions, 'topic.sessions').map((value, i) => {
      const at = `topic.sessions[${i}]`;
      const session = object(value, at);
      return {
        id: sessionId(session.id, `${at}.id`),
        name: string(session.name, `${at}.name`),
        windows: array(session.windows, `${at}.windows`).map((window, w) =>
          parseWindow(window, `${at}.windows[${w}]`),
        ),
      };
    }),
  };
}

function parseWindow(value: unknown, at: string): TopicWindow {
  const window = object(value, at);
  return {
    id: string(window.id, `${at}.id`),
    index: number(window.index, `${at}.index`),
    name: string(window.name, `${at}.name`),
    mark: strongest(
      array(window.panes, `${at}.panes`).map((pane, p) =>
        agentMark(object(pane, `${at}.panes[${p}]`).agent),
      ),
    ),
  };
}

/**
 * The mark of one Pane's Agent, by desktop Muxify's rule: working shows while
 * it works, blocked while it stays blocked, and done and failed only while
 * Unread. The phone cannot read the Mac's `notifications.*_enabled`, so it
 * shows every kind.
 */
function agentMark(agent: unknown): AgentMark | null {
  if (typeof agent !== 'object' || agent === null) return null;
  const { status, unread } = agent as { status?: unknown; unread?: unknown };
  switch (status) {
    case 'working':
    case 'blocked':
      return status;
    case 'done':
    case 'failed':
      return unread === true ? status : null;
    default:
      return null;
  }
}

function strongest(marks: (AgentMark | null)[]): AgentMark | null {
  return marks.reduce<AgentMark | null>(
    (best, mark) =>
      mark !== null && (best === null || AGENT_MARKS.indexOf(mark) > AGENT_MARKS.indexOf(best))
        ? mark
        : best,
    null,
  );
}

/** What one read of a Topic came to. */
export type TopicRead = { kind: 'shown'; topic: TopicDetail } | { kind: 'failed'; error: string };

/**
 * What the Topic Screen holds. A read in flight and a failed read both keep
 * the last answer, so a return to the screen does not blank it and a Host
 * that drops the Connection still shows what it last said.
 */
export type TopicView =
  | { kind: 'loading'; last: TopicDetail | null }
  | { kind: 'failed'; error: string; last: TopicDetail | null }
  | { kind: 'shown'; topic: TopicDetail };

export const TOPIC_UNASKED: TopicView = { kind: 'loading', last: null };

export function loadingTopic(previous: TopicView): TopicView {
  return { kind: 'loading', last: lastTopic(previous) };
}

export function settledTopic(previous: TopicView, read: TopicRead): TopicView {
  return read.kind === 'failed' ? { ...read, last: lastTopic(previous) } : read;
}

export function lastTopic(view: TopicView): TopicDetail | null {
  return view.kind === 'shown' ? view.topic : view.last;
}
