import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';
import TopicFormScreen from '@/app/topic-form';
import { ExecDeadlineError } from '@/ssh/host-connections';
import { toolbarButton } from '@/test-support/toolbar';

const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockCreate = jest.fn();
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
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({
  read: mockRead, write: (_host: unknown, write: Function) => write({ exec: jest.fn() }, { create: mockCreate }),
}) }));
let renderer: ReactTestRenderer;
const listed = (topics: { id: string; label: string }[]) => ({ kind: 'listed', snapshot: {
  tags: [], sessions: [], no_topic: [], pinned: [],
  unpinned: { limit: 3, places: [], guests: [], bench: topics.map((topic) => ({ kind: 'topic', mark: null, sessions: [],
    topic: { ...topic, note: null, tags: [], state: 'empty' } })) },
} });
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockRead.mockResolvedValue(listed([]));
  mockCreate.mockResolvedValue({ kind: 'created', topic: 'new' });
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
  mockRead.mockReturnValue(new Promise(() => {}));
  await mount('Fix login');
  expect(save().props.disabled).toBe(false);
  await act(async () => { save().props.onPress(); });
  expect(mockCreate).toHaveBeenCalledWith(expect.any(Function), 'Fix login', []);
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/topic-add-session' }));
});

it('keeps the title through a failed Tags read and its retry', async () => {
  mockRead.mockRejectedValueOnce(new Error('offline'));
  await mount('Keep this title');
  await act(async () => { button('Retry Tags')!.props.onPress(); });
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
  await act(async () => { finish({ kind: 'failed', error: 'The Config is locked.' }); });
  expect(text()).toContain('The Config is locked.');
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => { button('Retry')!.props.onPress(); });
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

it('checks a create the Host did not answer, and never sends it again by itself', async () => {
  mockCreate.mockRejectedValueOnce(new ExecDeadlineError());
  await mount('Fix login');
  await act(async () => { save().props.onPress(); });
  expect(text()).toContain('The Host did not answer in time. The Topic may exist.');
  expect(save().props.disabled).toBe(true);
  await act(async () => { save().props.onPress(); });
  expect(mockCreate).toHaveBeenCalledTimes(1);

  await act(async () => { button('Check')!.props.onPress(); });
  expect(text()).toContain('Fix login is not on Dev Host. Save creates it.');
  expect(save().props.disabled).toBe(false);

  mockCreate.mockRejectedValueOnce(new ExecDeadlineError());
  await act(async () => { save().props.onPress(); });
  mockRead.mockResolvedValue(listed([{ id: 'made', label: 'Fix login' }]));
  await act(async () => { button('Check')!.props.onPress(); });
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ topicId: 'made' }) }));
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
