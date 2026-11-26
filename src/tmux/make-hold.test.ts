import type { Key } from './input-lane';
import { NO_HOLDS, stepHold, type HoldEffect, type HoldEvent, type MakeHold } from './make-hold';
import type { VerbFate } from './verb-guard';

const text = (value: string): Key => ({ kind: 'text', bytes: [...new TextEncoder().encode(value)], gesture: false });
const typed = (key: Key, at = 1): HoldEvent => ({ kind: 'typed', key, at });
const tapped = (id: number, from = '%0'): HoldEvent => ({ kind: 'tapped', id, from });
const made = (paneId: string): VerbFate => ({ kind: 'made', paneId });
const settled = (id: number, fate: VerbFate, listed = false): HoldEvent => ({ kind: 'settled', id, fate, listed });

/** Runs the events from no hold, and answers with the holds left and every effect, in order. */
function run(...events: HoldEvent[]): { holds: readonly MakeHold[]; effects: HoldEffect[] } {
  let holds = NO_HOLDS;
  const effects: HoldEffect[] = [];
  for (const event of events) {
    const next = stepHold(holds, event);
    holds = next.holds;
    effects.push(...next.effects);
  }
  return { holds, effects };
}

/** What each effect carries, as `paneId:keys typed`. */
const sent = (effects: HoldEffect[]) =>
  effects.map((effect) => `${effect.kind} ${effect.paneId}:${effect.keys.map((key) => (key.kind === 'text' ? new TextDecoder().decode(Uint8Array.from(key.bytes)) : key.kind)).join('|')}`);

describe('the keys typed while a Pane is made', () => {
  it('sends them to the new Pane, in order and with the time they were typed, when tmux made it', () => {
    const { holds, effects } = run(tapped(1), typed(text('ls'), 5), typed({ kind: 'key', key: 'Enter' }, 9), settled(1, made('%2'), true));

    expect(holds).toEqual([]);
    expect(effects).toEqual([
      {
        kind: 'send',
        paneId: '%2',
        keys: [
          { kind: 'text', bytes: [108, 115], gesture: false, typedAt: 5 },
          { kind: 'key', key: 'Enter', typedAt: 9 },
        ],
      },
    ]);
  });

  it('parks them on the Pane they were typed in when tmux refused the verb', () => {
    const { holds, effects } = run(tapped(1, '%0'), typed(text('ls')), settled(1, { kind: 'refused', error: 'no space for new pane' }));

    expect(holds).toEqual([]);
    expect(sent(effects)).toEqual(['park %0:ls']);
  });

  it('parks them when the verb was dropped, after a break or because it was never sent', () => {
    expect(sent(run(tapped(1, '%3'), typed(text('a')), settled(1, { kind: 'dropped', reason: 'the Session is gone' })).effects)).toEqual([
      'park %3:a',
    ]);
  });

  it('has nothing to send when no key was typed', () => {
    expect(run(tapped(1), settled(1, made('%2'), true)).effects).toEqual([]);
    expect(run(tapped(1), settled(1, { kind: 'refused', error: 'x' })).effects).toEqual([]);
  });

  it('keeps the keys of two quick taps apart, by the tap each came after', () => {
    const { holds, effects } = run(
      tapped(1, '%0'),
      typed(text('one')),
      tapped(2, '%2'),
      typed(text('two')),
      settled(1, made('%2'), true),
      typed(text('2b')),
      settled(2, { kind: 'refused', error: 'no space' }),
    );

    expect(holds).toEqual([]);
    expect(sent(effects)).toEqual(['send %2:one', 'park %2:two2b']);
  });

  it('keeps the first tap\'s keys if only the second is refused, and the second\'s on its own Pane', () => {
    const { effects } = run(
      tapped(1, '%0'),
      typed(text('a')),
      tapped(2, '%2'),
      typed(text('b')),
      settled(1, { kind: 'refused', error: 'x' }),
      settled(2, made('%3'), true),
    );

    expect(sent(effects)).toEqual(['park %0:a', 'send %3:b']);
  });

  it('sends a key to a Pane that is made and not listed yet, until the Topology lists it', () => {
    const early = run(tapped(1), settled(1, made('%2')), typed(text('x')));
    expect(sent(early.effects)).toEqual(['send %2:x']);
    expect(early.holds).toEqual([{ kind: 'routed', id: 1, paneId: '%2' }]);

    const after = run(tapped(1), settled(1, made('%2')), { kind: 'listed', panes: new Set(['%0', '%2']) });
    expect(after.holds).toEqual([]);
  });

  it('does not let a Topology that lacks the Pane release it, but a read of the Topology does', () => {
    const lacking = run(tapped(1), settled(1, made('%2')), { kind: 'listed', panes: new Set(['%0']) });
    expect(lacking.holds).toHaveLength(1);
    expect(run(tapped(1), settled(1, made('%2')), { kind: 'known' }).holds).toEqual([]);
  });

  it('does not let a read of the Topology end a tap that is still waiting for tmux', () => {
    const { holds } = run(tapped(1), typed(text('a')), { kind: 'known' }, { kind: 'listed', panes: new Set(['%2']) });
    expect(holds).toMatchObject([{ kind: 'open', id: 1 }]);
  });

  it('ignores the end of a tap it does not know', () => {
    expect(run(settled(9, made('%2'))).effects).toEqual([]);
  });

  it('merges text typed one key after another into one Key, as a Lane does', () => {
    const { effects } = run(tapped(1), typed(text('l')), typed(text('s')), settled(1, made('%2'), true));
    expect(sent(effects)).toEqual(['send %2:ls']);
  });
});
