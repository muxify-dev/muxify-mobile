/**
 * The colour of a Tag, as the Host's Config writes it: a system colour name or
 * `#rrggbb`, the rule that desktop Muxify's `MarkColor.Single` parses.
 */

export type SystemColorName =
  | 'blue'
  | 'orange'
  | 'red'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'pink'
  | 'teal'
  | 'gray';

export type TagColor =
  /** Adapts to the appearance, as the system colour of that name does on the Mac. */
  | { kind: 'system'; name: SystemColorName }
  /** The same in both appearances. Lower case, as `#rrggbb`. */
  | { kind: 'rgb'; hex: string };

export type ColorAppearance = 'light' | 'dark';

/**
 * The iOS system colours for each name, light then dark. The Mac's system
 * colours of the same names are the same hues, so a Tag looks the same on
 * both devices.
 */
const SYSTEM_COLORS: Record<SystemColorName, Record<ColorAppearance, string>> = {
  blue: { light: '#007aff', dark: '#0a84ff' },
  orange: { light: '#ff9500', dark: '#ff9f0a' },
  red: { light: '#ff3b30', dark: '#ff453a' },
  green: { light: '#34c759', dark: '#30d158' },
  yellow: { light: '#ffcc00', dark: '#ffd60a' },
  purple: { light: '#af52de', dark: '#bf5af2' },
  pink: { light: '#ff2d55', dark: '#ff375f' },
  teal: { light: '#30b0c7', dark: '#40c8e0' },
  gray: { light: '#8e8e93', dark: '#8e8e93' },
};

const SYSTEM_COLOR_NAMES = Object.keys(SYSTEM_COLORS) as SystemColorName[];

/** A colour this phone does not know is null: the Tag shows with no colour, never a failed read. */
export function parseTagColor(text: string): TagColor | null {
  const value = text.trim().toLowerCase();
  const name = SYSTEM_COLOR_NAMES.find((candidate) => candidate === value);
  if (name !== undefined) return { kind: 'system', name };
  return /^#[0-9a-f]{6}$/.test(value) ? { kind: 'rgb', hex: value } : null;
}

/** The `#rrggbb` to draw a Tag colour with, in the given appearance. */
export function tagColorHex(color: TagColor, appearance: ColorAppearance): string {
  return color.kind === 'rgb' ? color.hex : SYSTEM_COLORS[color.name][appearance];
}
