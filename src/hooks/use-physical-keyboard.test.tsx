import type { ReactTestRenderer } from 'react-test-renderer';

type Cause = 'connect' | 'disconnect' | 'check';
type NativeListener = (event: { connected: boolean; cause: Cause }) => void;
type KeyboardListener = (event?: { endCoordinates: { screenY?: number; height: number } }) => void;

let connected = false;
let mockNative: { isConnected: jest.Mock; addListener: jest.Mock };
let emit: NativeListener | undefined;
let keyboard: Map<string, KeyboardListener>;
let renderers: ReactTestRenderer[];

jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => mockNative),
}));

let act: typeof import('react-test-renderer').act;

/**
 * The hook keeps one app-wide presence, so each test loads it afresh, with
 * the React it renders through.
 */
function load(): () => boolean {
  jest.resetModules();
  act = require('react-test-renderer').act;
  const { Keyboard } = require('react-native');
  jest.spyOn(Keyboard, 'addListener').mockImplementation((...args: unknown[]) => {
    keyboard.set(args[0] as string, args[1] as KeyboardListener);
    return { remove: jest.fn() };
  });
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);
  return require('./use-physical-keyboard').usePhysicalKeyboard;
}

async function mount(usePhysicalKeyboard: () => boolean): Promise<ReactTestRenderer> {
  const React: typeof import('react') = require('react');
  const { create } = require('react-test-renderer');
  function Probe() { return React.createElement(React.Fragment, null, String(usePhysicalKeyboard())); }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Probe)); });
  renderers.push(renderer);
  return renderer;
}

const nativeSays = (value: boolean, cause: Cause) => act(async () => { connected = value; emit?.({ connected: value, cause }); });
const softwareKeyboard = (height: number) => act(async () => {
  if (height === 0) keyboard.get('keyboardDidHide')?.();
  else keyboard.get('keyboardDidShow')?.({ endCoordinates: { height } });
});

beforeEach(() => {
  connected = false;
  emit = undefined;
  keyboard = new Map();
  renderers = [];
  mockNative = {
    isConnected: jest.fn(() => connected),
    addListener: jest.fn((_event: string, listener: NativeListener) => {
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

it('reports an attached keyboard on the first render', async () => {
  connected = true;
  const renderer = await mount(load());
  expect(renderer.toJSON()).toBe('true');
});

it('follows connection changes without remounting', async () => {
  const renderer = await mount(load());
  expect(renderer.toJSON()).toBe('false');
  await nativeSays(true, 'connect');
  expect(renderer.toJSON()).toBe('true');
  await nativeSays(false, 'disconnect');
  expect(renderer.toJSON()).toBe('false');
});

it('shows the Key Row again when the full software keyboard comes up after a keyboard left unannounced', async () => {
  connected = true;
  const renderer = await mount(load());
  expect(renderer.toJSON()).toBe('true');
  await softwareKeyboard(336);
  expect(renderer.toJSON()).toBe('false');
  await softwareKeyboard(0);
  await nativeSays(true, 'check');
  expect(renderer.toJSON()).toBe('false');
});

it('keeps what it learned when the Terminal mounts again, as after a reconnect', async () => {
  connected = true;
  const usePhysicalKeyboard = load();
  const first = await mount(usePhysicalKeyboard);
  await softwareKeyboard(336);
  await act(async () => { first.unmount(); });
  const second = await mount(usePhysicalKeyboard);
  expect(second.toJSON()).toBe('false');
});

it('requires a native rebuild when the iOS module is missing', () => {
  jest.isolateModules(() => {
    require('expo').requireOptionalNativeModule.mockReturnValueOnce(null);
    expect(() => require('./use-physical-keyboard')).toThrow('Rebuild the iOS app');
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
      require('./use-physical-keyboard');
      expect(expo.requireOptionalNativeModule).not.toHaveBeenCalled();
    } finally {
      Platform.OS = previous;
    }
  });
});

it('writes each input, with where the keyboard frame sits, and the presence it leaves to the Log', async () => {
  connected = true;
  await mount(load());
  await act(async () => {
    keyboard.get('keyboardDidChangeFrame')?.({ endCoordinates: { screenY: 1194, height: 336 } });
  });
  const lines = require('@/diagnostics/device-log').deviceLog().entries().map((entry: { text: string }) => entry.text);
  expect(lines).toEqual(expect.arrayContaining([
    'presence: GameController first check, connected → reported true, overruled false, attached',
    expect.stringMatching(/^presence: keyboardDidChangeFrame, y 1194, height 336, screen \d+ → reported true, overruled true, not attached$/),
  ]));
});
