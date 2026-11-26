import { keyboardTarget, type KeyboardFacts, type KeyboardTarget } from './keyboard';

const facts = (over: Partial<KeyboardFacts> = {}): KeyboardFacts => ({
  intent: 'up',
  physicalKeyboard: false,
  activePaneId: '%1',
  typingOpen: true,
  inputElsewhere: false,
  ...over,
});

describe('keyboardTarget', () => {
  it.each<[string, Partial<KeyboardFacts>, KeyboardTarget]>([
    ['the active Pane holds the keyboard the user wants up', {}, { kind: 'pane', paneId: '%1' }],
    ['the new active Pane takes it at once, painted or not', { activePaneId: '%2' }, { kind: 'pane', paneId: '%2' }],
    ['no Pane holds a keyboard the user wants down', { intent: 'down' }, { kind: 'none' }],
    ['no Pane holds it while keys cannot reach the Pane', { typingOpen: false }, { kind: 'none' }],
    ['no Pane holds it before there is an active Pane', { activePaneId: null }, { kind: 'none' }],
    ['a hardware keyboard always wants the active Pane', { intent: 'down', physicalKeyboard: true }, { kind: 'pane', paneId: '%1' }],
    ['a hardware keyboard needs the active Pane to have a Surface', { physicalKeyboard: true, activePaneId: null }, { kind: 'none' }],
    ['the Composer, a Selection, a sheet or the Edge Drawer touches nothing here', { inputElsewhere: true }, { kind: 'elsewhere' }],
    ['input elsewhere wins over a stopped Typing', { inputElsewhere: true, typingOpen: false }, { kind: 'elsewhere' }],
    ['input elsewhere wins over a hardware keyboard', { inputElsewhere: true, physicalKeyboard: true }, { kind: 'elsewhere' }],
  ])('%s', (_, over, target) => {
    expect(keyboardTarget(facts(over))).toEqual(target);
  });
});
