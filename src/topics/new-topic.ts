import { topicId, type EnvironmentSnapshot, type TopicId } from './environment';
import { object } from './json-shape';

/** What one `topic new` came to: the new Topic, or the Host's reason it made none. */
export type NewTopicRead = { kind: 'created'; topic: TopicId } | { kind: 'failed'; error: string };

/** The id in the answer of `topic new --json`: `{"changed":{"topic_id":…}}`. */
export function parseNewTopic(json: unknown): TopicId {
  const changed = object(object(json, 'answer').changed, 'changed');
  return topicId(changed.topic_id, 'changed.topic_id');
}

/**
 * The Empty Topic with this title in a Listing, if any. It is how New Topic
 * checks a create the Host did not answer: a new Topic is Empty.
 */
export function emptyTopicTitled(snapshot: EnvironmentSnapshot, title: string): TopicId | undefined {
  const { pinned, unpinned } = snapshot;
  for (const card of [...pinned, ...unpinned.places, ...unpinned.guests, ...unpinned.bench]) {
    if (card.kind === 'topic' && card.topic.state === 'empty' && card.topic.label === title) return card.topic.id;
  }
  return undefined;
}
