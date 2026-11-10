import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { requireOptionalNativeModule } from 'expo';

import { usePhysicalKeyboard } from './use-physical-keyboard';

jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => ({
    isConnected: jest.fn(),
    addListener: jest.fn(),
  })),
}));

const native = jest.mocked(requireOptionalNativeModule).mock.results[0].value;
let connected = false;
let emit: ((event: { connected: boolean }) => void) | undefined;
let renderer: ReactTestRenderer;
let rendered: boolean[];
const remove = jest.fn();

function Probe() {
  const value = usePhysicalKeyboard();
  rendered.push(value);
  return <>{String(value)}</>;
}

beforeEach(() => {
  connected = false;
  rendered = [];
  jest.clearAllMocks();
  native.isConnected.mockImplementation(() => connected);
  native.addListener.mockImplementation((_event: string, listener: typeof emit) => {
    emit = listener;
    return { remove: () => { remove(); emit = undefined; } };
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

async function mount() { await act(async () => { renderer = create(<Probe />); }); }

it('reports an attached keyboard on the first render', async () => {
  connected = true;
  await mount();
  expect(rendered[0]).toBe(true);
  expect(renderer.toJSON()).toBe('true');
});

it('follows connection changes without remounting', async () => {
  await mount();
  expect(renderer.toJSON()).toBe('false');
  await act(async () => { connected = true; emit?.({ connected }); });
  expect(renderer.toJSON()).toBe('true');
  await act(async () => { connected = false; emit?.({ connected }); });
  expect(renderer.toJSON()).toBe('false');
});

it('reads a change between the first render and native subscription', async () => {
  native.addListener.mockImplementationOnce(() => {
    connected = true;
    return { remove };
  });
  await mount();
  expect(rendered[0]).toBe(false);
  expect(renderer.toJSON()).toBe('true');
});

it('removes its native subscription when it unmounts', async () => {
  await mount();
  await act(async () => { renderer.unmount(); });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(emit).toBeUndefined();
});

it('requires a native rebuild when the iOS module is missing', () => {
  jest.isolateModules(() => {
    const expo = require('expo');
    expo.requireOptionalNativeModule.mockReturnValueOnce(null);
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
      require('./use-physical-keyboard');
      expect(expo.requireOptionalNativeModule).not.toHaveBeenCalled();
    } finally {
      Platform.OS = previous;
    }
  });
});
