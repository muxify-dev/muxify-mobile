/** Thresholds in seconds, largest unit last, with the label each one earns. */
const UNITS: { seconds: number; short: string; plural: string }[] = [
  { seconds: 60, short: 'min', plural: 'min' },
  { seconds: 60 * 60, short: 'hr', plural: 'hr' },
  { seconds: 60 * 60 * 24, short: 'day', plural: 'days' },
  { seconds: 60 * 60 * 24 * 7, short: 'wk', plural: 'wk' },
  { seconds: 60 * 60 * 24 * 30, short: 'mo', plural: 'mo' },
  { seconds: 60 * 60 * 24 * 365, short: 'yr', plural: 'yr' },
];

/**
 * How long ago something happened, in the abbreviated form iOS uses: "just
 * now", "2 min ago", "14 hr ago", "3 days ago".
 *
 * A plain function rather than `Intl.RelativeTimeFormat` because the exact
 * wording is part of the design — remux shows "2 hr ago" and Intl's engines
 * disagree about whether that is "2 hr. ago" — and because a pure function of
 * two dates can be tested without pinning a locale.
 *
 * Anything in the future reads as just now: a Host whose clock runs fast
 * should not produce "in 3 hours".
 */
export function timeAgo(then: Date, now: Date): string {
  const elapsed = (now.getTime() - then.getTime()) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 60) return 'just now';

  let unit = UNITS[0];
  for (const candidate of UNITS) {
    if (elapsed >= candidate.seconds) unit = candidate;
  }
  const count = Math.floor(elapsed / unit.seconds);
  return `${count} ${count === 1 ? unit.short : unit.plural} ago`;
}

/** The same, from a stored ISO timestamp. An unreadable one reads as never. */
export function timeAgoFrom(iso: string, now: Date): string | undefined {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return undefined;
  return timeAgo(then, now);
}
