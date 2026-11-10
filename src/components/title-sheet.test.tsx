import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BottomSheet, Button, Picker, Text } from '@expo/ui/swift-ui';

import { TitleSheet, type TitleSheetProps } from './title-sheet';
import type { TopicId } from '@/topics/environment';
import type { TopicRow } from './host-screen-row-view';

jest.mock('@osuki-dev/react-native-ssh', () => ({ connect: jest.fn() }));
jest.mock('@expo/ui/swift-ui', () => ({
  BottomSheet: 'BottomSheet', Button: 'Button', Divider: 'Divider', Group: 'Group', Host: 'Host',
  HStack: 'HStack', Image: 'Image', Picker: 'Picker', ScrollView: 'ScrollView', Spacer: 'Spacer',
  Text: 'Text', Toggle: 'Toggle', VStack: 'VStack', ZStack: 'ZStack',
}));
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, {
  get: (_, name) => name === 'shapes' ? { rectangle: () => 'rectangle' } : (value: unknown) => ({ name, value }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({
  appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark,
  sheetPalette: require('@/constants/app-theme').sheetPaletteFor('default'),
}) }));

let renderer: ReactTestRenderer;
let props: TitleSheetProps;
beforeEach(() => {
  props = {
    lists: ['sessions', 'windows'],
    isPresented: true, onDismiss: jest.fn(), rows: [
      { kind: 'window', index: 0, name: 'shell', program: 'bash', current: true, mark: null },
    ], loading: false, onPick: jest.fn(), tabs: [
      { id: 'browser', url: 'http://host.test.ts.net:8000', title: 'Preview', active: true },
    ], onOpenTab: jest.fn(),
    sessions: { cards: [{ id: 'work', title: 'work', detail: 'work · 1 window', preview: ['hello'], current: true }], loading: false, onSelect: jest.fn() },
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });
async function mount() { await act(async () => { renderer = create(<TitleSheet {...props} />); }); }
async function select(tab: string) { await act(async () => renderer.root.findByType(Picker).props.onSelectionChange(tab)); }
function button(label: string) {
  return renderer.root.findAllByType(Button).find((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === label));
}

it('opens on Sessions and sends the picked Session without changing sheets', async () => {
  await mount();
  expect(renderer.root.findByType(Picker).props.selection).toBe('sessions');
  expect(button('Preview')).toBeUndefined();
  await act(async () => button('work')!.props.onPress());
  expect(props.sessions.onSelect).toHaveBeenCalledWith('work');
  expect(props.onDismiss).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(BottomSheet)).toHaveLength(1);
});

it('keeps Windows and Browser Tabs within the same chooser', async () => {
  await mount();
  await select('windows');
  expect(button('work')).toBeUndefined();
  await act(async () => button('shell')!.props.onPress());
  expect(props.onPick).toHaveBeenCalledWith({ session: null, window: 0 });
  await act(async () => button('Tab Preview')!.props.onPress());
  expect(props.onOpenTab).toHaveBeenCalledWith(props.tabs[0]);
  expect(props.onDismiss).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(BottomSheet)).toHaveLength(1);
});

it('shows Topics even when there are no Sessions', async () => {
  props.sessions.cards = [];
  props.lists = ['sessions', 'windows', 'topics'];
  props.topics = {
    sections: [{ id: 'topics', title: 'Topics', footer: null, rows: [{ kind: 'note', text: 'A Topic read is pending.' }] }],
    palette: require('@/constants/app-theme').AppPalettes.dark,
    onOpenTopic: jest.fn(), onRetry: jest.fn(),
  };
  await mount();
  await select('topics');
  const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
  expect(texts).toContain('A Topic read is pending.');
  expect(texts).not.toContain('No Sessions');
});

it('starts at Sessions after the chooser closes and opens again', async () => {
  await mount();
  await select('windows');
  await act(async () => renderer.update(<TitleSheet {...props} isPresented={false} />));
  await act(async () => renderer.update(<TitleSheet {...props} isPresented />));
  expect(renderer.root.findByType(Picker).props.selection).toBe('sessions');
});

it('passes an Empty Topic pick to the existing Host entry action', async () => {
  const id = 'topic' as TopicId;
  const topic: TopicRow = {
    kind: 'topic', id, label: 'Empty work', note: null, tags: [], mark: null, pinned: false, dimmed: true,
    seed: { id, label: 'Empty work', note: null, tags: [], state: 'empty', sessions: [] },
  };
  props.lists = ['sessions', 'windows', 'topics'];
  props.topics = {
    sections: [{ id: 'topics', title: 'Topics', footer: null, rows: [topic] }],
    palette: require('@/constants/app-theme').AppPalettes.dark,
    onOpenTopic: jest.fn(), onRetry: jest.fn(),
  };
  await mount();
  await select('topics');
  await act(async () => button('Topic Empty work')!.props.onPress());
  expect(props.topics.onOpenTopic).toHaveBeenCalledWith(topic);
  expect(props.onDismiss).not.toHaveBeenCalled();
});

it('offers only the configured lists in their order', async () => {
  await mount();
  const labels = renderer.root.findByType(Picker).findAllByType(Text).map((node) => node.props.children);
  expect(labels).toEqual(['Sessions', 'Windows']);
});

it('shows Windows directly when it is the only enabled list', async () => {
  props.lists = ['windows'];
  await mount();
  expect(renderer.root.findAllByType(Picker)).toHaveLength(0);
  expect(button('shell')).toBeDefined();
  expect(button('work')).toBeUndefined();
});

it('starts with the first configured list after each open', async () => {
  props.lists = ['windows', 'sessions'];
  await mount();
  await select('sessions');
  await act(async () => renderer.update(<TitleSheet {...props} isPresented={false} />));
  await act(async () => renderer.update(<TitleSheet {...props} isPresented />));
  expect(renderer.root.findByType(Picker).props.selection).toBe('windows');
});

it('shows a remaining list when the selected list is disabled', async () => {
  await mount();
  await act(async () => renderer.update(<TitleSheet {...props} lists={['windows']} />));
  expect(button('shell')).toBeDefined();
  expect(button('work')).toBeUndefined();
});
