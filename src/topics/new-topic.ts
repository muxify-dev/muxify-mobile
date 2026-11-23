import { openTopics, topicId, type EnvironmentSnapshot, type TopicId } from './environment';
import { object } from './json-shape';
import type { UnknownOutcome } from './request';

/**
 * What one `create` came to: the new Topic, the Host's reason it made none,
 * or a Request in doubt, when the Host may have made it.
 */
export type NewTopicRead = { kind: 'created'; topic: TopicId } | { kind: 'failed'; error: string } | UnknownOutcome;

/** The id in the answer of `create`: `{"changed":{"topic_id":…}}`. */
export function parseNewTopic(json: unknown): TopicId {
  const changed = object(object(json, 'answer').changed, 'changed');
  return topicId(changed.topic_id, 'changed.topic_id');
}

/**
 * The Empty Topic with this title in a Listing, if any. It is how New Topic
 * checks a create the Host did not answer: a new Topic is Empty.
 */
export function emptyTopicTitled(snapshot: EnvironmentSnapshot, title: string): TopicId | undefined {
  return openTopics(snapshot).find((topic) => topic.state === 'empty' && topic.label === title)?.id;
}
