import { parseMark, parseTopicState, sessionId, topicId, type BoardSessionId, type Mark, type SessionId, type TopicId, type TopicState } from './environment';
import { array, number, object, string } from './json-shape';

export type GoToTarget =
  | { topic: { id: TopicId; state: TopicState } }
  | { settled: { id: TopicId } }
  | { board_session: { id: BoardSessionId } }
  | { session: { id: SessionId; name: string } }
  | { session_path: { directory: string; name: string } }
  | { tag: { name: string } };

export interface GoToText { text: string; marks: number[] }
export interface HostGoToRow {
  id: string;
  kind: string;
  title: GoToText;
  detail: GoToText;
  tags: GoToText[];
  trailing: string;
  mark: Mark | null;
  target: GoToTarget;
}
export interface GoToSection { id: string; title: string | null; rows: HostGoToRow[] }

function target(value: unknown): GoToTarget {
  const t = object(value, 'target');
  if ('topic' in t) {
    const topic = object(t.topic, 'topic');
    return { topic: { id: topicId(topic.id, 'topic.id'), state: parseTopicState(topic.state) } };
  }
  if ('settled' in t) return { settled: { id: topicId(object(t.settled, 'settled').id, 'settled.id') } };
  if ('board_session' in t) return { board_session: { id: string(object(t.board_session, 'board_session').id, 'board_session.id') as BoardSessionId } };
  if ('session' in t) {
    const session = object(t.session, 'session');
    return { session: { id: sessionId(session.id, 'session.id'), name: string(session.name, 'session.name') } };
  }
  if ('session_path' in t) {
    const path = object(t.session_path, 'session_path');
    return { session_path: { name: string(path.name, 'session_path.name'), directory: string(path.directory, 'session_path.directory') } };
  }
  if ('tag' in t) return { tag: { name: string(object(t.tag, 'tag').name, 'tag.name') } };
  throw new Error('Unknown Go to target.');
}

function marked(value: unknown): GoToText {
  const part = object(value, 'marked text');
  return { text: string(part.text, 'text'), marks: array(part.marks, 'marks').map((mark) => number(mark, 'mark offset')) };
}

export function parseGoToSections(value: unknown): GoToSection[] {
  return array(object(value, 'go_to').sections, 'sections').map((entry) => {
    const section = object(entry, 'section');
    return {
      id: string(section.id, 'section.id'), title: section.title === null ? null : string(section.title, 'section.title'),
      rows: array(section.rows, 'rows').map((item) => {
        const row = object(item, 'row');
        return {
          id: string(row.id, 'row.id'), kind: string(row.kind, 'row.kind'), title: marked(row.title), detail: marked(row.detail),
          tags: array(row.tags, 'row.tags').map(marked), trailing: string(row.trailing, 'row.trailing'), mark: parseMark(row.mark),
          target: target(row.target),
        };
      }),
    };
  });
}
