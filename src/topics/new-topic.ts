import { parseTags, topicId, type Tag, type TopicId } from './environment';
import { object } from './json-shape';
import type { TagColor } from './tag-color';

/** What one `topic new` came to: the new Topic, or the Host's reason it made none. */
export type NewTopicRead = { kind: 'created'; topic: TopicId } | { kind: 'failed'; error: string };

/** The id in the answer of `topic new --json`: `{"changed":{"topic_id":…}}`. */
export function parseNewTopic(json: unknown): TopicId {
  const changed = object(object(json, 'answer').changed, 'changed');
  return topicId(changed.topic_id, 'changed.topic_id');
}

/**
 * The Tags as a route param, for the New Topic sheet. They go in the shape
 * `environment show` writes them, so the sheet reads them back with the same
 * parse as the Host Screen did.
 */
export function tagsParam(tags: Tag[]): string {
  return JSON.stringify(
    tags.map(({ name, color }) => ({
      name,
      color: { light: colorText(color.light), dark: colorText(color.dark) },
    })),
  );
}

/** A route param is open to any deep link, so a bad one gives no Tags rather than a crash. */
export function tagsFromParam(param: string | undefined): Tag[] {
  if (param === undefined) return [];
  try {
    return parseTags(JSON.parse(param));
  } catch {
    return [];
  }
}

/** The Config's own spelling of a colour. An empty one parses back to null. */
function colorText(color: TagColor | null): string {
  if (color === null) return '';
  return color.kind === 'system' ? color.name : color.hex;
}
