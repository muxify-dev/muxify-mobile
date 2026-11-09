/**
 * Cuts captured content down to what a preview box can actually show.
 *
 * Trailing blank lines go first: a shell Pane is mostly empty below the
 * prompt, and a preview of nothing tells the user nothing. Interior blanks
 * stay, because they are part of what the Pane looks like.
 */
export function trimPreview(lines: string[], maxLines: number, maxColumns: number): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;

  return lines.slice(0, Math.max(0, Math.min(end, maxLines))).map((line) =>
    line.length > maxColumns ? line.slice(0, maxColumns) : line,
  );
}
