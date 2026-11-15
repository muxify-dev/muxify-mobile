import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import TopicEditScreen from '@/app/topic-edit';
import { ExecDeadlineError } from '@/ssh/host-connections';
import { toolbarButton } from '@/test-support/toolbar';


const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockChange = jest.fn();
const mockShow = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ hostId: 'host', topicId: 'topic',
    topic: require('./topic-edit').fieldsParam({ title: 'Fix login', note: null, tags: [] }) }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', ScrollView: 'ScrollView', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', TextField: 'TextField', Image: 'Image',
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: mockLoad }) }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/attach-context', () => ({ useAttachHolder: () => ({ current: () => null }) }));
jest.mock('@/ssh/connect-host', () => ({ describeConnectionFailure: (value: Error) => value.message }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({
  read: (_host: unknown, work: Function) => work({ exec: jest.fn() }, { read: mockRead, show: mockShow }),
  write: (_host: unknown, work: Function) => work({ exec: jest.fn() }, { change: mockChange }),
}) }));

let renderer: ReactTestRenderer;
const save = () => toolbarButton(renderer, 'Save');
const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;
const fields = () => renderer.root.findAllByType(TextField);

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockRead.mockResolvedValue({ kind: 'listed', snapshot: { tags: [] } });
  mockChange.mockResolvedValue({ kind: 'changed' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function mount() {
  await act(async () => { renderer = create(<TopicEditScreen />); });
}

it("puts the Host's refusal under its field, with no row above the form", async () => {
  mockChange.mockResolvedValueOnce({ kind: 'failed', error: 'That title is taken.' });
  await mount();
  fields()[0].props.text.value = 'Taken';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain('That title is taken.');
  expect(renderer.root.findAllByType(Button).some((node) => node.props.label === 'Retry')).toBe(false);
  expect(mockBack).not.toHaveBeenCalled();
});

it('checks an edit the Host did not answer, and closes when the Host has it', async () => {
  mockChange.mockRejectedValueOnce(new ExecDeadlineError());
  await mount();
  fields()[0].props.text.value = 'Fix the login';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain('The Host did not answer in time. The changes may be saved.');
  expect(save().props.disabled).toBe(true);
  expect(fields()[0].props.modifiers).toContainEqual({ name: 'disabled', value: true });

  mockShow.mockResolvedValueOnce({ kind: 'shown', topic: { label: 'Fix login', note: null, tags: [] } });
  await act(async () => { button('Check').props.onPress(); });
  expect(texts()).toContain('Some changes are not on Dev Host. Save sends them.');
  expect(save().props.disabled).toBe(false);

  mockChange.mockRejectedValueOnce(new ExecDeadlineError());
  await act(async () => { save().props.onPress(); });
  mockShow.mockResolvedValueOnce({ kind: 'shown', topic: { label: 'Fix the login', note: null, tags: [] } });
  await act(async () => { button('Check').props.onPress(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockChange).toHaveBeenCalledTimes(2);
});
