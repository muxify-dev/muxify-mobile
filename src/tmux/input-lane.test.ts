import {
  isSafeKey,
  judge,
  newLane,
  noticeOf,
  pendingKeys,
  previewOf,
  step,
  toDraftText,
  type DeliverResult,
  type Effect,
  type Key,
  type Lane,
  type LaneEvent,
  type Typed,
  type MessageId,
  type PaneMark,
  type Seq,
} from './input-lane';

const seq = (value: number) => value as Seq;
const text = (value: string): Key => ({ kind: 'text', bytes: [...new TextEncoder().encode(value)], gesture: false });
const wheel = (value: string): Key => ({ kind: 'text', bytes: [...new TextEncoder().encode(value)], gesture: true });
const message = 'm1' as MessageId;
const named = (key: string): Key => ({ kind: 'key', key });
const paste = (value: string, submit = false): Key => ({ kind: 'paste', text: value, message: submit ? message : null });
const clear: Key = { kind: 'clear' };
const typed = (key: Key): LaneEvent => ({ kind: 'typed', key });
const mark = (over: Partial<PaneMark> = {}): PaneMark => ({
  serverPid: 100,
  panePid: 200,
  program: 'zsh',
  ack: null,
  refusesCopies: true,
  ...over,
});
const answered = (result: DeliverResult): LaneEvent => ({ kind: 'answered', result });
const parked = (...keys: Key[]): LaneEvent => ({ kind: 'parked', keys: keys.map((key): Typed => ({ ...key, typedAt: 1_000 })) });

/**
 * A Lane with the Outbox's part played by hand: the clock, and the Seq count
 * that only grows. Every effect the Lane asked for is kept in order.
 */
function driver(connected: boolean, options: { maxBatchBytes?: number; ttlMs?: number } = {}) {
  let lane: Lane = newLane('%1', connected);
  let nextSeq = 1;
  let now = 1_000;
  const effects: Effect[] = [];
  return {
    get lane() {
      return lane;
    },
    effects,
    /** The Batches written so far, as `seq:preview`. */
    delivered: () =>
      effects.flatMap((effect) => (effect.kind === 'deliver' ? [`${effect.batch.seq}:${previewOf([effect.batch.key])}`] : [])),
    wait(ms: number) {
      now += ms;
    },
    send(...events: LaneEvent[]) {
      for (const event of events) {
        const next = step(lane, event, {
          now,
          ttlMs: options.ttlMs ?? 30_000,
          maxBatchBytes: options.maxBatchBytes ?? 2048,
          nextSeq: seq(nextSeq),
        });
        if (next.lane.unconfirmed?.seq === nextSeq) nextSeq += 1;
        lane = next.lane;
        effects.push(...next.effects);
      }
    },
  };
}

/** A Lane that is live, with a witness, and nothing pending. */
function live() {
  const run = driver(true);
  run.send(answered(mark()));
  run.effects.length = 0;
  return run;
}

describe('a live Lane', () => {
  it('reads the mark of a new Pane before it sends, and then sends what was typed meanwhile', () => {
    const run = driver(true);
    run.send(typed(text('ls')), typed(named('Enter')));
    expect(run.delivered()).toEqual([]);
    run.send(answered(mark()));
    expect(run.delivered()).toEqual(['1:ls']);
    expect(run.lane.phase).toEqual({ kind: 'live' });
  });

  it('has one Batch in flight, and merges the text typed during the round trip', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')), typed(text('c')));
    expect(run.delivered()).toEqual(['1:a']);
    run.send(answered(mark({ ack: seq(1) })));
    expect(run.delivered()).toEqual(['1:a', '2:bc']);
  });

  it('sends one Key in each Batch, in the order typed', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')), typed(named('Up')), typed(text('c')), typed(named('Enter')));
    for (const ack of [1, 2, 3, 4]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:a', '2:b', '3:↑', '4:c', '5:⏎']);
  });

  it('splits text that is longer than one line can carry', () => {
    const run = driver(true, { maxBatchBytes: 4 });
    run.send(answered(mark()), typed(text('x')), typed(text('abcdefghij')));
    for (const ack of [1, 2, 3]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:x', '2:abcd', '3:efgh', '4:ij']);
  });

  it('splits long text between characters, never inside one', () => {
    const run = driver(true, { maxBatchBytes: 4 });
    run.send(answered(mark()), typed(text('x')), typed(text('aé漢b')));
    for (const ack of [1, 2, 3]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:x', '2:aé', '3:漢b']);
  });

  it('removes a Batch only when the mark covers its Seq', () => {
    const run = live();
    run.send(typed(text('a')), answered(mark({ ack: null })));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['unsure-delivered'] });
    expect(pendingKeys(run.lane)).toEqual([text('a')]);
  });

  it('holds a Batch that tmux refused', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')), answered({ refused: 'yacc stack overflow' }));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['refused'] });
    expect(pendingKeys(run.lane)).toEqual([text('a'), text('b')]);
  });

  it('discards everything when the Pane has gone', () => {
    const run = live();
    run.send(typed(text('a')), typed(named('Enter')), answered('gone'));
    expect(noticeOf(run.lane)).toEqual({
      kind: 'discarded',
      paneId: '%1',
      preview: 'a⏎',
      reason: 'pane-gone',
      message: false,
    });
    expect(pendingKeys(run.lane)).toEqual([]);
  });
});

describe('a Lane across a break', () => {
  it('sends the unconfirmed Batch again with the same Seq and the same Key', () => {
    const run = live();
    run.send(typed(text('abc')), typed(text('def')), { kind: 'lost' }, { kind: 'connected' });
    expect(run.effects.at(-1)).toEqual({ kind: 'read' });
    run.send(answered(mark()));
    expect(run.delivered()).toEqual(['1:abc', '1:abc']);
    run.send(answered(mark({ ack: seq(1) })));
    expect(run.delivered()).toEqual(['1:abc', '1:abc', '2:def']);
  });

  it('does not send a Batch again when the Pane already has it', () => {
    const run = live();
    run.send(typed(text('abc')), { kind: 'lost' }, typed(text('def')), { kind: 'connected' });
    run.send(answered(mark({ ack: seq(1) })));
    expect(run.delivered()).toEqual(['1:abc', '2:def']);
  });

  it('keeps the order of keys typed while there is no Connection', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('a')), typed(named('Left')), typed(text('b')));
    expect(run.delivered()).toEqual([]);
    expect(noticeOf(run.lane)).toEqual({ kind: 'waiting', paneId: '%1', preview: 'a←b' });
    run.send({ kind: 'connected' }, answered(mark()));
    for (const ack of [1, 2]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:a', '2:←', '3:b']);
  });

  it('sends nothing before the mark of the new Connection is back', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('a')), { kind: 'connected' }, typed(text('b')));
    expect(run.delivered()).toEqual([]);
  });

  it('ignores an answer that arrives after the Connection ended', () => {
    const run = live();
    run.send(typed(text('a')), { kind: 'lost' }, answered(mark({ ack: seq(1) })));
    expect(pendingKeys(run.lane)).toEqual([text('a')]);
  });

  it('holds risky keys, and the keys typed after them wait behind', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('ls')), typed(named('Enter')), { kind: 'connected' }, answered(mark()));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['risky-keys'] });
    run.send(typed(text('pwd')));
    expect(run.delivered()).toEqual([]);
    expect(noticeOf(run.lane)).toMatchObject({ kind: 'held', preview: 'ls⏎pwd' });
  });

  it('sends held keys once, in order, when the user says Send', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('ls')), typed(named('Enter')), { kind: 'connected' }, answered(mark()));
    run.send({ kind: 'released' });
    for (const ack of [1, 2]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:ls', '2:⏎']);
    expect(noticeOf(run.lane)).toBeNull();
  });

  it('asks again when a second break interrupts a Send', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(named('Enter')), { kind: 'connected' }, answered(mark()), { kind: 'released' });
    run.send({ kind: 'lost' }, { kind: 'connected' }, answered(mark()));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['risky-keys'] });
    expect(run.delivered()).toEqual(['1:⏎']);
  });

  it('empties a held Lane that the user took, and bars the line that may still arrive', () => {
    const run = live();
    run.send(typed(named('Enter')), { kind: 'lost' }, typed(text('x')), { kind: 'connected' }, answered(mark()));
    expect(run.lane.phase.kind).toBe('held');
    run.effects.length = 0;
    run.send({ kind: 'taken' });
    expect(run.effects).toEqual([{ kind: 'burn', seq: 1 }]);
    expect(pendingKeys(run.lane)).toEqual([]);
    run.send(typed(text('y')));
    expect(run.delivered()).toEqual(['2:y']);
  });

  it('writes the Seq of taken keys first on each Connection until a mark shows it', () => {
    const run = live();
    run.send(typed(named('Enter')), { kind: 'lost' }, { kind: 'connected' }, answered(mark()), { kind: 'taken' });
    run.send({ kind: 'lost' });
    run.effects.length = 0;
    run.send({ kind: 'connected' });
    expect(run.effects).toEqual([{ kind: 'burn', seq: 1 }, { kind: 'read' }]);
    run.send(answered(mark({ ack: seq(1) })), { kind: 'lost' });
    run.effects.length = 0;
    run.send({ kind: 'connected' });
    expect(run.effects).toEqual([{ kind: 'read' }]);
  });

  it('owes nothing once the answer to its burn shows the Seq', () => {
    const run = live();
    run.send(typed(named('Enter')), { kind: 'lost' }, { kind: 'connected' }, answered(mark()), { kind: 'taken' });
    run.send({ kind: 'burned', result: mark({ ack: seq(1) }) }, { kind: 'lost' });
    run.effects.length = 0;
    run.send({ kind: 'connected' });
    expect(run.effects).toEqual([{ kind: 'read' }]);
  });

  it('never uses a Seq again after a discard', () => {
    const run = live();
    run.send(typed(text('a')), answered(mark({ ack: seq(1) })), typed(text('b')), { kind: 'lost' }, { kind: 'connected' });
    run.send(answered(mark({ panePid: 999, ack: seq(1) })));
    expect(noticeOf(run.lane)).toMatchObject({ kind: 'discarded', reason: 'pane-replaced', preview: 'b' });
    run.send(typed(text('c')));
    expect(run.delivered()).toEqual(['1:a', '2:b', '3:c']);
  });

  it.each([
    ['the Pane was started again', { panePid: 999, ack: null }, 'pane-replaced'],
    ['the server started again', { serverPid: 101, ack: null }, 'server-restarted'],
  ] as [string, Partial<PaneMark>, string][])('bars the late line of keys it discarded because %s', (_, read, reason) => {
    const run = live();
    run.send(typed(text('a')), { kind: 'lost' }, { kind: 'connected' });
    run.effects.length = 0;
    run.send(answered(mark(read)));
    expect(noticeOf(run.lane)).toMatchObject({ kind: 'discarded', reason, preview: 'a' });
    expect(run.effects).toEqual([{ kind: 'burn', seq: 1 }]);
  });

  it('confirms a Batch that a started-again Pane took, and does not call it discarded', () => {
    const run = live();
    run.send(typed(text('a')), { kind: 'lost' }, { kind: 'connected' });
    run.effects.length = 0;
    run.send(answered(mark({ panePid: 999, ack: seq(1) })));
    expect(noticeOf(run.lane)).toBeNull();
    expect(run.lane.delivered).toBe(1);
    expect(run.effects).toEqual([]);
  });

  it('keeps a discarded notice until it is dismissed', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('a')), { kind: 'connected' }, answered('gone'), { kind: 'lost' });
    expect(noticeOf(run.lane)?.kind).toBe('discarded');
    run.send({ kind: 'dismissed' });
    expect(noticeOf(run.lane)).toBeNull();
  });
});

describe('keys of a Pane that was never made', () => {
  it('holds them for the user at once on a live Lane with nothing in flight, and sends none', () => {
    const run = live();
    run.send(parked(text('ls'), named('Enter')));

    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['verb-refused'] });
    expect(run.delivered()).toEqual([]);
    expect(noticeOf(run.lane)).toMatchObject({ kind: 'held', preview: 'ls⏎', reasons: ['verb-refused'] });
  });

  it('waits behind a Batch in flight, which is still confirmed, and then asks about every key behind it', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')), parked(text('cd')));
    expect(run.lane.phase).toEqual({ kind: 'live' });
    expect(run.delivered()).toEqual(['1:a']);

    run.send(answered(mark({ ack: seq(1) })));

    expect(run.lane.delivered).toBe(seq(1));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['verb-refused'] });
    expect(run.delivered()).toEqual(['1:a']);
    expect(pendingKeys(run.lane).map((key) => previewOf([key])).join('')).toBe('bcd');
  });

  it('keeps the other reason when the Batch in flight is refused', () => {
    const run = live();
    run.send(typed(text('a')), parked(text('b')), answered({ refused: 'tmux said no' }));

    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['refused', 'verb-refused'] });
  });

  it('adds its reason to a Lane that is held already, and Send types every key in order', () => {
    const run = live();
    run.send(typed(text('rm')), typed(named('Enter')));
    run.send(answered(mark({ ack: seq(1) })));
    run.send(typed(named('C-c')), answered(mark({ ack: seq(2) })));
    run.send(answered(mark({ program: 'vim' })));
    run.send(typed(text('x')), { kind: 'lost' }, { kind: 'connected' }, answered(mark({ program: 'vim', ack: seq(3) })));
    expect(run.lane.phase.kind).toBe('held');

    run.send(parked(text('yz')))
    expect(run.lane.phase).toMatchObject({ kind: 'held', reasons: expect.arrayContaining(['program-changed', 'verb-refused']) });

    run.send({ kind: 'released' }, answered(mark({ program: 'vim', ack: seq(4) })));
    expect(run.delivered().slice(-2)).toEqual(['4:x', '5:yz']);
  });

  it('holds them on a Lane with no Connection, and asks when the Connection comes back', () => {
    const run = driver(false);
    run.send(parked(text('ls')));
    expect(run.lane.phase).toEqual({ kind: 'adrift' });

    run.send({ kind: 'connected' }, answered(mark()));

    expect(run.lane.phase).toEqual({ kind: 'held', reasons: expect.arrayContaining(['verb-refused']) });
    expect(run.delivered()).toEqual([]);
  });

  it('discards them with the Lane when the Pane is gone', () => {
    const run = live();
    run.send(typed(text('a')), parked(text('b')), answered('gone'));

    expect(run.lane.phase).toEqual({ kind: 'live' });
    expect(run.lane.dropped).toMatchObject({ reason: 'pane-gone' });
    expect(run.lane.parking).toBe(false);
  });

  it('gives them back with Move to Composer', () => {
    const run = live();
    run.send(parked(text('ls')));

    run.send({ kind: 'taken' });

    expect(run.lane.phase).toEqual({ kind: 'live' });
    expect(run.lane.waiting).toEqual([]);
    expect(run.lane.parking).toBe(false);
  });

  it('puts nothing on the Lane for no keys', () => {
    const run = live();
    run.send(parked());
    expect(run.lane.phase).toEqual({ kind: 'live' });
  });
});

describe('a clear', () => {
  it('lands after the text that waits before it, as a Batch of its own', () => {
    const run = live();
    run.send(typed(text('ls')), typed(clear), typed(text('x')));
    for (const ack of [1, 2]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:ls', '2:Clear', '3:x']);
  });

  it('is held after a break, as a control key is', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(clear), { kind: 'connected' }, answered(mark()));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['risky-keys'] });
    expect(noticeOf(run.lane)).toMatchObject({ preview: 'Clear', draft: { text: '', dropped: ['Clear'] } });
  });
});

describe('a paste', () => {
  it('lands after the text that waits before it, and is never merged with it', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')), typed(paste('xyz')), typed(text('c')));
    for (const ack of [1, 2, 3]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.delivered()).toEqual(['1:a', '2:b', '3:xyz', '4:c']);
  });

  it('keeps its place behind keys typed while there is no Connection', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('ls ')), typed(paste('-la')), { kind: 'connected' }, answered(mark()));
    run.send(answered(mark({ ack: seq(1) })));
    expect(run.delivered()).toEqual(['1:ls ', '2:-la']);
  });

  it('is one Batch, however long', () => {
    const run = driver(true, { maxBatchBytes: 4 });
    run.send(answered(mark()), typed(paste('abcdefghij')));
    expect(run.delivered()).toEqual(['1:abcdefghij']);
  });

  it('is confirmed without a resend when the Pane took it before the break', () => {
    const run = live();
    run.send(typed(paste('a\nb', true)), { kind: 'lost' }, { kind: 'connected' }, answered(mark({ ack: seq(1) })));
    expect(run.delivered()).toEqual(['1:a⏎b⏎']);
    expect(run.lane.phase).toEqual({ kind: 'live' });
    expect(noticeOf(run.lane)).toBeNull();
  });

  it('is sent again with the same Seq when it is plain text and fresh', () => {
    const run = live();
    run.send(typed(paste('hello')), { kind: 'lost' }, { kind: 'connected' }, answered(mark()));
    expect(run.delivered()).toEqual(['1:hello', '1:hello']);
  });

  it('is held after a break on a Host that cannot refuse a copy, which a late line can paste', () => {
    const run = live();
    run.send(typed(paste('hello')), { kind: 'lost' }, { kind: 'connected' }, answered(mark({ refusesCopies: false })));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['unguarded'] });
    expect(run.delivered()).toEqual(['1:hello']);
  });

  it('that was never written goes after a break also on a Host that cannot refuse a copy', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(paste('hello')), { kind: 'connected' }, answered(mark({ refusesCopies: false })));
    expect(run.delivered()).toEqual(['1:hello']);
  });

  it.each([
    ['a newline', paste('a\nb')],
    ['a Send', paste('ls', true)],
  ])('with %s is held after a break', (_, key) => {
    const run = live();
    run.send(typed(key), { kind: 'lost' }, { kind: 'connected' }, answered(mark()));
    expect(run.lane.phase).toEqual({ kind: 'held', reasons: ['risky-keys'] });
    expect(run.delivered()).toHaveLength(1);
  });
});

describe('gesture bytes', () => {
  it('go to a live Pane like typed bytes, apart from them', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')), typed(wheel('W')), typed(wheel('W')), typed(text('c')));
    for (const ack of [1, 2, 3]) run.send(answered(mark({ ack: seq(ack) })));
    expect(run.effects.filter((effect) => effect.kind === 'deliver').map((effect) => effect.batch.key)).toEqual([
      text('a'),
      text('b'),
      wheel('WW'),
      text('c'),
    ]);
  });

  it('are dropped on a break, in flight or waiting, and counted', () => {
    const run = live();
    run.send(typed(wheel('W')), typed(text('a')), typed(wheel('W')), { kind: 'lost' });
    expect(run.effects.at(-1)).toEqual({ kind: 'gestures-dropped', count: 2 });
    expect(run.lane.unconfirmed).toBeNull();
    expect(run.lane.waiting.map((key) => key.kind === 'text' && key.gesture)).toEqual([false]);
  });

  it('are dropped when made with no live Pane, and never shown', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(wheel('W')));
    expect(run.effects.at(-1)).toEqual({ kind: 'gestures-dropped', count: 1 });
    expect(noticeOf(run.lane)).toBeNull();
  });

  it('are not held when tmux refuses them', () => {
    const run = live();
    run.send(typed(wheel('W')), typed(text('a')), answered({ refused: 'no' }));
    expect(run.lane.phase).toEqual({ kind: 'live' });
    expect(run.delivered()).toEqual(['1:', '2:a']);
  });
});

describe('the verdict on a new Connection', () => {
  const witness = mark({ ack: seq(4) });
  const fresh = { waiting: [], unconfirmed: null, witness, delivered: seq(4), crossed: true, now: 10_000, ttlMs: 30_000 };
  const waiting = (...keys: Key[]) => keys.map((key) => ({ ...key, typedAt: 9_000 }));
  const batch = { seq: seq(5), key: text('abc'), typedAt: 9_000 };

  it.each([
    ['the Pane is gone', { waiting: waiting(text('a')), read: 'gone' as const }, false, { kind: 'discard', reason: 'pane-gone' }],
    [
      'the server started again',
      { waiting: waiting(text('a')), read: mark({ serverPid: 101 }) },
      false,
      { kind: 'discard', reason: 'server-restarted' },
    ],
    [
      'another Pane has the id',
      { waiting: waiting(text('a')), read: mark({ panePid: 201, ack: seq(4) }) },
      false,
      { kind: 'discard', reason: 'pane-replaced' },
    ],
    [
      'another Pane has the id, and took the unconfirmed Batch',
      { unconfirmed: batch, read: mark({ panePid: 201, ack: seq(5) }) },
      true,
      { kind: 'discard', reason: 'pane-replaced' },
    ],
    ['the Pane has the unconfirmed Batch', { unconfirmed: batch, read: mark({ ack: seq(5) }) }, true, { kind: 'send' }],
    ['the Pane has a later Batch of this Outbox', { unconfirmed: batch, read: mark({ ack: seq(9) }) }, true, { kind: 'send' }],
    ['the Pane does not have the unconfirmed Batch', { unconfirmed: batch, read: mark({ ack: seq(4) }) }, false, { kind: 'send' }],
    ['safe text and arrows wait', { waiting: waiting(text('ls -la'), named('Up')), read: witness }, false, { kind: 'send' }],
    ['nothing is pending', { read: mark({ program: 'vim' }) }, false, { kind: 'send' }],
    ['Enter waits', { waiting: waiting(text('ls'), named('Enter')), read: witness }, false, { kind: 'hold', reasons: ['risky-keys'] }],
    ['a control byte waits', { waiting: waiting(text('\x03')), read: witness }, false, { kind: 'hold', reasons: ['risky-keys'] }],
    ['a Backspace waits', { waiting: waiting(text('ab\x7f')), read: witness }, false, { kind: 'hold', reasons: ['risky-keys'] }],
    [
      'the oldest key is older than the TTL',
      { waiting: [{ ...text('a'), typedAt: -20_001 }], read: witness },
      false,
      { kind: 'hold', reasons: ['stale'] },
    ],
    [
      'the Pane runs another program',
      { waiting: waiting(text('a')), read: mark({ program: 'vim', ack: seq(4) }) },
      false,
      { kind: 'hold', reasons: ['program-changed'] },
    ],
    [
      'tmux never said which Pane this was',
      { waiting: waiting(text('a')), witness: null, read: mark() },
      false,
      { kind: 'hold', reasons: ['unwitnessed'] },
    ],
    [
      'the number on the Pane went back',
      { unconfirmed: batch, read: mark({ ack: seq(2) }) },
      false,
      { kind: 'hold', reasons: ['unsure-delivered'] },
    ],
    [
      'several reasons at once',
      { unconfirmed: batch, waiting: waiting(named('C-c')), read: mark({ program: 'vim', ack: seq(5) }) },
      true,
      { kind: 'hold', reasons: ['program-changed', 'risky-keys'] },
    ],
    [
      'every key was typed on this Connection',
      { waiting: waiting(named('Enter')), crossed: false, read: mark({ program: 'vim', panePid: 9 }) },
      false,
      { kind: 'send' },
    ],
  ])('when %s', (_, over, acked, verdict) => {
    expect(judge({ ...fresh, ...over })).toEqual({ acked, verdict });
  });
});

describe('which keys are safe to send after a break', () => {
  it.each([
    [text('ls -la ~/x'), true],
    [text('héllo 漢字'), true],
    [text('\x1b[A\x1bOB\x1b[C\x1b[D'), true],
    [text('a\r'), false],
    [text('\t'), false],
    [text('\x7f'), false],
    [text('\x1b'), false],
    [text('\x1b[5~'), false],
    [paste('ls -la ~/x 漢字'), true],
    [paste('a\nb'), false],
    [paste('a\tb'), false],
    [paste('a\x7f'), false],
    [paste('ls', true), false],
    [named('Up'), true],
    [named('Left'), true],
    [named('~'), true],
    [named('Enter'), false],
    [named('C-c'), false],
    [named('M-b'), false],
    [named('Escape'), false],
    [{ kind: 'key', key: { key: 'Down', ctrl: false, alt: false, shift: false } }, true],
    [{ kind: 'key', key: { key: 'a', ctrl: false, alt: false, shift: true } }, true],
    [{ kind: 'key', key: { key: 'Down', ctrl: false, alt: false, shift: true } }, false],
    [{ kind: 'key', key: { key: 'c', ctrl: true, alt: false, shift: false } }, false],
    [{ kind: 'key', key: { key: 'Enter', ctrl: false, alt: false, shift: true } }, false],
    [clear, false],
  ] as [Key, boolean][])('%j is %s', (key, safe) => {
    expect(isSafeKey(key)).toBe(safe);
  });
});

describe('held keys as the user reads them, and as a Draft', () => {
  const press = (key: string, over: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {}): Key => ({
    kind: 'key',
    key: { key, ctrl: false, alt: false, shift: false, ...over },
  });

  it.each([
    [[text('ls -la'), named('Enter')], 'ls -la⏎', 'ls -la\n', []],
    [[text('ls\r')], 'ls⏎', 'ls\n', []],
    [[named('Up'), named('Up'), text('x')], '↑↑x', 'x', ['↑']],
    [[text('git'), named('Tab'), named('C-c'), named('Escape')], 'git⇥^CEsc', 'git\t', ['^C', 'Esc']],
    [[text('ls -la\x7fl')], 'ls -la⌫l', 'ls -ll', []],
    [[text('\x7fx')], '⌫x', 'x', ['⌫']],
    [[text('a\x03\x1b[Ab\x1b')], 'a^C↑bEsc', 'ab', ['^C', '↑', 'Esc']],
    [[text('é漢')], 'é漢', 'é漢', []],
    [[press('a', { shift: true }), press('Enter', { shift: true }), press('r', { ctrl: true })], 'A⏎^R', 'A\n', ['^R']],
    [[press('b', { alt: true }), named('M-.'), named('PageUp')], 'M-bM-.PageUp', '', ['M-b', 'M-.', 'PageUp']],
    [[text('a'), wheel('\x1b[<64;1;1M'), text('b')], 'ab', 'ab', []],
    [[paste('one\r\ntwo')], 'one⏎two', 'one\ntwo', []],
    [[paste('echo hi', true)], 'echo hi⏎', 'echo hi', []],
    [[text('ls'), clear], 'lsClear', 'ls', ['Clear']],
  ] as [Key[], string, string, string[]][])('%j', (keys, preview, draft, dropped) => {
    expect(previewOf(keys)).toBe(preview);
    expect(toDraftText(keys)).toEqual({ text: draft, dropped });
  });
});

describe('what the screen is told', () => {
  it('nothing for a Lane whose keys flow', () => {
    const run = live();
    run.send(typed(text('a')), typed(text('b')));
    expect(noticeOf(run.lane)).toBeNull();
  });

  it('a held notice with the reasons and what Move to Composer would keep', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('ls')), typed(named('Up')), typed(named('Enter')));
    run.send({ kind: 'connected' }, answered(mark()));
    expect(noticeOf(run.lane)).toEqual({
      kind: 'held',
      paneId: '%1',
      preview: 'ls↑⏎',
      reasons: ['risky-keys'],
      draft: { text: 'ls\n', dropped: ['↑'] },
      message: false,
    });
  });

  it('the discarded keys before the held ones', () => {
    const run = live();
    run.send({ kind: 'lost' }, typed(text('a')), { kind: 'connected' }, answered('gone'));
    run.send({ kind: 'lost' }, typed(named('Enter')), { kind: 'connected' }, answered(mark()));
    expect(noticeOf(run.lane)?.kind).toBe('discarded');
    run.send({ kind: 'dismissed' });
    expect(noticeOf(run.lane)?.kind).toBe('held');
  });
});
