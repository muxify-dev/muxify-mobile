import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HeaderTitleButton, type HeaderTitle } from './terminal-header';

jest.mock('expo-router', () => ({ Stack: { Title: ({ children }: { children: React.ReactNode }) => children } }));
jest.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }));

let renderer: ReactTestRenderer;
const colors = { foreground: '#ffffff', dim: '#888888' };
const lines = () => renderer.root.findAllByType(Text).map((node) => node.props.children);

async function mount(title: HeaderTitle) {
  await act(async () => { renderer = create(<HeaderTitleButton title={title} colors={colors} onTitle={() => {}} />); });
}

afterEach(async () => { await act(async () => renderer?.unmount()); });

it("says with a spinner what tmux verb runs, in place of the Pane's program", async () => {
  await mount({ kind: 'session', session: 'work', program: 'vim', doing: 'Splitting the Pane' });
  expect(lines()).toEqual(['work', 'Splitting the Pane…']);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
});

it("shows the Pane's program when no verb runs", async () => {
  await mount({ kind: 'session', session: 'work', program: 'vim' });
  expect(lines()).toEqual(['work', 'vim']);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
});
