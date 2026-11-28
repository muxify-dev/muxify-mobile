import {
  DEFAULT_GRIP_ACTIONS, fanItems, GRIP_ACTIONS, gripActionSlots, NO_GRIP_ACTIONS, parseGripActions,
} from './grip-actions';

describe('gripActionSlots', () => {
  it('is Go to, Compose and Options until the user chooses', () => {
    expect(DEFAULT_GRIP_ACTIONS).toEqual(['go-to', 'compose', 'options']);
    expect(gripActionSlots(undefined)).toBe(DEFAULT_GRIP_ACTIONS);
  });

  it('keeps an empty slot empty', () => {
    expect(gripActionSlots(['keyboard', null, 'paste'])).toEqual(['keyboard', null, 'paste']);
  });

  it('refuses an action twice and an action this version does not know, and keeps their slots', () => {
    expect(gripActionSlots(['paste', 'paste', 'removed-action'])).toEqual(['paste', null, null]);
  });

  it('reads at most three slots, and fills a short list with empty ones', () => {
    expect(gripActionSlots(['go-to', 'compose', 'options', 'keyboard'])).toEqual(['go-to', 'compose', 'options']);
    expect(gripActionSlots(['zoom-pane'])).toEqual(['zoom-pane', null, null]);
  });

  it('offers each action once with a title and a symbol', () => {
    expect(Object.keys(GRIP_ACTIONS)).toEqual([
      'go-to', 'compose', 'options', 'keyboard', 'title-sheet', 'host-screen',
      'split-right', 'split-down', 'new-window', 'zoom-pane', 'paste', 'copy-pane',
    ]);
  });
});

describe('parseGripActions', () => {
  it('leaves a setting that was never saved to the defaults', () => {
    expect(parseGripActions(undefined)).toBeUndefined();
    expect(parseGripActions('go-to')).toBeUndefined();
  });

  it('reads a saved list as the slots', () => {
    expect(parseGripActions(['options', 'options', null])).toEqual(['options', null, null]);
  });
});

describe('fanItems', () => {
  const none = NO_GRIP_ACTIONS;
  const run = () => {};

  it('puts Destinations first, then the three slots in order, so a slot keeps its place on every screen', () => {
    const items = fanItems(['options', null, 'go-to'], { ...none, options: run, 'go-to': run });
    expect(items.map((item) => item?.id ?? null)).toEqual(['destinations', 'options', null, 'go-to']);
  });

  it('never dims Destinations, and dims an action that the screen cannot run', () => {
    const items = fanItems(['compose', 'go-to', null], { ...none, 'go-to': run });
    expect(items.map((item) => item?.dimmed ?? null)).toEqual([false, true, false, null]);
  });

  it('gives an action the title a screen chose, and the catalog title otherwise', () => {
    const items = fanItems(['compose', 'go-to', null], none, { compose: 'Close composer' });
    expect(items.map((item) => item?.title ?? null)).toEqual(['Destinations', 'Close composer', 'Go to', null]);
  });
});
