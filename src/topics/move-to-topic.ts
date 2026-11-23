import { openTopics, topicId, type EnvironmentSnapshot, type SessionId, type TopicId } from './environment';
import { object } from './json-shape';

/** Where Move to Topic puts a Session: an open Topic, or a new Topic with this title. */
export type MoveDestination = { kind: 'topic'; topic: TopicId } | { kind: 'new-topic'; title: string };

/** The Topic a moved Session is in now. */
export interface Moved {
  topic: TopicId;
}

/** The answer of `move`, MuxifyCore's `TopicChange`: `{"changed":{"topic_id":…}}`. */
export function parseMoved(json: unknown): Moved {
  const changed = object(object(json, 'answer').changed, 'changed');
  return { topic: topicId(changed.topic_id, 'changed.topic_id') };
}

/**
 * The Topic the Session is in when a Listing shows the move done, or null.
 * It is how the sheet checks a move the Host did not answer: the Session
 * keeps its tmux id, and a new Topic is known by its title.
 */
export function movedTopic(snapshot: EnvironmentSnapshot, session: SessionId, to: MoveDestination): TopicId | null {
  const topic = snapshot.sessions.find((each) => each.id === session)?.topic ?? null;
  if (topic === null) return null;
  if (to.kind === 'topic') return topic === to.topic ? topic : null;
  return openTopics(snapshot).some((each) => each.id === topic && each.label === to.title) ? topic : null;
}
