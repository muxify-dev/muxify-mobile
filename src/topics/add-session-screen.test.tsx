import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';
import { fakeHostServer, lost, refused, snapshotPush, topicPush } from '@/test-support/fake-host-server';
import { toolbarSide } from '@/test-support/toolbar';

import TopicAddSessionScreen from '@/app/topic-add-session';

const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockPaths = jest.fn();
let mockServer = fakeHostServer();
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
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ read: mockRead, onServer: mockServer.onServer }) }));
jest.mock('@/ssh/connect-host', () => ({ describeConnectionFailure: (value: Error) => value.message }));

/** The `ok` of `session_paths { topic }`: the Topic's folder choices, as the Host Server gives them. */
const listed = { topic: { id: 'topic', label: 'Fix login' }, sessions: [], rows: [
  { kind: 'session_path', name: 'project', label: 'Project', directory: ' /exact folder/ ', worktree: null, in_this_topic: true, also_in: [], last_visit: null },
] };
let renderer: ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreated = undefined;
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Host' }] });
  mockPaths.mockResolvedValue(listed);
  mockRead.mockImplementation((_host, read) => read({ exec: home }));
  mockServer = fakeHostServer();
  mockServer.on.session_paths = mockPaths;
  // The `ok` of each `add_session`, or the error it ends with.
  mockServer.answer = (payload) => mockAdd((payload as { environment: { command: { add_session: unknown } } }).environment.command.add_session);
  mockServer.pushes.snapshot = snapshotPush();
  mockAdd.mockResolvedValue(added('new-session'));
  mockOpen.mockRejectedValue(new Error('Attach failed'));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

/** An exec on the Host whose shell has /Users/me as its home. */
const home = async (command: string) => ({ stdout: command.includes('$HOME') ? '/Users/me' : '', stderr: '', exitCode: 0 });
const added = (session: string) => ({ changed: { session_name: session } });

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

it('asks the Host Server for the folder choices of the Topic, and lists them', async () => {
  await mount();

  expect(mockServer.requests).toEqual([{ session_paths: { topic: 'topic' } }]);
  expect(row().props.modifiers).toContainEqual({ name: 'accessibilityLabel', value: 'Select folder  /exact folder/ ' });
});

it('selects without a write, then creates once and reuses the Session after Attach fails', async () => {
  let finish!: (value: unknown) => void;
  mockAdd.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  const pick = row().props.onPress;
  await act(async () => { pick(); pick(); });
  expect(mockAdd).not.toHaveBeenCalled();
  const createSession = right().props.onPress;
  await act(async () => { createSession(); createSession(); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd.mock.calls[0][0].directory).toBe(' /exact folder/ ');
  expect(sheetGesture()).toBe(false);
  await act(async () => { finish(added('new-session')); });
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
  mockAdd.mockRejectedValueOnce(refused('no directory', 'session_path_unavailable'));
  await mount();
  await act(async () => { row().props.onPress(); });
  await submit();
  await act(async () => { row().props.onPress(); });
  await submit();
  expect(mockAdd).toHaveBeenCalledTimes(2);
  expect(mockOpen).toHaveBeenCalledTimes(1);
});

it('keeps typed entry last and available after a read failure', async () => {
  mockPaths.mockRejectedValue(refused('read failed', 'config_invalid'));
  await mount();
  await type('  ~/folder with spaces  ');
  const buttons = renderer.root.findAllByType(Button);
  expect(buttons.map((button) => button.props.label)).toEqual(['Try again', 'Use ~/folder with spaces']);
  await act(async () => { buttons[1].props.onPress(); });
  expect(mockAdd).not.toHaveBeenCalled();
  await submit();
  // The Host Server takes only absolute folders, so ~ is the Host's home.
  expect(mockAdd.mock.calls[0][0].directory).toBe('/Users/me/folder with spaces');
});

it('ignores a late read after a successful write', async () => {
  let finish!: (value: unknown) => void;
  mockPaths.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await type('/typed');
  await act(async () => { renderer.root.findByType(Button).props.onPress(); });
  await submit();
  await act(async () => { finish(listed); });
  expect(right().props.children).toBe('Retry Attach');
  expect(renderer.root.findByType(TextField).props.placeholder).toBe('Search folders or type a path');
  expect(mockAdd).toHaveBeenCalledTimes(1);
});

it('preserves typed text when the folder choices arrive', async () => {
  let finish!: (value: unknown) => void;
  mockPaths.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await type('~/typed');
  await act(async () => { finish(listed); });
  expect(renderer.root.findByType(TextField).props.text.value).toBe('~/typed');
  expect(right().props.children).toBe('Create and open');
});

it('does not act on a row callback after Cancel', async () => {
  await mount();
  const pick = row().props.onPress;
  await act(async () => { left().props.onPress(); pick(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockAdd).not.toHaveBeenCalled();
});

it('ignores a read after the sheet unmounts', async () => {
  let finish!: (value: unknown) => void;
  mockPaths.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { renderer.unmount(); finish(listed); });
  expect(mockAdd).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
});

it('ignores a read after Cancel before the sheet unmounts', async () => {
  let finish!: (value: unknown) => void;
  mockPaths.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { left().props.onPress(); });
  await act(async () => { finish(listed); });
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
  mockServer.pushes.topic = topicPush('topic', 'Fix login', [{ id: '$1', name: 'fix-login' }]);
  mockAdd.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
  mockOpen.mockResolvedValue(undefined);
  await mount();
  await act(async () => { row().props.onPress(); });
  await submit();
  expect(right().props.disabled).toBe(true);
  const check = renderer.root.findAllByType(Button).find((button) => button.props.label === 'Check')!;
  await act(async () => { check.props.onPress(); });
  expect(mockAdd).toHaveBeenCalledTimes(2);
  expect(mockOpen.mock.calls[0][0].destination.sessionName).toBe('fix-login');
  expect(mockDismiss).toHaveBeenCalledWith('/terminal');
});

describe('the Session name and the Request id', () => {
  const sessions = (...names: string[]) =>
    snapshotPush({ sessions: names.map((name, index) => ({ id: `$${index + 1}`, name, topic: 'topic' })) });
  beforeEach(() => {
    mockServer.pushes.topic = topicPush('topic', 'Fix login');
  });
  const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;

  it('sends a Session name that the Topic does not have, as the pushed Listing has its Sessions', async () => {
    mockServer.pushes.snapshot = sessions('project/fix-login');
    await mount();
    await act(async () => { row().props.onPress(); });
    await submit();

    expect(mockServer.writes()).toEqual([{
      version: 2,
      command: { add_session: { directory: ' /exact folder/ ', working_copy: { directory: {} }, name: 'project', chosen_name: 'project+2' } },
      target: { topic: { id: 'topic' } },
      request: expect.any(String),
    }]);
  });

  it('sends the same Request and the same name on a Retry after no answer', async () => {
    mockAdd.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await mount();
    await act(async () => { row().props.onPress(); });
    await submit();
    mockServer.pushes.snapshot = sessions('project/fix-login');
    await act(async () => { button('Check').props.onPress(); });
    await act(async () => { button('Retry').props.onPress(); });

    const [first, second, retry] = mockServer.writes();
    expect(mockServer.writes()).toHaveLength(3);
    expect(second).toEqual(first);
    expect(retry).toEqual(first);
    expect(first!.command).toMatchObject({ add_session: { chosen_name: 'project' } });
  });
});
