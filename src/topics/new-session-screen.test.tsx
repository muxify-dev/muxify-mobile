import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import SessionFormScreen from '@/app/session-form';
import { ExecDeadlineError } from '@/ssh/host-connections';
import { toolbarButton } from '@/test-support/toolbar';
import { TmuxError } from '@/tmux/tmux-error';

const mockLoad = jest.fn();
const mockCreateSession = jest.fn();
const mockListSessions = jest.fn();
const mockOpen = jest.fn();
const mockDismiss = jest.fn();
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => ({ back: jest.fn(), dismissTo: mockDismiss }),
  useLocalSearchParams: () => ({ hostId: 'host' }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', TextField: 'TextField',
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: mockLoad }) }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/attach-context', () => ({ useOpenSession: () => mockOpen }));
jest.mock('@/tmux/exec-runner', () => ({ execCommandRunner: () => ({}) }));
jest.mock('@/tmux/tmux-client', () => ({ TmuxClient: class {
  createSession = mockCreateSession;
  listSessions = mockListSessions;
} }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({
  read: (_host: unknown, work: Function) => work({ exec: jest.fn() }),
  write: (_host: unknown, work: Function) => work({ exec: jest.fn() }),
}) }));

let renderer: ReactTestRenderer;
const create_ = () => toolbarButton(renderer, 'Create');
const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockOpen.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function mount(name: string) {
  await act(async () => { renderer = create(<SessionFormScreen />); });
  renderer.root.findByType(TextField).props.text.value = name;
}

it("puts tmux's refusal of the name under the name, and lets the user send again", async () => {
  mockCreateSession.mockRejectedValueOnce(new TmuxError('duplicate session: notes'));
  await mount('notes');
  await act(async () => { create_().props.onPress(); });
  expect(texts()).toContain('A Session with that name is already running on this Host.');
  expect(create_().props.disabled).toBe(false);
  expect(mockOpen).not.toHaveBeenCalled();
});

it('checks a create the Host did not answer, then attaches to the Session it finds', async () => {
  mockCreateSession.mockRejectedValueOnce(new ExecDeadlineError());
  await mount('notes');
  await act(async () => { create_().props.onPress(); });
  expect(texts()).toContain('The Host did not answer in time. The Session may exist.');
  expect(create_().props.disabled).toBe(true);
  mockListSessions.mockResolvedValueOnce([{ name: 'notes', windowCount: 1 }]);
  await act(async () => { button('Check').props.onPress(); });
  expect(mockCreateSession).toHaveBeenCalledTimes(1);
  expect(mockOpen).toHaveBeenCalledWith({ hostId: 'host', destination: { sessionName: 'notes', topic: null }, keyboard: 'up' });
  expect(mockDismiss).toHaveBeenCalledWith('/terminal');
});
