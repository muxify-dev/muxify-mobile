import { createTrackpadGesture, type TrackpadEvent, type TrackpadTarget } from './trackpad-gesture';

const targets: TrackpadTarget[] = [
  { paneId: '%1', box: { left: 0, top: 0, width: 200, height: 200 }, grid: { cols: 40, rows: 20 } },
  { paneId: '%2', box: { left: 210, top: 0, width: 100, height: 200 }, grid: { cols: 20, rows: 40 } },
];

function setup(selectionPane: string | null = null) {
  const actions = { drag: jest.fn(), swipe: jest.fn(), cancel: jest.fn(), scroll: jest.fn() };
  let allowed = true;
  const handler = createTrackpadGesture({ epoch: 3, targets, selectionPane, scrollSpeed: 2, allowed: () => allowed, actions });
  const send = (event: Partial<TrackpadEvent> = {}) => handler.receive({
    contextEpoch: 3, gestureId: 1, phase: 'changed', x: 100, y: 100,
    translationX: 0, translationY: 0, velocityX: 0, velocityY: 0,
    ...event,
  });
  return { actions, send, cancel: handler.cancel, disable: () => { allowed = false; } };
}

test('vertical scrolling keeps the start Pane and grid when the pointer crosses a split', () => {
  const { actions, send } = setup();
  send({ phase: 'began', x: 250 });
  send({ x: 100, translationY: 5 });
  send({ phase: 'ended', x: 100, translationY: 10 });
  expect(actions.scroll.mock.calls).toEqual([
    ['%2', 2, { cols: 20, rows: 40 }], ['%2', 2, { cols: 20, rows: 40 }],
  ]);
  expect(actions.swipe).not.toHaveBeenCalled();
  expect(actions.drag).not.toHaveBeenCalled();
});

test('horizontal gestures keep their axis and commit once from an inactive Pane', () => {
  const { actions, send } = setup();
  send({ phase: 'began', x: 250 });
  send({ translationX: -10, translationY: 1 });
  send({ translationX: -30, translationY: 100 });
  send({ phase: 'ended', translationX: -30, translationY: 100 });
  send({ phase: 'ended', translationX: -30, translationY: 100 });
  expect(actions.swipe.mock.calls).toEqual([['left']]);
  expect(actions.drag).toHaveBeenLastCalledWith(-30, 100);
  expect(actions.scroll).not.toHaveBeenCalled();
});

test('a vertical gesture stays vertical after sideways movement', () => {
  const { actions, send } = setup();
  send({ phase: 'began' });
  send({ translationX: 1, translationY: 10 });
  send({ phase: 'ended', translationX: 100, translationY: 15, velocityX: 900 });
  expect(actions.scroll.mock.calls).toEqual([
    ['%1', 2, targets[0].grid], ['%1', 1, targets[0].grid],
  ]);
  expect(actions.swipe).not.toHaveBeenCalled();
});

test('fractional lines accumulate within one gesture and do not enter another Pane', () => {
  const { actions, send } = setup();
  send({ phase: 'began' });
  send({ translationY: 2 });
  send({ translationY: 4 });
  send({ phase: 'ended', translationY: 6 });
  send({ phase: 'began', gestureId: 2, x: 250 });
  send({ gestureId: 2, translationY: 2 });
  expect(actions.scroll.mock.calls).toEqual([['%1', 1, targets[0].grid]]);
  send({ phase: 'ended', gestureId: 2, translationY: 3 });
  expect(actions.scroll.mock.calls).toEqual([
    ['%1', 1, targets[0].grid], ['%2', 1, targets[1].grid],
  ]);
});

test('cancellation, disable and stale events cannot commit or resume a gesture', () => {
  const { actions, send, disable } = setup();
  send({ phase: 'began' });
  send({ translationX: -60 });
  send({ phase: 'ended', contextEpoch: 2, translationX: -60 });
  expect(actions.swipe).not.toHaveBeenCalled();
  send({ phase: 'cancelled' });
  send({ phase: 'ended', translationX: -60 });
  send({ phase: 'began', gestureId: 1 });
  send({ phase: 'ended', translationX: -60 });
  send({ phase: 'began', gestureId: 2 });
  send({ gestureId: 2, translationX: -60 });
  disable();
  send({ phase: 'ended', gestureId: 2, translationX: -60 });
  expect(actions.cancel).toHaveBeenCalledTimes(2);
  expect(actions.swipe).not.toHaveBeenCalled();
});

test('context replacement cancels a drag and rejects its queued events', () => {
  const old = setup();
  old.send({ phase: 'began' });
  old.send({ translationX: 60 });
  old.cancel();
  old.send({ phase: 'ended', translationX: 60 });
  const fresh = setup();
  fresh.send({ phase: 'ended', translationX: 60 });
  expect(old.actions.cancel).toHaveBeenCalledTimes(1);
  expect(old.actions.swipe).not.toHaveBeenCalled();
  expect(fresh.actions.swipe).not.toHaveBeenCalled();
});

test('a pointer in a gap or outside every Pane does nothing', () => {
  for (const x of [-1, 205, 320]) {
    const { actions, send } = setup();
    send({ phase: 'began', x });
    send({ phase: 'ended', translationX: 100, translationY: 50 });
    expect(actions.scroll).not.toHaveBeenCalled();
    expect(actions.swipe).not.toHaveBeenCalled();
  }
});

test('a Selection permits only vertical scrolling of its own Pane', () => {
  const { actions, send } = setup('%1');
  send({ phase: 'began', x: 250 });
  send({ phase: 'ended', translationY: 20 });
  send({ phase: 'began', gestureId: 2 });
  send({ phase: 'ended', gestureId: 2, translationX: -80 });
  send({ phase: 'began', gestureId: 3 });
  send({ phase: 'ended', gestureId: 3, translationY: 10 });
  send({ phase: 'began', gestureId: 4, x: 10 });
  send({ phase: 'ended', gestureId: 4, translationX: 80 });
  expect(actions.scroll.mock.calls).toEqual([['%1', 2, targets[0].grid]]);
  expect(actions.swipe).not.toHaveBeenCalled();
  expect(actions.drag).not.toHaveBeenCalled();
});

test('horizontal gestures at the left edge change Pane once in either direction', () => {
  for (const [translationX, direction] of [[-60, 'left'], [60, 'right']] as const) {
    const { actions, send } = setup();
    send({ phase: 'began', x: 10 });
    send({ translationX });
    send({ phase: 'ended', translationX });
    send({ phase: 'ended', translationX });
    expect(actions.swipe.mock.calls).toEqual([[direction]]);
    expect(actions.drag).toHaveBeenLastCalledWith(translationX, 200);
    expect(actions.scroll).not.toHaveBeenCalled();
  }
});

test('an edge flick changes Pane and a short gesture without matching velocity cancels', () => {
  for (const [velocityX, commits] of [[601, 1], [0, 0], [-900, 0]]) {
    const { actions, send } = setup();
    send({ phase: 'began', x: 10 });
    send({ phase: 'ended', translationX: 10, velocityX });
    expect(actions.swipe).toHaveBeenCalledTimes(commits);
    expect(actions.cancel).toHaveBeenCalledTimes(1 - commits);
  }
});

test('a cancelled edge drag changes no Pane', () => {
  const { actions, send } = setup();
  send({ phase: 'began', x: 10 });
  send({ translationX: 80 });
  send({ phase: 'cancelled', translationX: -80 });
  expect(actions.cancel).toHaveBeenCalledTimes(1);
  expect(actions.swipe).not.toHaveBeenCalled();
});

test('a gesture snapshots its start grid and size', () => {
  const localTargets = [{ paneId: '%9', box: { left: 0, top: 0, width: 200, height: 200 }, grid: { cols: 40, rows: 20 } }];
  const scroll = jest.fn();
  const handler = createTrackpadGesture({
    epoch: 1, targets: localTargets, selectionPane: null, scrollSpeed: 2, allowed: () => true,
    actions: { scroll, drag: jest.fn(), swipe: jest.fn(), cancel: jest.fn() },
  });
  const event: TrackpadEvent = { phase: 'began', gestureId: 1, contextEpoch: 1, x: 50, y: 50,
    translationX: 0, translationY: 0, velocityX: 0, velocityY: 0 };
  handler.receive(event);
  localTargets[0].grid.rows = 100;
  localTargets[0].box.height = 100;
  handler.receive({ ...event, phase: 'ended', translationY: 10 });
  expect(scroll.mock.calls).toEqual([['%9', 2, { cols: 40, rows: 20 }]]);
});

test('a new gesture cancels an old drag and ignores its late release', () => {
  const { send, actions } = setup();
  send({ phase: 'began' });
  send({ translationX: -60 });
  send({ phase: 'began', gestureId: 2 });
  send({ phase: 'ended', translationX: -60 });
  send({ phase: 'ended', gestureId: 2, translationX: 10 });
  expect(actions.cancel).toHaveBeenCalledTimes(2);
  expect(actions.swipe).not.toHaveBeenCalled();
});

test('scroll fractions support negative travel and reversal within the same gesture', () => {
  const { send, actions } = setup();
  send({ phase: 'began' });
  send({ translationY: -2 });
  send({ translationY: -6 });
  send({ phase: 'ended', translationY: 1 });
  expect(actions.scroll.mock.calls).toEqual([
    ['%1', -1, targets[0].grid], ['%1', 1, targets[0].grid],
  ]);
});
