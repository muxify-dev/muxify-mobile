import { timeAgo, timeAgoFrom } from './relative-time';

const NOW = new Date('2026-09-15T12:00:00Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('timeAgo', () => {
  it('reads anything under a minute as just now', () => {
    expect(timeAgo(ago(0), NOW)).toBe('just now');
    expect(timeAgo(ago(59), NOW)).toBe('just now');
  });

  it('counts whole minutes, then whole hours', () => {
    expect(timeAgo(ago(60), NOW)).toBe('1 min ago');
    expect(timeAgo(ago(119), NOW)).toBe('1 min ago');
    expect(timeAgo(ago(60 * 60 * 2), NOW)).toBe('2 hr ago');
    expect(timeAgo(ago(60 * 60 * 14), NOW)).toBe('14 hr ago');
  });

  it('pluralises only days, as iOS does', () => {
    expect(timeAgo(ago(60 * 60 * 24), NOW)).toBe('1 day ago');
    expect(timeAgo(ago(60 * 60 * 24 * 3), NOW)).toBe('3 days ago');
    expect(timeAgo(ago(60 * 60 * 24 * 14), NOW)).toBe('2 wk ago');
  });

  it('never counts forwards', () => {
    // A Host whose clock runs fast must not produce "in 3 hours".
    expect(timeAgo(new Date(NOW.getTime() + 60 * 60 * 1000), NOW)).toBe('just now');
  });

  it('climbs to the largest unit that fits', () => {
    expect(timeAgo(ago(60 * 60 * 24 * 45), NOW)).toBe('1 mo ago');
    expect(timeAgo(ago(60 * 60 * 24 * 400), NOW)).toBe('1 yr ago');
  });
});

describe('timeAgoFrom', () => {
  it('reads a stored timestamp', () => {
    expect(timeAgoFrom('2026-09-15T10:00:00Z', NOW)).toBe('2 hr ago');
  });

  it('says nothing at all about an unreadable one', () => {
    // A record hand-edited or written by an older build should leave the row
    // without a subtitle, not print "NaN hr ago" under the Session's name.
    expect(timeAgoFrom('not a date', NOW)).toBeUndefined();
  });
});
