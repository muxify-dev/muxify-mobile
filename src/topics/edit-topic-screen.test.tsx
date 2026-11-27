import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import TopicEditScreen from '@/app/topic-edit';
import { fakeHostServer, lost, refused, snapshotPush, topicPush } from '@/test-support/fake-host-server';
import { toolbarButton } from '@/test-support/toolbar';


const mockLoad = jest.fn();
const mockChange = jest.fn();
let mockServer = fakeHostServer();
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
jest.mock('@/ssh/connect-host', () => ({ describeConnectionFailure: (value: Error) => value.message }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({
  onServer: mockServer.onServer,
}) }));

let renderer: ReactTestRenderer;
const save = () => toolbarButton(renderer, 'Save');
const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;
const fields = () => renderer.root.findAllByType(TextField);

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockServer = fakeHostServer();
  mockServer.pushes.snapshot = snapshotPush();
  // The `ok` of each `environment` request, or the error it ends with.
  mockServer.answer = (payload) => mockChange((payload as { environment: unknown }).environment);
  mockChange.mockResolvedValue({ changed: { topic_id: 'topic' } });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function mount() {
  await act(async () => { renderer = create(<TopicEditScreen />); });
}

it("puts the Host's refusal under its field, with no row above the form", async () => {
  mockChange.mockRejectedValueOnce(refused('That title is taken.', 'topic_unavailable'));
  await mount();
  fields()[0].props.text.value = 'Taken';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain('That title is taken.');
  expect(renderer.root.findAllByType(Button).some((node) => node.props.label === 'Retry')).toBe(false);
  expect(mockBack).not.toHaveBeenCalled();
});

it('checks an edit the Host did not answer, and closes when the Host has it', async () => {
  mockChange.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
  await mount();
  fields()[0].props.text.value = 'Fix the login';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain(
    'The Host Server ended before it answered. It did not answer a second send of the same Request either. The changes may be saved.',
  );
  expect(save().props.disabled).toBe(true);
  expect(fields()[0].props.modifiers).toContainEqual({ name: 'disabled', value: true });

  mockServer.pushes.topic = topicPush('topic', 'Fix login');
  await act(async () => { button('Check').props.onPress(); });
  expect(texts()).toContain('Some changes are not on Dev Host. Save sends them.');
  expect(save().props.disabled).toBe(false);

  mockChange.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
  await act(async () => { save().props.onPress(); });
  mockServer.pushes.topic = topicPush('topic', 'Fix the login');
  await act(async () => { button('Check').props.onPress(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockChange).toHaveBeenCalledTimes(4);
  // Each Save is a new Request, sent two times when its answer is lost.
  const [first, again, second] = mockServer.writes();
  expect(first).toEqual({ version: 2, command: { rename: { title: 'Fix the login' } }, target: { topic: { id: 'topic' } }, request: expect.any(String) });
  expect(again!.request).toBe(first!.request);
  expect(second!.request).not.toBe(first!.request);
});

it('sends each changed field as its own write, and reads nothing after the Save', async () => {
  await mount();
  fields()[1].props.text.value = 'Bisect';
  await act(async () => { save().props.onPress(); });
  expect(mockServer.writes().map((write) => write.command)).toEqual([{ note: { text: 'Bisect' } }]);
  expect(mockServer.requests).toHaveLength(1);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('shows the form at once, and saves the title while the Tags are on their way', async () => {
  mockServer.server.subscribe = () => Object.assign(new Promise<unknown>(() => {}), { cancel: () => {} });
  await mount();
  expect(fields()).toHaveLength(2);
  expect(texts()).toContain('Reading Tags…');

  fields()[0].props.text.value = 'Fix the login';
  await act(async () => { save().props.onPress(); });
  expect(mockServer.writes().map((write) => write.command)).toEqual([{ rename: { title: 'Fix the login' } }]);
});

it('says why the Tags could not be read, and reads them again on Try again', async () => {
  delete mockServer.pushes.snapshot;
  await mount();
  expect(texts()).toContain('no push of snapshot in this test');
  expect(fields()).toHaveLength(2);

  mockServer.pushes.snapshot = snapshotPush();
  await act(async () => { button('Try again').props.onPress(); });
  expect(texts()).not.toContain('no push of snapshot in this test');
  expect(texts()).not.toContain('Reading Tags…');
});
