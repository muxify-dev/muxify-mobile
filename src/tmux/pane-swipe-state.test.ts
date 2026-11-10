import { IDLE, paneSwipeAfter, type PaneSwipeEvent, type PaneSwipeState } from './pane-swipe-state';

const WIDTH = 400;

function after(events: PaneSwipeEvent[], from: PaneSwipeState = IDLE): PaneSwipeState {
  return events.reduce(paneSwipeAfter, from);
}

const drag = (translation: number): PaneSwipeEvent => ({ type: 'drag', translation, width: WIDTH });
const commitLeft: PaneSwipeEvent = { type: 'commit', direction: 'left', leaving: '%0' };

describe('a Pane Swipe', () => {
  it('keeps the Pane under the finger, and knows when the drag is past the commit point', () => {
    expect(after([drag(-60)])).toEqual({ phase: 'dragging', offset: -60, pastCommit: false });
    expect(after([drag(-60), drag(-100)])).toMatchObject({ phase: 'dragging', pastCommit: true });
    expect(after([drag(-100), drag(-60)])).toMatchObject({ offset: -60, pastCommit: false });
  });

  it('goes back to rest when the finger lifts short of a swipe', () => {
    expect(after([drag(-60), { type: 'cancel' }])).toEqual({ phase: 'settling' });
    expect(after([drag(-60), { type: 'cancel' }, { type: 'rested' }])).toBe(IDLE);
  });

  it('brings the next Pane in when the old one is out and the new Surface has a grid', () => {
    const out = after([drag(-120), commitLeft, { type: 'slidOut' }]);
    expect(out).toMatchObject({ phase: 'committing', slidOut: true, arrived: false });
    expect(after([{ type: 'arrived', pane: '%1' }], out)).toEqual({ phase: 'settling' });

    const arrived = after([drag(-120), commitLeft, { type: 'arrived', pane: '%1' }]);
    expect(arrived).toMatchObject({ phase: 'committing', slidOut: false, arrived: true });
    expect(after([{ type: 'slidOut' }, { type: 'rested' }], arrived)).toBe(IDLE);
  });

  it('does not take a grid from the Pane that is leaving for the next one', () => {
    const state = after([commitLeft, { type: 'slidOut' }, { type: 'arrived', pane: '%0' }]);
    expect(state).toMatchObject({ phase: 'committing', arrived: false });
  });

  it('holds the next Pane still against a finger until it is in', () => {
    const committing = after([drag(-120), commitLeft]);
    expect(after([drag(-40)], committing)).toBe(committing);
    expect(after([{ ...commitLeft, direction: 'right' }], committing)).toBe(committing);
  });

  it('takes a new drag while the Pane is on its way to rest', () => {
    expect(after([drag(-60), { type: 'cancel' }, drag(20)])).toMatchObject({
      phase: 'dragging',
      offset: 20,
    });
  });

  it('is idle again when the Host refuses the move', () => {
    const committing = after([drag(-120), commitLeft, { type: 'active', pane: '%1' }]);
    expect(committing.phase).toBe('committing');
    expect(after([{ type: 'active', pane: '%0' }], committing)).toBe(IDLE);
  });

  it('is idle again when the Pane under the finger closes', () => {
    expect(after([drag(-60), { type: 'active', pane: '%2' }])).toBe(IDLE);
    expect(after([drag(-60), { type: 'cancel' }, { type: 'active', pane: '%2' }])).toBe(IDLE);
  });

  it('is idle again when the Window stops being one Pane wide', () => {
    expect(after([drag(-60), { type: 'reset' }])).toBe(IDLE);
    expect(after([drag(-120), commitLeft, { type: 'reset' }])).toBe(IDLE);
  });

  it('ignores an animation that ends after its phase has gone', () => {
    expect(after([{ type: 'slidOut' }])).toBe(IDLE);
    expect(after([drag(-60), { type: 'rested' }])).toMatchObject({ phase: 'dragging' });
  });
});
