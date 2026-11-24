import * as Haptics from 'expo-haptics';
import React from 'react';
import * as ReactNative from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { REPEAT_DELAY, REPEAT_INTERVAL } from '@/lib/arrow-stick';
import { NO_MODIFIERS } from '@/lib/modifier-keys';
import { KeyRow, type KeyRowProps } from './key-row';

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-glass-effect', () => ({ GlassView: 'GlassView', isGlassEffectAPIAvailable: () => false }));
jest.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }));
jest.mock('@expo/ui/community/masked-view', () => ({ MaskedView: 'MaskedView' }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const quickActions = {
  ctrl: [{ id: 'interrupt', chord: '⌃C', label: 'Interrupt' }, null, null,
    { id: 'interrupt-twice', chord: '⌃C ×2', label: 'Interrupt twice' }],
  cmd: [null, null, { id: 'paste', chord: '⌘V', label: 'Paste' }, null],
} satisfies KeyRowProps['quickActions'];

let renderer: ReactTestRenderer;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

it.each(['dark', 'light'] as const)('draws readable keys on its strip, %s', async (appearance) => {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(appearance);
  await act(async () => {
    renderer = create(
      <KeyRow
        armed={NO_MODIFIERS} onArm={jest.fn()} onKey={jest.fn()} onSymbol={jest.fn()} onPanes={jest.fn()}
        onKeyboard={jest.fn()} keyboardVisible={false} keysDisabled={false} panesDisabled={false}
        below={34} quickActions={quickActions} onQuickAction={jest.fn()}
      />,
    );
  });

  // The strip is the view that fills what lies under the row.
  const [strip] = renderer.root.findAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style))
    .filter((style) => style?.paddingBottom === 34);
  const labels = renderer.root.findAllByType(Text)
    .map((node) => StyleSheet.flatten(node.props.style)?.color)
    .filter((color): color is string => typeof color === 'string' && color.startsWith('#'));

  expect(strip?.backgroundColor).toBeDefined();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(contrast(strip.backgroundColor as string, label)).toBeGreaterThanOrEqual(4.5);
  }
});

async function showRow(armed: KeyRowProps['armed'] = NO_MODIFIERS) {
  const props = {
    armed, quickActions, onQuickAction: jest.fn(), onArm: jest.fn(), onKey: jest.fn(), onSymbol: jest.fn(),
    onPanes: jest.fn(), onKeyboard: jest.fn(), keyboardVisible: false,
    keysDisabled: false, panesDisabled: false, below: 0,
  };
  jest.clearAllMocks();
  await act(async () => { renderer = create(<KeyRow {...props} />); });
  return props;
}

function key(label: string) {
  return renderer.root.findAllByType(View).find(node => node.props.accessibilityLabel === label)!.props;
}

function touch(pageX: number, pageY: number) {
  return { nativeEvent: { pageX, pageY, locationX: 0, locationY: 0 } };
}

it('gives a selection tick for each modifier toggle and a light tick for each fixed action', async () => {
  const props = await showRow({ ...NO_MODIFIERS, ctrl: true });
  jest.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error('unavailable'));
  for (const label of ['control', 'option', 'command', 'escape', 'tab', 'Panes', 'Keyboard']) {
    if (label === 'control' || label === 'command') key(label).onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    else key(label).onClick();
  }
  expect(props.onArm.mock.calls.flat()).toEqual(['ctrl', 'alt', 'cmd']);
  expect(props.onKey.mock.calls.map(([k]) => k.key)).toEqual(['Escape', 'Tab']);
  expect(props.onPanes).toHaveBeenCalledTimes(1);
  expect(props.onKeyboard).toHaveBeenCalledTimes(1);
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(3);
  expect(jest.mocked(Haptics.impactAsync).mock.calls.flat()).toEqual(Array(4).fill('light'));
});

it('ticks for each symbol sent by release or VoiceOver', async () => {
  const props = await showRow();
  const pair = key('minus underscore');
  await act(async () => {
    pair.onResponderGrant(touch(0, 0));
    pair.onResponderTerminate();
    pair.onResponderGrant(touch(0, 0));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    pair.onResponderRelease();
    pair.onResponderGrant(touch(0, 0));
    pair.onResponderMove(touch(0, 14));
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    pair.onResponderRelease();
    for (const actionName of ['activate', 'alternate']) {
      pair.onAccessibilityAction({ nativeEvent: { actionName } });
    }
  });
  expect(props.onSymbol.mock.calls.flat()).toEqual(['-', '_', '-', '_']);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(4);
});

it('ticks for the first arrow in a drag and each VoiceOver arrow', async () => {
  const props = await showRow();
  const arrows = key('arrows');
  jest.useFakeTimers();
  try {
    act(() => {
      arrows.onResponderGrant(touch(0, 0));
      arrows.onResponderMove(touch(1, 0));
      arrows.onResponderTerminate();
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(0);
      arrows.onResponderGrant(touch(0, 0));
      arrows.onResponderMove(touch(20, 0));
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(REPEAT_DELAY + REPEAT_INTERVAL);
      arrows.onResponderMove(touch(0, 20));
      arrows.onResponderRelease();
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
      arrows.onAccessibilityAction({ nativeEvent: { actionName: 'left' } });
    });
    expect(props.onKey.mock.calls.map(([k]) => k.key)).toEqual(['Right', 'Right', 'Right', 'Down', 'Left']);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it('keeps disabled keys silent and the Keyboard button available', async () => {
  const props = await showRow();
  await act(async () => { key('minus underscore').onResponderGrant(touch(0, 0)); });
  await act(async () => { renderer.update(<KeyRow {...props} keysDisabled panesDisabled />); });
  await act(async () => { key('minus underscore').onResponderRelease(); });
  for (const label of ['minus underscore', 'arrows']) {
    expect(key(label).onStartShouldSetResponder()).toBe(false);
    key(label).onAccessibilityAction({ nativeEvent: { actionName: label === 'arrows' ? 'up' : 'activate' } });
  }
  key('control').onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  for (const label of ['escape', 'Panes', 'Keyboard']) key(label).onClick();
  expect(props.onArm).not.toHaveBeenCalled();
  expect(props.onSymbol).not.toHaveBeenCalled();
  expect(props.onKey).not.toHaveBeenCalled();
  expect(props.onPanes).not.toHaveBeenCalled();
  expect(props.onKeyboard).toHaveBeenCalledTimes(1);
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
});


it('selects a tile on release and preserves the modifier on an empty tile or cancelled touch', async () => {
  const props = await showRow({ ...NO_MODIFIERS, ctrl: true });
  jest.useFakeTimers();
  try {
    const control = key('control');
    const command = key('command');
    act(() => {
      control.onResponderGrant(touch(34, 400));
      control.onResponderRelease(touch(34, 400));
      for (const point of [[16, 300], [128, 365], [128, 300], [34, 400]]) {
        control.onResponderGrant(touch(34, 400));
        jest.advanceTimersByTime(350);
        control.onResponderMove(touch(16, 300));
        control.onResponderRelease(touch(point[0], point[1]));
      }
      command.onResponderGrant(touch(330, 400));
      jest.advanceTimersByTime(350);
      command.onResponderRelease(touch(201, 365));
      command.onAccessibilityAction({ nativeEvent: { actionName: 'paste' } });
      control.onResponderGrant(touch(34, 400));
      control.onResponderMove(touch(34, 375));
      jest.advanceTimersByTime(350);
      control.onResponderRelease(touch(16, 300));
      control.onResponderGrant(touch(34, 400));
      control.onResponderTerminate();
      jest.advanceTimersByTime(350);
      control.onResponderRelease(touch(16, 300));
    });
    expect(props.onArm.mock.calls.flat()).toEqual(['ctrl']);
    expect(props.onQuickAction.mock.calls.flat()).toEqual(['interrupt', 'interrupt-twice', 'paste', 'paste']);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(6);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(4);
  } finally {
    jest.useRealTimers();
  }
});

it('discards an open grid when input closes', async () => {
  const props = await showRow();
  jest.useFakeTimers();
  try {
    act(() => {
      key('control').onResponderGrant(touch(34, 400));
      jest.advanceTimersByTime(350);
    });
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Interrupt')).toBe(true);
    act(() => renderer.update(<KeyRow {...props} keysDisabled />));
    act(() => renderer.update(<KeyRow {...props} />));
    act(() => key('control').onResponderRelease(touch(16, 300)));
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Interrupt')).toBe(false);
    expect(props.onQuickAction).not.toHaveBeenCalled();
    expect(props.onArm).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
