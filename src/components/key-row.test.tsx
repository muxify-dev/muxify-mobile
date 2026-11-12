import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppPalettes } from '@/constants/app-theme';
import { NO_MODIFIERS } from '@/lib/modifier-keys';
import { KeyRow } from './key-row';

jest.mock('expo-glass-effect', () => ({ GlassView: 'GlassView', isGlassEffectAPIAvailable: () => false }));
jest.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }));
jest.mock('@expo/ui/community/masked-view', () => ({ MaskedView: 'MaskedView' }));

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

it.each(['dark', 'light'] as const)('draws readable keys on a runtime without glass, %s', async (appearance) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const palette = AppPalettes[appearance];
  await act(async () => {
    renderer = create(
      <KeyRow
        armed={NO_MODIFIERS} onArm={jest.fn()} onKey={jest.fn()} onSymbol={jest.fn()} onPanes={jest.fn()}
        onKeyboard={jest.fn()} keyboardVisible={false} keysDisabled={false} panesDisabled={false} palette={palette}
      />,
    );
  });

  const capsules = renderer.root.findAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style))
    .filter((style) => style?.borderRadius !== undefined && style.overflow === 'hidden' && style.backgroundColor);
  const labels = renderer.root.findAllByType(Text)
    .map((node) => StyleSheet.flatten(node.props.style)?.color)
    .filter((color): color is string => color === palette.toolbarTint);

  expect(capsules.length).toBeGreaterThan(0);
  expect(labels.length).toBeGreaterThan(0);
  for (const capsule of capsules) {
    expect(contrast(capsule.backgroundColor as string, palette.toolbarTint)).toBeGreaterThanOrEqual(4.5);
  }
});
