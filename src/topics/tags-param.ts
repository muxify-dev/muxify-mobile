import { parseTags, type Tag } from './environment';
import type { TagColor } from './tag-color';

/**
 * The Config's Tags as a route param, from the Host Screen's last read to the
 * Topic Screen and its sheets. They go in the shape `environment show` writes
 * them, so a screen reads them back with the same parse as the Host Screen did.
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
