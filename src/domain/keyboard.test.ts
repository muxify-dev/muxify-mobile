import {
  keyboardPlan,
  physicalKeyboardLeft,
  sameKeyboardTarget,
  UNKNOWN_KEYBOARD,
  type KeyboardIntent,
  type KeyboardPlan,
  type KeyboardScreen,
  type KeyboardSnapshot,
} from './keyboard';

const ROW = 52;
const bounds = { x: 0, y: 0, width: 834, height: 1210 };
const docked = { x: 0, y: 870, width: 834, height: 340 };

const snapshot = (over: Partial<KeyboardSnapshot> = {}): KeyboardSnapshot => ({ physical: 'absent', software: null, ...over });
const screen = (over: Partial<KeyboardScreen> = {}): KeyboardScreen => ({
  activePaneId: '%1',
  typingOpen: true,
  inputElsewhere: false,
  rootBounds: bounds,
  safeBottom: 20,
  keyRowHeight: ROW,
  ...over,
});
const plan = (snap: Partial<KeyboardSnapshot> = {}, intent: KeyboardIntent = 'up', over: Partial<KeyboardScreen> = {}): KeyboardPlan =>
  keyboardPlan(snapshot(snap), intent, screen(over));

describe('keyboardPlan: the focus target', () => {
  it.each<[string, Partial<KeyboardSnapshot>, KeyboardIntent, Partial<KeyboardScreen>, KeyboardPlan['target']]>([
    ['the active Pane holds the keyboard the user wants up', {}, 'up', {}, { kind: 'pane', paneId: '%1' }],
    ['the new active Pane takes it at once, painted or not', {}, 'up', { activePaneId: '%2' }, { kind: 'pane', paneId: '%2' }],
    ['no Pane holds a keyboard the user wants down', {}, 'down', {}, { kind: 'none' }],
    ['no Pane holds it while keys cannot reach the Pane', {}, 'up', { typingOpen: false }, { kind: 'none' }],
    ['no Pane holds it before there is an active Pane', {}, 'up', { activePaneId: null }, { kind: 'none' }],
    ['a physical keyboard in use always wants the active Pane', { physical: 'inUse' }, 'down', {}, { kind: 'pane', paneId: '%1' }],
    ['a physical keyboard in use needs an active Pane', { physical: 'inUse' }, 'down', { activePaneId: null }, { kind: 'none' }],
    ['an unknown physical keyboard is not in use: a keyboard wanted down stays down', { physical: 'unknown' }, 'down', {}, { kind: 'none' }],
    ['an unknown physical keyboard does not stop one the user wants up', { physical: 'unknown' }, 'up', {}, { kind: 'pane', paneId: '%1' }],
    ['the Composer, a Selection, a sheet or the Edge Drawer touches nothing here', {}, 'up', { inputElsewhere: true }, { kind: 'elsewhere' }],
    ['input elsewhere wins over a stopped Typing', {}, 'up', { inputElsewhere: true, typingOpen: false }, { kind: 'elsewhere' }],
    ['input elsewhere wins over a physical keyboard', { physical: 'inUse' }, 'up', { inputElsewhere: true }, { kind: 'elsewhere' }],
  ])('%s', (_, snap, intent, over, target) => {
    expect(plan(snap, intent, over).target).toEqual(target);
  });
});

describe('keyboardPlan: the Key Row and the shortcut bar', () => {
  it.each<[string, KeyboardSnapshot['physical'], boolean, boolean]>([
    ['no physical keyboard: the Key Row shows, the bar is off', 'absent', true, false],
    ['a physical keyboard in use: no Key Row, the bar is on', 'inUse', false, true],
    ['before the first check: no Key Row, and no decision on the bar', 'unknown', false, false],
  ])('%s', (_, physical, keyRow, shortcutBar) => {
    const result = plan({ physical });
    expect(result.keyRow).toBe(keyRow);
    expect(result.shortcutBar).toBe(shortcutBar);
  });

  it('the Key Row follows the physical keyboard whatever the software keyboard does', () => {
    // Hiding the software keyboard alone does not hide the row (CONTEXT.md, Key Row).
    expect(plan({ physical: 'absent', software: docked }).keyRow).toBe(true);
    expect(plan({ physical: 'absent', software: null }).keyRow).toBe(true);
    expect(plan({ physical: 'inUse', software: docked }).keyRow).toBe(false);
    expect(plan({ physical: 'inUse', software: null }).keyRow).toBe(false);
  });

  it('the start before the native answer shows no Key Row', () => {
    expect(keyboardPlan(UNKNOWN_KEYBOARD, 'down', screen()).keyRow).toBe(false);
  });
});

describe('keyboardPlan: where the keyboard is and the room it leaves', () => {
  it('shows the keyboard when a software keyboard is in the window', () => {
    expect(plan({ software: docked }).keyboardShown).toBe(true);
    expect(plan({ software: null }).keyboardShown).toBe(false);
  });

  it('clears the docked keyboard and rests on the safe area without one', () => {
    expect(plan({ software: docked }).clearance).toEqual({ resting: 20, bottom: 340 });
    expect(plan({ software: null }).clearance).toEqual({ resting: 20, bottom: 20 });
  });

  it('leaves a floating keyboard over the content and the row at the bottom', () => {
    const floating = { x: 200, y: 600, width: 400, height: 200 };
    expect(plan({ software: floating }).clearance.bottom).toBe(20);
    expect(plan({ software: floating }).keyboardShown).toBe(true);
  });

  it('reserves the Key Row only while it shows', () => {
    expect(plan({ physical: 'absent' }).reservedBottom).toBe(ROW);
    expect(plan({ physical: 'inUse' }).reservedBottom).toBe(0);
    expect(plan({ physical: 'unknown' }).reservedBottom).toBe(0);
  });

  it('keeps the Window as tall with the keyboard up as down', () => {
    expect(plan({ physical: 'absent', software: docked }).windowHeight).toBe(1210 - ROW - 20);
    expect(plan({ physical: 'absent', software: null }).windowHeight).toBe(1210 - ROW - 20);
    expect(plan({ physical: 'inUse', software: null }).windowHeight).toBe(1210 - 20);
  });

  it('never gives the Window a negative height', () => {
    expect(plan({}, 'up', { rootBounds: { ...bounds, height: 10 } }).windowHeight).toBe(0);
  });
});

describe('physicalKeyboardLeft', () => {
  const at = (physical: KeyboardSnapshot['physical']) => snapshot({ physical });

  it.each<[KeyboardSnapshot['physical'], KeyboardSnapshot['physical'], boolean]>([
    ['inUse', 'absent', true],
    ['inUse', 'inUse', false],
    ['inUse', 'unknown', false],
    ['absent', 'inUse', false],
    ['absent', 'absent', false],
    ['unknown', 'absent', false],
    ['unknown', 'inUse', false],
  ])('%s then %s: %s', (before, after, left) => {
    expect(physicalKeyboardLeft(at(before), at(after))).toBe(left);
  });
});

describe('sameKeyboardTarget', () => {
  it('compares the kind, and the Pane of a Pane target', () => {
    expect(sameKeyboardTarget({ kind: 'pane', paneId: '%1' }, { kind: 'pane', paneId: '%1' })).toBe(true);
    expect(sameKeyboardTarget({ kind: 'pane', paneId: '%1' }, { kind: 'pane', paneId: '%2' })).toBe(false);
    expect(sameKeyboardTarget({ kind: 'none' }, { kind: 'elsewhere' })).toBe(false);
    expect(sameKeyboardTarget({ kind: 'none' }, { kind: 'none' })).toBe(true);
  });
});
