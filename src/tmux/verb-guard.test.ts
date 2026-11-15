import { createVerbGuard, IDLE, step, type Guard, type GuardEvent, type Op, type VerbAnswer } from './verb-guard';

const SPLIT = { kind: 'split', direction: 'right' } as const;
const SERVER = 100;
const read = (held: number, error: string | null = null, serverPid = SERVER): VerbAnswer => ({
  kind: 'read',
  held,
  serverPid,
  error,
});

/** Runs the events from idle and answers with the last guard and every effect but the Log lines. */
function after(events: GuardEvent[], from: Guard = IDLE) {
  let guard = from;
  const effects = [];
  for (const event of events) {
    const next = step(guard, event);
    guard = next.guard;
    effects.push(...next.effects.filter((effect) => effect.kind !== 'say'));
  }
  return { phase: guard.phase.kind, nextOp: guard.nextOp, effects };
}

const tapped = (guarded = true, serverPid: number | null = SERVER): GuardEvent => ({
  kind: 'tapped',
  verb: SPLIT,
  session: '$1',
  guarded,
  serverPid,
});
const sent = (op: number, guarded = true) => ({ op: op as Op, verb: SPLIT, session: '$1', guarded, serverPid: SERVER });

describe('the Verb guard', () => {
  it('sends a tapped verb with the next Op, and ends it when the Session shows that Op', () => {
    expect(after([tapped(), { kind: 'answered', answer: read(1) }])).toEqual({
      phase: 'idle',
      nextOp: 2,
      effects: [
        { kind: 'send', sent: sent(1) },
        { kind: 'settled', op: 1, outcome: { kind: 'done' } },
      ],
    });
  });

  it('refuses with the words of tmux when the Op did not go up', () => {
    expect(after([tapped(), { kind: 'answered', answer: read(0, 'no space for new pane') }]).effects.at(-1)).toEqual({
      kind: 'settled',
      op: 1,
      outcome: { kind: 'refused', error: 'no space for new pane' },
    });
  });

  it('keeps the verb across a break, and ends the tap without an error', () => {
    expect(after([tapped(), { kind: 'lost' }])).toMatchObject({
      phase: 'kept',
      effects: [{ kind: 'send' }, { kind: 'settled', op: 1, outcome: { kind: 'waits' } }],
    });
  });

  it('reads the Session on the next Connection, and is done when the Op is at or above', () => {
    expect(after([tapped(), { kind: 'lost' }, { kind: 'connected' }, { kind: 'answered', answer: read(1) }])).toMatchObject({
      phase: 'idle',
      effects: [{ kind: 'send' }, { kind: 'settled' }, { kind: 'read', sent: sent(1) }],
    });
  });

  it('sends the same Op again when the Session is below it', () => {
    const { phase, effects } = after([tapped(), { kind: 'lost' }, { kind: 'connected' }, { kind: 'answered', answer: read(0) }]);
    expect(phase).toBe('sending');
    expect(effects.at(-1)).toEqual({ kind: 'send', sent: sent(1) });
  });

  it.each([
    ['the tmux server started again', SERVER],
    ['the server of the tap is not known', null],
  ])('drops a kept verb and never sends it when %s', (_what, serverPid) => {
    const events: GuardEvent[] = [tapped(true, serverPid), { kind: 'lost' }, { kind: 'connected' }];
    const checking = events.reduce((guard, event) => step(guard, event).guard, IDLE);
    expect(step(checking, { kind: 'answered', answer: read(0, null, SERVER + 1) })).toEqual({
      guard: { nextOp: 2, phase: { kind: 'idle' } },
      effects: [{ kind: 'say', line: 'Op 1 (split right in $1) dropped: the tmux server started again' }],
    });
  });

  it('keeps the verb when the Connection breaks again during the read', () => {
    expect(after([tapped(), { kind: 'lost' }, { kind: 'connected' }, { kind: 'lost' }, { kind: 'connected' }]).effects).toEqual([
      { kind: 'send', sent: sent(1) },
      { kind: 'settled', op: 1, outcome: { kind: 'waits' } },
      { kind: 'read', sent: sent(1) },
      { kind: 'read', sent: sent(1) },
    ]);
  });

  it.each([
    ['the Session is gone', { kind: 'gone' } as const],
    ['the read fails', { kind: 'failed', error: 'server exited' } as const],
  ])('drops the verb when %s', (_what, answer) => {
    expect(after([tapped(), { kind: 'lost' }, { kind: 'connected' }, { kind: 'answered', answer }])).toMatchObject({
      phase: 'idle',
      effects: [{ kind: 'send' }, { kind: 'settled' }, { kind: 'read' }],
    });
  });

  it('drops an unconfirmed verb of a tmux older than 3.2 at the break, and never reads it', () => {
    expect(after([tapped(false), { kind: 'lost' }, { kind: 'connected' }])).toMatchObject({
      phase: 'idle',
      effects: [{ kind: 'send' }, { kind: 'settled', outcome: { kind: 'waits' } }],
    });
  });

  it('takes no second tap while one verb is unconfirmed', () => {
    expect(after([tapped(), tapped()])).toMatchObject({ nextOp: 2, effects: [{ kind: 'send' }] });
  });
});

describe('the Verb guard on a Connection', () => {
  it('says in the Log that a tap waiting behind a kept verb was dropped at the break', async () => {
    const said: string[] = [];
    const verbs = createVerbGuard({ say: (line) => said.push(line), onRefused: () => {} });
    verbs.connected({
      verbServer: async () => ({ guarded: true, serverPid: SERVER }),
      runVerb: () => new Promise(() => {}),
      readOp: () => new Promise(() => {}),
    });
    const first = verbs.run(SPLIT, '$1');
    const second = verbs.run({ kind: 'new-window' }, '$1');
    await new Promise((resolve) => setImmediate(resolve));
    verbs.lost();
    await Promise.all([first, second]);
    expect(said).toContainEqual('New Window in $1 dropped: the Connection broke before it was sent');
  });
});
