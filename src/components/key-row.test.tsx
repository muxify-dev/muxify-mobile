import React from 'react';
import * as ReactNative from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { NO_MODIFIERS } from '@/lib/modifier-keys';
import { KeyRow } from './key-row';

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

let renderer: ReactTestRenderer;
afterEach(async () => { await act(async () => renderer?.unmount()); });

it.each(['dark', 'light'] as const)('draws readable keys on its strip, %s', async (appearance) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(appearance);
  await act(async () => {
    renderer = create(
      <KeyRow
        armed={NO_MODIFIERS} onArm={jest.fn()} onKey={jest.fn()} onSymbol={jest.fn()} onPanes={jest.fn()}
        onKeyboard={jest.fn()} keyboardVisible={false} keysDisabled={false} panesDisabled={false}
        below={34}
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
