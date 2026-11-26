import React from 'react';

import { ON_PANE } from '@/domain/destinations';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { TitleSheetProps } from '@/components/title-sheet';
import type { Place } from '@/storage/records';
import type { Attach, AttachState, SessionDestination } from '@/tmux/attach';

import { useTitleSheet } from './use-title-sheet';

/**
 * A Session picked from the Title Sheet's Sessions list opens at its Session
 * Place, as a Topic picked there opens at its Topic Place. The Attach is a
 * stand-in that records the switch; the Attach's own restore is tested in
 * `attach.test.ts`, and "Choose a Session" through `useHostEntry` in
 * `use-host-entry.test.tsx`.
 */

const mockPlaceFor = jest.fn();
const mockOpenSession = jest.fn();
let mockAttach: Attach | null = null;

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ isFocused: () => true }),
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (effect: () => (() => void) | void) => React.useEffect(() => effect(), [effect]),
  };
});
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/settings/settings-context', () => ({
  useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }),
  useChooserLists: () => ['sessions'],
}));
jest.mock('@/hooks/use-host-reading', () => ({
  useHostReading: () => ({
    topics: { kind: 'unasked' },
    listing: { phase: 'answered', sessions: [{ name: 'play', windowCount: 1 }] },
    read: async () => {},
    problem: null,
  }),
}));
jest.mock('@/hooks/use-host-entry', () => ({
  useHostEntry: () => ({ openSession: mockOpenSession, openTopic: jest.fn(), busyCard: null }),
}));
jest.mock('@/tmux/attach-context', () => ({ useAttachHolder: () => ({ current: () => mockAttach }) }));
jest.mock('@osuki-dev/react-native-ssh', () => ({ connect: jest.fn() }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }), placeFor: (...args: unknown[]) => mockPlaceFor(...args) }),
}));
jest.mock('@/tmux/ssh-connection', () => ({
  appConnections: () => ({ listing: () => null, subscribeListing: () => () => {} }),
}));

const TAB = { url: 'http://100.64.0.1:3000/', page: 'http://100.64.0.1:3000/docs', scrollY: 420 };
const playPlace: Place = {
  hostId: 'host', owner: { kind: 'session', session: 'play' }, session: 'play',
  window: { id: '@1', index: 1, name: 'editor' }, pane: '%3', tab: TAB, at: '2026-11-15T10:00:00.000Z',
};

/** An Attach on Session `work` with no Topic, whose switch lands on the Session asked for. */
function fakeAttach(typing: AttachState['typing'], topicAfter: AttachState['topic'] = null) {
  const switches: SessionDestination[] = [];
  let state = {
    sessionName: 'work', topic: null, typing,
    topology: { windows: [], activeWindow: null, panes: [] },
    sessions: [{ name: 'work', windowCount: 1 }, { name: 'play', windowCount: 2 }],
    previews: new Map(),
  } as unknown as AttachState;
  const attach = {
    hostId: 'host',
    state: () => state,
    subscribe: () => () => {},
    showTopic: () => () => {},
    refreshTopic: () => {},
    refreshTopology: () => {},
    capturePreviews: () => {},
    switchSession: async (destination: SessionDestination) => {
      switches.push(destination);
      state = { ...state, sessionName: destination.sessionName, topic: topicAfter };
    },
  } as unknown as Attach;
  return { attach, switches };
}

let renderer: ReactTestRenderer;
const moved = jest.fn();
const shownRef: { current: TitleSheetProps | null } = { current: null };

function Screen({ attach, seenRef }: { attach: Attach; seenRef: typeof shownRef }) {
  const { sheet } = useTitleSheet({ attach, state: attach.state(), hostId: 'host', onOpenTab: () => {}, onMoved: moved, onScreen: ON_PANE });
  React.useEffect(() => { seenRef.current = sheet; });
  return null;
}

async function mount(attach: Attach) {
  mockAttach = attach;
  await act(async () => { renderer = create(<Screen attach={attach} seenRef={shownRef} />); });
}

const pick = (session: string) => act(async () => { shownRef.current!.sessions.onSelect(session); });

beforeEach(() => {
  jest.clearAllMocks();
  mockPlaceFor.mockResolvedValue(playPlace);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

it('opens a Session picked from the Sessions list at its Session Place, its Tab included', async () => {
  const { attach, switches } = fakeAttach({ kind: 'open' });
  await mount(attach);

  await pick('play');

  expect(mockPlaceFor).toHaveBeenCalledWith('host', { kind: 'session', session: 'play' });
  expect(switches).toEqual([{ sessionName: 'play', topic: null, restore: playPlace }]);
  expect(moved).toHaveBeenCalledWith(TAB);
});

it('gives no Tab when the Topic held lists the Session, so the Topic stays and the Session Place does not apply', async () => {
  const { attach } = fakeAttach({ kind: 'open' }, { id: 't', view: { kind: 'loading' } } as unknown as AttachState['topic']);
  await mount(attach);

  await pick('play');

  expect(moved).toHaveBeenCalledWith(null);
});

it('reads no Place for a pick of the Session held now', async () => {
  const { attach, switches } = fakeAttach({ kind: 'open' });
  await mount(attach);

  await pick('work');

  expect(mockPlaceFor).not.toHaveBeenCalled();
  expect(switches).toEqual([{ sessionName: 'work', topic: null, restore: null }]);
  expect(moved).toHaveBeenCalledWith(null);
});

it('opens a Session chosen in place of one that has ended through the Host Screen\'s opener, which restores its Place', async () => {
  const { attach, switches } = fakeAttach({ kind: 'stopped', reason: null } as unknown as AttachState['typing']);
  await mount(attach);

  await pick('play');

  expect(mockOpenSession).toHaveBeenCalledWith('play');
  expect(switches).toEqual([]);
});
