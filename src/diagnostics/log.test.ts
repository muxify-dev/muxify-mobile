import { createTestClock } from '@/lib/test-clock';

import { createLog, formatEntry, LOG_LINE_LIMIT, speakingAs, timeOfDay } from './log';

describe('recording', () => {
  it('keeps what was said, who said it, and when', () => {
    const clock = createTestClock(1000);
    const log = createLog({ clock });

    log.record('attach', 'connected');
    clock.advance(250);
    log.record('pane %1', 'grid 49x41');

    expect(log.entries()).toEqual([
      { at: 1000, tag: 'attach', text: 'connected' },
      { at: 1250, tag: 'pane %1', text: 'grid 49x41' },
    ]);
  });

  it('lets the oldest go once it is full', () => {
    const log = createLog({ capacity: 3, clock: createTestClock() });
    for (const word of ['one', 'two', 'three', 'four', 'five']) log.record('t', word);

    expect(log.entries().map((entry) => entry.text)).toEqual(['three', 'four', 'five']);
  });

  it('cuts a line that would crowd the others out', () => {
    const log = createLog({ clock: createTestClock() });
    log.record('t', 'x'.repeat(LOG_LINE_LIMIT * 3));

    const [entry] = log.entries();
    expect(entry.text.length).toBe(LOG_LINE_LIMIT);
    expect(entry.text.endsWith('…')).toBe(true);
  });

  it('hands back a copy, so a reader cannot change the record', () => {
    const log = createLog({ clock: createTestClock() });
    log.record('t', 'kept');
    const seen = log.entries() as unknown[];
    seen.length = 0;

    expect(log.entries()).toHaveLength(1);
  });

  it('can be cleared to start a fresh reproduction', () => {
    const log = createLog({ clock: createTestClock() });
    log.record('t', 'before');
    log.clear();
    log.record('t', 'after');

    expect(log.entries().map((entry) => entry.text)).toEqual(['after']);
  });

  it('speaks as one part of the app without repeating its name', () => {
    const log = createLog({ clock: createTestClock() });
    const say = speakingAs(log, 'sizing');
    say('settled 49x41');

    expect(log.entries()).toEqual([{ at: 0, tag: 'sizing', text: 'settled 49x41' }]);
  });
});

describe('reading it back', () => {
  it('renders one line per entry, oldest first, with the time of day', () => {
    const clock = createTestClock(Date.UTC(2026, 8, 21, 12, 0, 0, 5));
    const log = createLog({ clock });
    log.record('attach', 'connecting');
    clock.advance(1500);
    log.record('topology', '1 window');

    const lines = log.render().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.005 attach {5}connecting$/);
    expect(lines[1]).toMatch(/^\d\d:\d\d:\d\d\.505 topology {3}1 window$/);
  });

  it('formats the time to the millisecond and pads the tag to a column', () => {
    const at = new Date(2026, 8, 21, 9, 5, 3, 42).getTime();
    expect(timeOfDay(at)).toBe('09:05:03.042');
    expect(formatEntry({ at, tag: 'x', text: 'y' })).toBe('09:05:03.042 x          y');
  });
});
