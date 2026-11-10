import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';
import { Stack } from 'expo-router';

import TopicAddSessionScreen from '@/app/topic-add-session';
import type { AddSessionRead } from './add-session';
import type { SessionPathsRead } from './session-paths';

const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockAdd = jest.fn();
const mockOpen = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
let mockCreated: string | undefined;
const mockRouter = { back: mockBack, dismissTo: mockDismiss };
const mockHolder = { current: () => null };

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ hostId: 'host', topicId: 'topic', created: mockCreated }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', Section: 'Section', Text: 'Text', TextField: 'TextField', VStack: 'VStack',
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: mockLoad }) }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/attach-context', () => ({ useAttachHolder: () => mockHolder, useOpenSession: () => mockOpen }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ read: mockRead, write: mockWrite }) }));
jest.mock('@/ssh/connect-host', () => ({ describeConnectionFailure: (value: Error) => value.message }));

const listed: SessionPathsRead = { kind: 'listed', choices: [
  { kind: 'session_path', name: 'project', label: 'Project', directory: ' /exact folder/ ', worktree: null, inThisTopic: true, alsoIn: [] },
] };
let renderer: ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreated = undefined;
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Host' }] });
  mockRead.mockResolvedValue(listed);
  mockAdd.mockResolvedValue({ kind: 'added', session: 'new-session' });
  mockWrite.mockImplementation((_host, write) => write({ exec: jest.fn() }, { addSession: mockAdd }));
  mockOpen.mockRejectedValue(new Error('Attach failed'));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

async function mount() { await act(async () => { renderer = create(<TopicAddSessionScreen />); }); }
function row() { return renderer.root.findAllByType(Button).find((button) => !button.props.label)!; }
function options() { return renderer.root.findByType(Stack.Screen).props.options; }
async function submit() { await act(async () => { options().headerRight().props.onPress(); }); }
async function type(value: string) {
  await act(async () => {
    const field = renderer.root.findByType(TextField);
    field.props.text.value = value;
    field.props.onTextChange(value);
  });
}

it('selects without a write, then creates once and reuses the Session after Attach fails', async () => {
  let finish!: (value: AddSessionRead) => void;
  mockAdd.mockImplementation(() => new Promise<AddSessionRead>((resolve) => { finish = resolve; }));
  await mount();
  const pick = row().props.onPress;
  await act(async () => { pick(); pick(); });
  expect(mockAdd).not.toHaveBeenCalled();
  const createSession = options().headerRight().props.onPress;
  await act(async () => { createSession(); createSession(); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd.mock.calls[0][2]).toBe(' /exact folder/ ');
  expect(options().gestureEnabled).toBe(false);
  await act(async () => { finish({ kind: 'added', session: 'new-session' }); });
  await act(async () => { pick(); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(options().headerRight().props.label).toBe('Retry Attach');
  mockOpen.mockResolvedValue(undefined);
  const retry = options().headerRight().props.onPress;
  await act(async () => { retry(); retry(); });
  expect(mockOpen).toHaveBeenCalledTimes(2);
  expect(mockOpen.mock.calls[1][0].destination.sessionName).toBe('new-session');
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockDismiss).toHaveBeenCalledWith('/terminal');
});

it('allows a deliberate new folder attempt after a refused write', async () => {
  mockAdd.mockResolvedValueOnce({ kind: 'failed', error: 'no directory' });
  await mount();
  await act(async () => { row().props.onPress(); });
  await submit();
  await act(async () => { row().props.onPress(); });
  await submit();
  expect(mockAdd).toHaveBeenCalledTimes(2);
  expect(mockOpen).toHaveBeenCalledTimes(1);
});

it('keeps typed entry last and available after a read failure', async () => {
  mockRead.mockResolvedValue({ kind: 'failed', error: 'read failed' });
  await mount();
  await type('  ~/folder with spaces  ');
  const buttons = renderer.root.findAllByType(Button);
  expect(buttons.map((button) => button.props.label)).toEqual(['Retry', 'Use ~/folder with spaces']);
  await act(async () => { buttons[1].props.onPress(); });
  expect(mockAdd).not.toHaveBeenCalled();
  await submit();
  expect(mockAdd.mock.calls[0][2]).toBe('~/folder with spaces');
});

it('ignores a late read after a successful write', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockRead.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await type('/typed');
  await act(async () => { renderer.root.findByType(Button).props.onPress(); });
  await submit();
  await act(async () => { finish({ kind: 'old' }); });
  expect(options().headerRight().props.label).toBe('Retry Attach');
  expect(renderer.root.findByType(TextField).props.placeholder).toBe('Search folders or type a path');
  expect(mockAdd).toHaveBeenCalledTimes(1);
});

it('preserves typed text when an old CLI answers and requires Create and open', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockRead.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await type('~/typed');
  await act(async () => { finish({ kind: 'old' }); });
  expect(renderer.root.findByType(TextField).props.text.value).toBe('~/typed');
  expect(options().headerRight().props.label).toBe('Create and open');
  await act(async () => { options().headerRight().props.onPress(); });
  expect(mockAdd.mock.calls[0][2]).toBe('~/typed');
});

it('does not act on a row callback after Cancel', async () => {
  await mount();
  const pick = row().props.onPress;
  await act(async () => { options().headerLeft().props.onPress(); pick(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockAdd).not.toHaveBeenCalled();
});

it('ignores a read after the sheet unmounts', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockRead.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { renderer.unmount(); finish(listed); });
  expect(mockAdd).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
});

it('ignores a read after Cancel before the sheet unmounts', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockRead.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { options().headerLeft().props.onPress(); });
  await act(async () => { finish({ kind: 'old' }); });
  expect(renderer.root.findByType(TextField).props.placeholder).toBe('Search folders or type a path');
  expect(options().headerRight().props.disabled).toBe(true);
});

it('offers Add later only after New Topic has saved', async () => {
  mockCreated = '1';
  await mount();
  expect(options().headerLeft().props.label).toBe('Add later');
  await act(async () => { options().headerLeft().props.onPress(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockAdd).not.toHaveBeenCalled();
});
