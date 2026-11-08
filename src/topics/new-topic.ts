import { topicId, type TopicId } from './environment';
import { object } from './json-shape';

/** What one `topic new` came to: the new Topic, or the Host's reason it made none. */
export type NewTopicRead = { kind: 'created'; topic: TopicId } | { kind: 'failed'; error: string };

/** The id in the answer of `topic new --json`: `{"changed":{"topic_id":…}}`. */
export function parseNewTopic(json: unknown): TopicId {
  const changed = object(object(json, 'answer').changed, 'changed');
  return topicId(changed.topic_id, 'changed.topic_id');
}
