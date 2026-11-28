import type { ReactTestRenderer } from 'react-test-renderer';

import type { KeyboardSnapshot } from '@/domain/keyboard';

interface Native {
  physical: 'unknown' | 'inUse' | 'absent';
  software?: { x: number; y: number; width: number; height: number } | null;
  event: string;
  gcConnected?: boolean | null;
  staleSuspected: boolean;
}

let mockNative: { snapshot: jest.Mock; addListener: jest.Mock };
let emit: ((snapshot: Native) => void) | undefined;
let held: Native;
let renderers: ReactTestRenderer[];

jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => mockNative),
}));

let act: typeof import('react-test-renderer').act;

const FULL = { x: 0, y: 870, width: 834, height: 340 };
const answer = (over: Partial<Native>): Native => ({ physical: 'unknown', software: null, event: 'read', gcConnected: null, staleSuspected: false, ...over });

/** The store keeps one snapshot for the whole app, so each test loads it afresh, with the React it renders through. */
function load() {
  jest.resetModules();
  act = require('react-test-renderer').act;
  return require('./use-keyboard') as typeof import('./use-keyboard');
}

async function mount(useKeyboard: () => KeyboardSnapshot): Promise<ReactTestRenderer> {
  const React: typeof import('react') = require('react');
  const { create } = require('react-test-renderer');
  function Probe() {
    const { physical, software } = useKeyboard();
    return React.createElement(React.Fragment, null, `${physical} ${software ? software.height : 'none'}`);
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Probe)); });
  renderers.push(renderer);
  return renderer;
}

const nativeSays = (snapshot: Partial<Native>) => act(async () => { emit?.(answer(snapshot)); });
const logLines = (): string[] => require('@/diagnostics/device-log').deviceLog().entries().map((entry: { text: string }) => entry.text);

beforeEach(() => {
  emit = undefined;
  held = answer({});
  renderers = [];
  mockNative = {
    snapshot: jest.fn(() => held),
    addListener: jest.fn((_event: string, listener: (snapshot: Native) => void) => {
      emit = listener;
      return { remove: jest.fn() };
    }),
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (renderers.length) await act(async () => { renderers.forEach((renderer) => renderer.unmount()); });
  jest.restoreAllMocks();
});

it('is unknown, with no software keyboard, until the module has answered', async () => {
  const renderer = await mount(load().useKeyboard);
  expect(renderer.toJSON()).toBe('unknown none');
});

it('takes the module\'s answer at the start, and follows each snapshot after it', async () => {
  held = answer({ physical: 'inUse', gcConnected: true });
  const renderer = await mount(load().useKeyboard);
  expect(renderer.toJSON()).toBe('inUse none');
  await nativeSays({ physical: 'absent', software: FULL, staleSuspected: true, event: 'keyboardDidShow' });
  expect(renderer.toJSON()).toBe('absent 340');
  await nativeSays({ physical: 'absent', software: null, staleSuspected: true, event: 'keyboardWillHide' });
  expect(renderer.toJSON()).toBe('absent none');
});

it('keeps what it learned when the Terminal mounts again, as after a reconnect', async () => {
  const { useKeyboard } = load();
  const first = await mount(useKeyboard);
  await nativeSays({ physical: 'absent', staleSuspected: true });
  await act(async () => { first.unmount(); });
  const second = await mount(useKeyboard);
  expect(second.toJSON()).toBe('absent none');
});

it('tells a subscriber outside React each change with the snapshot before it', async () => {
  const { subscribeKeyboard } = load();
  held = answer({ physical: 'inUse', gcConnected: true });
  const heard: string[] = [];
  const stop = subscribeKeyboard((now, before) => heard.push(`${before.physical} → ${now.physical}`));
  await nativeSays({ physical: 'absent', staleSuspected: true });
  stop();
  await nativeSays({ physical: 'inUse' });
  expect(heard).toEqual(['unknown → inUse', 'inUse → absent']);
});

it('writes one line for each snapshot, with the event that changed it', async () => {
  await mount(load().useKeyboard);
  await nativeSays({
    physical: 'absent', software: FULL, gcConnected: true, staleSuspected: true,
    event: 'keyboardDidShow, frame y 870, height 340, window 1210, shows 340',
  });
  expect(logLines()).toEqual(expect.arrayContaining([
    'read → physical unknown, software none, gcConnected unknown, staleSuspected false',
    'keyboardDidShow, frame y 870, height 340, window 1210, shows 340 → physical absent, software 0,870 834x340, gcConnected true, staleSuspected true',
  ]));
});

it('says that a physical keyboard connected or disconnected when that changes, and nothing while it is unknown', async () => {
  await mount(load().useKeyboard);
  await nativeSays({ physical: 'inUse', gcConnected: true });
  await nativeSays({ physical: 'inUse', software: FULL });
  await nativeSays({ physical: 'absent', staleSuspected: true });
  const states = logLines().filter((line) => line.startsWith('physical keyboard '));
  expect(states).toEqual(['physical keyboard connected', 'physical keyboard disconnected']);
});

it('requires a native rebuild when the iOS module is missing', () => {
  jest.isolateModules(() => {
    require('expo').requireOptionalNativeModule.mockReturnValueOnce(null);
    expect(() => require('./use-keyboard')).toThrow('Rebuild the iOS app');
  });
});

it('does not load the iOS module on an unsupported platform', () => {
  jest.isolateModules(() => {
    const { Platform } = require('react-native');
    const previous = Platform.OS;
    Platform.OS = 'android';
    try {
      const expo = require('expo');
      expo.requireOptionalNativeModule.mockClear();
      const { subscribeKeyboard } = require('./use-keyboard');
      subscribeKeyboard(() => {})();
      expect(expo.requireOptionalNativeModule).not.toHaveBeenCalled();
    } finally {
      Platform.OS = previous;
    }
  });
});
