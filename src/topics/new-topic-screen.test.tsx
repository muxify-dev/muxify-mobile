import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';
import { Stack } from 'expo-router';
import TopicFormScreen from '@/app/topic-form';

const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockCreate = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { back: jest.fn(), replace: mockReplace };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ hostId: 'host' }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', ScrollView: 'ScrollView',
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
jest.mock('@/ssh/connect-host', () => ({ describeConnectionFailure: (value: Error) => value.message }));
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host' }] });
  mockCreate.mockResolvedValue({ kind: 'created', topic: 'new' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });
function save() { return renderer.root.findByType(Stack.Screen).props.options.headerRight(); }
it('reads Tags without Host panel data and keeps the title through a failed read and retry', async () => {
  mockRead.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ kind: 'listed', snapshot: { tags: [] } });
  await act(async () => { renderer = create(<TopicFormScreen />); });
  renderer.root.findByType(TextField).props.text.value = 'Keep this title';
  expect(save().props.disabled).toBe(true);
  await act(async () => { save().props.onPress(); });
  expect(mockCreate).not.toHaveBeenCalled();
  const retry = renderer.root.findAllByType(Button).find((node) => node.props.label === 'Retry Tags')!;
  await act(async () => { retry.props.onPress(); });
  expect(renderer.root.findByType(TextField).props.text.value).toBe('Keep this title');
  expect(save().props.disabled).toBe(false);
  await act(async () => { save().props.onPress(); });
  expect(mockCreate).toHaveBeenCalledWith(expect.any(Function), 'Keep this title', []);
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/topic-add-session' }));
});
