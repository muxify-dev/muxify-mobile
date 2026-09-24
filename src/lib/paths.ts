/**
 * The last part of a path, which is the part that identifies it.
 *
 * Pane tiles are labelled with this. A phone-width tile cannot hold
 * `/home/ubuntu/projects/muxify`, and truncating it would cut off the only
 * segment that differs between two Panes of the same Session.
 */
export function directoryName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return path === '' ? '' : '/';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}
