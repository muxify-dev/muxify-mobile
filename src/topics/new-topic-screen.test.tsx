import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';
import TopicFormScreen from '@/app/topic-form';
import { fakeHostServer, inDoubt, lost, refused, snapshotPush } from '@/test-support/fake-host-server';
import { toolbarButton } from '@/test-support/toolbar';

const mockLoad = jest.fn();
const mockCreate = jest.fn();
let mockServer = fakeHostServer();
const mockReplace = jest.fn();
const mockRouter = { back: jest.fn(), replace: mockReplace };
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ hostId: 'host' }),
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
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: mockLoad }) }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ onServer: mockServer.onServer }) }));
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockServer = fakeHostServer();
  // The `ok` of each `environment` request, or the error it ends with.
  mockServer.answer = (payload) => mockCreate(payload);
  mockServer.pushes.snapshot = snapshotPush();
  mockCreate.mockResolvedValue({ changed: { created: true, topic_id: 'new' } });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

const save = () => toolbarButton(renderer, 'Save');
const text = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label);
async function mount(title: string) {
  await act(async () => { renderer = create(<TopicFormScreen />); });
  renderer.root.findByType(TextField).props.text.value = title;
}

it('saves before the Tags read answers, with no Tag', async () => {
  mockServer.server.subscribe = () => Object.assign(new Promise(() => {}), { cancel: () => {} });
  await mount('Fix login');
  expect(save().props.disabled).toBe(false);
  await act(async () => { save().props.onPress(); });
  expect(mockServer.writes()).toEqual([{ version: 2, command: { create: { title: 'Fix login' } }, request: expect.any(String) }]);
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/topic-add-session' }));
});

it('keeps the title through a failed Tags read and its retry', async () => {
  const snapshot = mockServer.pushes.snapshot;
  delete mockServer.pushes.snapshot;
  await mount('Keep this title');
  mockServer.pushes.snapshot = snapshot;
  await act(async () => { button('Try again')!.props.onPress(); });
  expect(renderer.root.findByType(TextField).props.text.value).toBe('Keep this title');
});

it('sends one create for two taps, and shows it runs', async () => {
  let finish!: (value: unknown) => void;
  mockCreate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await mount('Fix login');
  await act(async () => { save().props.onPress(); save().props.onPress(); });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(save().props.disabled).toBe(true);
  expect(text()).toContain('Creating Fix login on Dev Host…');
  await act(async () => { finish(Promise.reject(refused('The Config is locked.', 'store_busy'))); });
  expect(text()).toContain('The Config is locked.');
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => { button('Retry')!.props.onPress(); });
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

it('checks a create the Host did not answer, and never sends it again by itself', async () => {
  mockCreate.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
  await mount('Fix login');
  await act(async () => { save().props.onPress(); });
  expect(text()).toContain(
    'The Host Server ended before it answered. It did not answer a second send of the same Request either. The Topic may exist.',
  );
  expect(save().props.disabled).toBe(true);
  await act(async () => { save().props.onPress(); });
  expect(mockCreate).toHaveBeenCalledTimes(2);

  await act(async () => { button('Check')!.props.onPress(); });
  expect(text()).toContain('Fix login is not on Dev Host. Save creates it.');
  expect(save().props.disabled).toBe(false);

  mockCreate.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
  await act(async () => { save().props.onPress(); });
  mockServer.pushes.snapshot = snapshotPush({ topics: [{ id: 'made', label: 'Fix login' }] });
  await act(async () => { button('Check')!.props.onPress(); });
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ topicId: 'made' }) }));
  expect(mockCreate).toHaveBeenCalledTimes(4);
});

describe('the Request id of a Save', () => {
  const sentId = (call: number) => mockServer.writes()[call]!.request;
  async function unanswered(title: string) {
    mockCreate.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await mount(title);
    await act(async () => { save().props.onPress(); });
    await act(async () => { button('Check')!.props.onPress(); });
  }

  it('stays the same for a Retry after a create that the Host did not answer', async () => {
    await unanswered('Fix login');
    await act(async () => { button('Retry')!.props.onPress(); });
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(sentId(1)).toBe(sentId(0));
    expect(sentId(2)).toBe(sentId(0));
  });

  it('is new when the title changes', async () => {
    await unanswered('Fix login');
    renderer.root.findByType(TextField).props.text.value = 'Fix logout';
    await act(async () => { save().props.onPress(); });
    expect(sentId(2)).not.toBe(sentId(0));
  });

  it('is new after the Host refuses, so the Host does not answer with the old refusal', async () => {
    mockCreate.mockRejectedValueOnce(refused('The Config does not define the Tag wrok.'));
    await mount('Fix login');
    await act(async () => { save().props.onPress(); });
    await act(async () => { button('Retry')!.props.onPress(); });
    expect(sentId(1)).not.toBe(sentId(0));
  });

  it('says the Topic may exist, and does not say Could not, when the Host has the Request in doubt', async () => {
    mockCreate.mockRejectedValueOnce(inDoubt('The Request changed the records and did not finish.'));
    await mount('Fix login');
    await act(async () => { save().props.onPress(); });
    expect(text()).toContain('The Request changed the records and did not finish. The Topic may exist.');
    expect(text()).not.toContain('Could not');
    expect(renderer.root.findByType(TextField).props.text.value).toBe('Fix login');
    expect(button('Check')).toBeDefined();
  });
});
