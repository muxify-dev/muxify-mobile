import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';
import { ExecDeadlineError } from '@/ssh/host-connections';
import { toolbarSide } from '@/test-support/toolbar';

import TopicAddSessionScreen from '@/app/topic-add-session';
import type { AddSessionRead } from './add-session';
import type { SessionPathsRead } from './session-paths';

const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockPaths = jest.fn();
const mockTopics = jest.fn();
const mockWrite = jest.fn();
const mockAdd = jest.fn();
const mockOpen = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
let mockCreated: string | undefined;
const mockRouter = { back: mockBack, dismissTo: mockDismiss };
const mockHolder = { current: () => null };

jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ hostId: 'host', topicId: 'topic', created: mockCreated }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', ProgressView: 'ProgressView', Section: 'Section', Text: 'Text', TextField: 'TextField', VStack: 'VStack',
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
  mockPaths.mockResolvedValue(listed);
  mockTopics.mockResolvedValue({ kind: 'old' });
  mockRead.mockImplementation((_host, read) => read({ exec: jest.fn() }, { sessionPaths: mockPaths, read: mockTopics }));
  mockAdd.mockResolvedValue({ kind: 'added', session: 'new-session' });
  mockWrite.mockImplementation((_host, write) => write({ exec: jest.fn() }, { addSession: mockAdd }));
  mockOpen.mockRejectedValue(new Error('Attach failed'));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

async function mount() { await act(async () => { renderer = create(<TopicAddSessionScreen />); }); }
function row() { return renderer.root.findAllByType(Button).find((button) => button.props.label === undefined)!; }
const right = () => toolbarSide(renderer, 'right');
const left = () => toolbarSide(renderer, 'left');
const sheetGesture = () => renderer.root.find((node) => node.props.options?.title === 'Add a Session').props.options.gestureEnabled;
async function submit() { await act(async () => { right().props.onPress(); }); }
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
  const createSession = right().props.onPress;
  await act(async () => { createSession(); createSession(); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd.mock.calls[0][2]).toBe(' /exact folder/ ');
  expect(sheetGesture()).toBe(false);
  await act(async () => { finish({ kind: 'added', session: 'new-session' }); });
  await act(async () => { pick(); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(right().props.children).toBe('Retry Attach');
  mockOpen.mockResolvedValue(undefined);
  const retry = right().props.onPress;
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
  mockPaths.mockResolvedValue({ kind: 'failed', error: 'read failed' });
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
  mockPaths.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await type('/typed');
  await act(async () => { renderer.root.findByType(Button).props.onPress(); });
  await submit();
  await act(async () => { finish({ kind: 'old' }); });
  expect(right().props.children).toBe('Retry Attach');
  expect(renderer.root.findByType(TextField).props.placeholder).toBe('Search folders or type a path');
  expect(mockAdd).toHaveBeenCalledTimes(1);
});

it('preserves typed text when an old CLI answers and requires Create and open', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockPaths.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await type('~/typed');
  await act(async () => { finish({ kind: 'old' }); });
  expect(renderer.root.findByType(TextField).props.text.value).toBe('~/typed');
  expect(right().props.children).toBe('Create and open');
  await act(async () => { right().props.onPress(); });
  expect(mockAdd.mock.calls[0][2]).toBe('~/typed');
});

it('does not act on a row callback after Cancel', async () => {
  await mount();
  const pick = row().props.onPress;
  await act(async () => { left().props.onPress(); pick(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockAdd).not.toHaveBeenCalled();
});

it('ignores a read after the sheet unmounts', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockPaths.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { renderer.unmount(); finish(listed); });
  expect(mockAdd).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
});

it('ignores a read after Cancel before the sheet unmounts', async () => {
  let finish!: (value: SessionPathsRead) => void;
  mockPaths.mockImplementation(() => new Promise<SessionPathsRead>((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { left().props.onPress(); });
  await act(async () => { finish({ kind: 'old' }); });
  expect(renderer.root.findByType(TextField).props.placeholder).toBe('Search folders or type a path');
  expect(right().props.disabled).toBe(true);
});

it('offers Add later only after New Topic has saved', async () => {
  mockCreated = '1';
  await mount();
  expect(left().props.children).toBe('Add later');
  await act(async () => { left().props.onPress(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockAdd).not.toHaveBeenCalled();
});

it('checks a write the Host did not answer, and opens the new Session of the Topic', async () => {
  const mockShow = jest.fn().mockResolvedValue({ kind: 'shown', topic: { label: 'Fix login', sessions: [{ id: 's1', name: 'fix-login' }] } });
  mockRead.mockImplementation((_host, work) => work({ exec: jest.fn() }, { sessionPaths: async () => listed, read: mockTopics, show: mockShow }));
  mockAdd.mockRejectedValueOnce(new ExecDeadlineError());
  mockOpen.mockResolvedValue(undefined);
  await mount();
  await act(async () => { row().props.onPress(); });
  await submit();
  expect(right().props.disabled).toBe(true);
  const check = renderer.root.findAllByType(Button).find((button) => button.props.label === 'Check')!;
  await act(async () => { check.props.onPress(); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockOpen.mock.calls[0][0].destination.sessionName).toBe('fix-login');
  expect(mockDismiss).toHaveBeenCalledWith('/terminal');
});

describe('on a Host CLI that takes a Request id', () => {
  const topics = (sessions: { name: string; topic: string }[]) => ({
    kind: 'listed', capabilities: ['request'], snapshot: { sessions },
  });
  const mockShow = jest.fn();
  beforeEach(() => {
    mockShow.mockResolvedValue({ kind: 'shown', topic: { label: 'Fix login', sessions: [] } });
    mockRead.mockImplementation((_host, read) => read({ exec: jest.fn() }, { sessionPaths: mockPaths, read: mockTopics, show: mockShow }));
  });
  const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;

  it('sends a Session name that the Topic does not have', async () => {
    mockTopics.mockResolvedValue(topics([{ name: 'project/fix-login', topic: 'topic' }]));
    await mount();
    await act(async () => { row().props.onPress(); });
    await submit();

    expect(mockAdd.mock.calls[0].slice(1)).toEqual(['topic', ' /exact folder/ ', expect.any(String), 'project+2']);
  });

  it('sends the same Request and the same name on a Retry after no answer', async () => {
    mockTopics
      .mockResolvedValueOnce(topics([]))
      .mockResolvedValue(topics([{ name: 'project/fix-login', topic: 'topic' }]));
    mockAdd.mockRejectedValueOnce(new ExecDeadlineError());
    await mount();
    await act(async () => { row().props.onPress(); });
    await submit();
    await act(async () => { button('Check').props.onPress(); });
    await act(async () => { button('Retry').props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(mockAdd.mock.calls[1].slice(3)).toEqual(mockAdd.mock.calls[0].slice(3));
    expect(mockAdd.mock.calls[0][4]).toBe('project');
  });
});
