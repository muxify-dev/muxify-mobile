import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import NewTopicScreen from '@/app/new-topic';
import type { KeyboardHandlers } from '@/keyboard/key-commands';
import { fakeHostServer, lost, refused, snapshotPush, topicPush } from '@/test-support/fake-host-server';
import { toolbarButton, toolbarSide } from '@/test-support/toolbar';
import { sessionPathRowsJson, type SessionPathRow } from '@/topics/session-paths';

const mockLoad = jest.fn();
const mockCreate = jest.fn();
const mockPaths = jest.fn();
const mockAdd = jest.fn();
let mockServer = fakeHostServer();
const mockVisit = jest.fn();
const mockOpen = jest.fn();
const mockRouter = { back: jest.fn(), dismissTo: jest.fn() };
let mockKeys: KeyboardHandlers = {};
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ hostId: 'host' }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  const through = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', VStack: 'VStack', ScrollView: 'ScrollView', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', TextField: 'TextField', Image: 'Image', Spacer: 'Spacer',
    ContextMenu: Object.assign(through, { Items: through, Trigger: through }),
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/components/tappable-row', () => ({ TAPPABLE_ROW: {} }));
jest.mock('@/components/tag-choice', () => ({ TagChoice: 'TagChoice' }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/keyboard/key-commands', () => ({ useScreenKeyboardShortcuts: (handlers: KeyboardHandlers) => { mockKeys = handlers; } }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: mockLoad }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/attach-context', () => ({ useOpenSession: () => mockOpen }));
jest.mock('@/tmux/ssh-connection', () => {
  const exec = async (command: string) => ({ stdout: command.includes('$HOME') ? '/Users/me\n' : '', stderr: '', exitCode: 0 });
  const work = (_host: unknown, run: Function) => run({ exec });
  return { appConnections: () => ({ read: work, write: work, onServer: mockServer.onServer }) };
});

const path = (name: string, directory: string): SessionPathRow => ({ kind: 'session_path', name, label: name, directory, worktree: null, alsoIn: [], lastVisit: null });
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockServer = fakeHostServer();
  mockServer.pushes.snapshot = { ...snapshotPush(), tags: [{ name: 'work', color: { light: '#5e8c6a', dark: '#7fa88a' } }] };
  // The `ok` of each `environment` request, or the error it ends with.
  mockServer.answer = (payload) => {
    const { command } = (payload as { environment: { command: Record<string, unknown> } }).environment;
    return 'create' in command ? mockCreate(command.create) : mockAdd(command.add_session);
  };
  mockCreate.mockResolvedValue({ changed: { created: true, topic_id: 'new' } });
  // The Host's ranked rows for each `session_paths`, and the visits it records.
  mockServer.on.session_paths = async (asked) => sessionPathRowsJson(await mockPaths(asked));
  mockServer.on.visit_session_path = mockVisit;
  mockPaths.mockResolvedValue([path('mobile', '/work/muxify mobile'), path('api', '/work/api')]);
  mockAdd.mockResolvedValue({ changed: { session_name: 'mobile/quick-topic' } });
  mockVisit.mockResolvedValue({});
  mockOpen.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

/** The Topic each `add_session` went to, and its Request id. */
const addTargets = () => mockServer.writes().filter((write) => 'add_session' in write.command).map(({ target, request }) => ({ target, request }));

const text = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label);
const folder = (directory: string) => renderer.root.findAllByType(Button)
  .find((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === `Folder ${directory}`))!;
const field = () => renderer.root.findByType(TextField);
/** Return on the keyboard, which the field takes through its onSubmit modifier. */
const pressReturn = () => field().props.modifiers.find((modifier: { name: string }) => modifier.name === 'onSubmit').value();

async function mount(title: string) {
  await act(async () => { renderer = create(<NewTopicScreen />); });
  field().props.text.value = title;
}
async function toAddSession() {
  await mount('Quick topic');
  await act(async () => { pressReturn(); });
}

describe('the title step', () => {
  it('refuses an empty title, and sends nothing', async () => {
    await mount('   ');
    await act(async () => { pressReturn(); });

    expect(text()).toContain('Give the Topic a title.');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(toolbarSide(renderer, 'left').props.children).toBe('Cancel');
  });

  it('sends the title and the chosen Tags on Return, and becomes Add a Session with the list already there', async () => {
    await mount(' Quick topic ');
    await act(async () => { renderer.root.findByType('TagChoice' as never).props.onPress(); });
    await act(async () => { pressReturn(); });

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Quick topic', tags: ['work'] });
    expect(toolbarSide(renderer, 'left').props.children).toBe('Add later');
    expect(folder('/work/muxify mobile')).toBeDefined();
    expect(folder('/work/api')).toBeDefined();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('reads the folders when the sheet opens, before the title is sent', async () => {
    await mount('Quick topic');

    expect(mockPaths).toHaveBeenCalledWith({});
  });

  it('stays on the title with the reason when the Host refuses, and creates on Retry', async () => {
    mockCreate.mockRejectedValueOnce(refused('The Config is locked.', 'store_busy'));
    await mount('Quick topic');
    await act(async () => { toolbarButton(renderer, 'Create').props.onPress(); });

    expect(text()).toContain('The Config is locked.');
    expect(toolbarSide(renderer, 'left').props.children).toBe('Cancel');

    await act(async () => { button('Retry')!.props.onPress(); });
    expect(toolbarSide(renderer, 'left').props.children).toBe('Add later');
  });

  it('checks a create the Host did not answer, and goes on with the Topic the Host has', async () => {
    mockCreate.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await mount('Quick topic');
    await act(async () => { pressReturn(); });
    expect(text()).toContain('The Topic may exist.');

    mockServer.pushes.snapshot = snapshotPush({ topics: [{ id: 'made', label: 'Quick topic' }] });
    await act(async () => { button('Check')!.props.onPress(); });
    await act(async () => { folder('/work/api').props.onPress(); });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(addTargets()[0]!.target).toEqual({ topic: { id: 'made' } });
  });
});

describe('the Add a Session step', () => {
  it('adds a Session at the folder with the name of its Session Path, opens it in the Topic, and records the visit', async () => {
    await toAddSession();
    await act(async () => { folder('/work/muxify mobile').props.onPress(); });

    expect(mockAdd).toHaveBeenCalledWith({
      directory: '/work/muxify mobile', working_copy: { directory: {} }, name: 'mobile', chosen_name: 'mobile',
    });
    expect(addTargets()).toEqual([{ target: { topic: { id: 'new' } }, request: expect.any(String) }]);
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host',
      destination: { sessionName: 'mobile/quick-topic', topic: expect.objectContaining({ id: 'new' }) },
      keyboard: 'up',
    }));
    expect(mockVisit).toHaveBeenCalledWith({ folder: '/work/muxify mobile' });
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/terminal');
  });

  it('picks the first row on Return, and the row that ↓ moved to', async () => {
    await toAddSession();
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-pick']!(); });

    expect(mockAdd.mock.calls[0][0].directory).toBe('/work/api');
  });

  it('adds the Session in a new Worktree for ⌥↩ and for the item of the long-press menu', async () => {
    mockPaths.mockResolvedValue([
      { ...path('mobile', '/work/muxify mobile'), worktree: { path: '/work/muxify mobile', branch: 'main' } },
    ]);
    await toAddSession();
    await act(async () => { mockKeys['list-worktree']!(); });

    // The Host names the new Worktree's Session from its branch, so there is no exact name.
    expect(mockAdd).toHaveBeenCalledWith({
      directory: '/work/muxify mobile', working_copy: { new_worktree: { from: '/work/muxify mobile' } }, name: 'mobile',
    });
    expect(button('In a new Worktree')).toBeDefined();
  });

  it('uses a folder the user typed, named as the Host names a Session Path', async () => {
    mockPaths.mockResolvedValue([]);
    await toAddSession();
    await act(async () => { field().props.onTextChange('~/Dev/new app'); });
    await act(async () => { folder('~/Dev/new app').props.onPress(); });

    // The Host Server takes only absolute folders, so ~ is the Host's home.
    expect(mockAdd).toHaveBeenCalledWith({ directory: '/Users/me/Dev/new app', working_copy: { directory: {} }, chosen_name: 'newapp' });
  });

  it('keeps the Empty Topic and adds nothing on Add later, also with Escape', async () => {
    await toAddSession();
    await act(async () => { toolbarSide(renderer, 'left').props.onPress(); });
    await act(async () => { mockKeys['list-close']!(); });

    expect(mockRouter.back).toHaveBeenCalledTimes(2);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('sends the same Request on a Retry after no answer, so the Host makes one Session', async () => {
    mockAdd.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    mockServer.pushes.topic = topicPush('new', 'Quick topic');
    await toAddSession();
    await act(async () => { folder('/work/api').props.onPress(); });
    expect(text()).toContain('The Session may exist.');
    await act(async () => { button('Check')!.props.onPress(); });
    await act(async () => { button('Retry')!.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(3);
    expect(mockAdd.mock.calls[2]).toEqual(mockAdd.mock.calls[0]);
    expect(new Set(addTargets().map(({ request }) => request)).size).toBe(1);
  });

  it('opens the Session that a check finds, and sends no second add', async () => {
    mockAdd.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    mockServer.pushes.topic = topicPush('new', 'Quick topic', [{ id: '$1', name: 'api/quick-topic' }]);
    await toAddSession();
    await act(async () => { folder('/work/api').props.onPress(); });
    await act(async () => { button('Check')!.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(mockOpen.mock.calls[0][0].destination.sessionName).toBe('api/quick-topic');
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/terminal');
  });

  it('attaches again on Retry Attach, and sends no second add', async () => {
    mockOpen.mockRejectedValueOnce(new Error('no route'));
    await toAddSession();
    await act(async () => { folder('/work/api').props.onPress(); });
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();

    await act(async () => { button('Retry Attach')!.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/terminal');
  });
});
