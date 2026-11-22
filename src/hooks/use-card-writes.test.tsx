import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ExecDeadlineError } from '@/ssh/host-connections';
import { WriteOutcomeUnknown } from '@/topics/request';
import type { CardOrder } from '@/topics/act-on-card';
import type { BoardCard } from '@/topics/board-card';
import type { BoardSessionId, SessionId, TopicId } from '@/topics/environment';
import type { ClosingAction } from '@/topics/host-writes';
import type { TopicWrite } from '@/topics/topic-edit';

import { useCardWrites, type CardSends } from './use-card-writes';

jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({}) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));

const TOPIC = 'topic' as TopicId;
const TOPIC_CARD: BoardCard = { kind: 'topic', id: TOPIC };
const LIVE: BoardCard = { kind: 'live-session', session: '$4' as SessionId };
const DORMANT: BoardCard = { kind: 'dormant-session', id: 's1' as BoardSessionId };
const MOVE_UP: CardOrder = { kind: 'action', action: 'move-up' };
const TRADE: CardOrder = { kind: 'drop', drop: { kind: 'trade', with: { kind: 'topic', id: 'other' as TopicId } } };
const REOPEN: CardOrder = { kind: 'wake', wake: 'reopen' };

let renderer: ReactTestRenderer;
let card: ReturnType<typeof useCardWrites>;
const order: string[] = [];

type Send = jest.Mock<Promise<TopicWrite>, [unknown, unknown, unknown, () => void]>;

async function mount(sends: { order?: Send; close?: Send }) {
  function Screen() {
    card = useCardWrites('host', { order: sends.order ?? jest.fn(), close: sends.close ?? jest.fn() } as unknown as CardSends);
    return null;
  }
  await act(async () => { renderer = create(<Screen />); });
}

/** A Host that answers each order in turn, after `sending`. */
function host(...answers: (TopicWrite | Error)[]): Send {
  return jest.fn(async (_host, _target, _order, sending) => {
    order.push('write');
    sending();
    const answer = answers.shift()!;
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

/** A Host that answers when the test says. */
function held(): { send: Send; finish: (write: TopicWrite) => void } {
  let finish!: (write: TopicWrite) => void;
  const send: Send = jest.fn((_host, _target, _order, sending) => {
    sending();
    return new Promise<TopicWrite>((resolve) => { finish = resolve; });
  });
  return { send, finish: (write) => finish(write) };
}

beforeEach(() => {
  order.length = 0;
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

describe('a write from a card', () => {
  it('writes to the Host, and reads nothing after: the Host Server pushes the change', async () => {
    const send = host({ kind: 'changed' });
    await mount({ order: send });
    await act(async () => { await card.order(TOPIC_CARD, MOVE_UP); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), TOPIC_CARD, MOVE_UP, expect.any(Function));
    expect(order).toEqual(['write']);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows the Host's reason on a refusal, and reads nothing after", async () => {
    await mount({ order: host({ kind: 'failed', error: 'The card is at the top.' }) });
    await act(async () => { await card.order(TOPIC_CARD, MOVE_UP); });
    expect(Alert.alert).toHaveBeenCalledWith('Could not Move Up', 'The card is at the top.');
    expect(order).toEqual(['write']);
  });

  it('marks the card while it runs, and ignores a second order for it', async () => {
    const { send, finish } = held();
    await mount({ order: send });
    let first!: Promise<void>;
    await act(async () => { first = card.order(TOPIC_CARD, TRADE); });
    expect(card.writing(TOPIC)).toBe(true);
    await act(async () => { await card.order(TOPIC_CARD, TRADE); });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ kind: 'changed' }); await first; });
    expect(card.writing(TOPIC)).toBe(false);
  });

  it.each<[string, BoardCard, string]>([
    ['live', LIVE, '$4'],
    ['Dormant', DORMANT, 'board-session:s1'],
  ])('marks a %s Board Session under its own key while its write runs', async (_kind, boardSession, key) => {
    const { send, finish } = held();
    await mount({ order: send });
    let running!: Promise<void>;
    await act(async () => { running = card.order(boardSession, { kind: 'action', action: 'bench' }); });
    expect(send).toHaveBeenCalledWith(expect.anything(), boardSession, { kind: 'action', action: 'bench' }, expect.any(Function));
    expect(card.writing(key)).toBe(true);
    expect(card.writing(TOPIC)).toBe(false);
    await act(async () => { finish({ kind: 'failed', error: 'The Board Session ended.' }); await running; });
    expect(Alert.alert).toHaveBeenCalledWith('Could not Bench', 'The Board Session ended.');
  });

  it('says a wake the Host did not answer may have happened, reads nothing, and takes the next order', async () => {
    const send = host(new ExecDeadlineError(), { kind: 'changed' });
    await mount({ order: send });
    await act(async () => { await card.order(TOPIC_CARD, REOPEN); });
    expect(Alert.alert).toHaveBeenCalledWith('Reopen may have happened', expect.stringContaining('The Host did not answer in time.'));
    expect(order).toEqual(['write']);
    await act(async () => { await card.order(TOPIC_CARD, REOPEN); });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('says a move may have happened when the Host has the Request in doubt, and reads nothing', async () => {
    await mount({ order: host({ kind: 'unknown', message: 'The Request changed the records and did not finish.' }) });
    await act(async () => { await card.order(TOPIC_CARD, MOVE_UP); });
    expect(Alert.alert).toHaveBeenCalledWith('Move Up may have happened', expect.stringContaining('The Request changed the records and did not finish.'));
    expect(order).toEqual(['write']);
  });

  it('says an order may have happened when the second send of its Request got no answer either', async () => {
    await mount({ order: host(new WriteOutcomeUnknown(true, new ExecDeadlineError())) });
    await act(async () => { await card.order(TOPIC_CARD, MOVE_UP); });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Move Up may have happened',
      expect.stringContaining('The Host did not answer in time. It did not answer a second send of the same Request either.'),
    );
  });

  it.each<[CardOrder, string]>([
    [{ kind: 'action', action: 'pin' }, 'Pin'],
    [{ kind: 'action', action: 'unpin' }, 'Unpin'],
  ])('sends %j as a card write, with its spinner, and names it in the alert of a refusal', async (pick, label) => {
    const { send, finish } = held();
    await mount({ order: send });
    let running!: Promise<void>;
    await act(async () => { running = card.order(TOPIC_CARD, pick); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), TOPIC_CARD, pick, expect.any(Function));
    expect(card.writing(TOPIC)).toBe(true);
    await act(async () => { finish({ kind: 'failed', error: 'The Topic is gone.' }); await running; });
    expect(card.writing(TOPIC)).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(`Could not ${label}`, 'The Topic is gone.');
  });

  it.each<[ClosingAction, string]>([
    ['forget', 'Forget'],
    ['forget-stopping-sessions', 'Forget and Stop Sessions'],
  ])('closes the Topic with %s, with the card spinner, and names it in the alert of a refusal', async (action, label) => {
    const { send, finish } = held();
    await mount({ close: send });
    let running!: Promise<void>;
    await act(async () => { running = card.close(TOPIC, action); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), TOPIC, action, expect.any(Function));
    expect(card.writing(TOPIC)).toBe(true);
    await act(async () => { finish({ kind: 'failed', error: 'The Topic is gone.' }); await running; });
    expect(card.writing(TOPIC)).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(`Could not ${label}`, 'The Topic is gone.');
  });

  it('says a Forget the Host has in doubt may have happened', async () => {
    await mount({ close: host({ kind: 'unknown', message: 'The Request changed the records and did not finish.' }) });
    await act(async () => { await card.close(TOPIC, 'forget'); });
    expect(Alert.alert).toHaveBeenCalledWith('Forget may have happened', expect.stringContaining('The Request changed the records and did not finish.'));
  });

  it('fails without a question when the Connection breaks before the order leaves the phone', async () => {
    const send: Send = jest.fn(async () => { throw new Error('Connection refused'); }) as unknown as Send;
    await mount({ order: send });
    await act(async () => { await card.order(TOPIC_CARD, MOVE_UP); });
    expect(Alert.alert).toHaveBeenCalledWith('Could not Move Up', 'Connection refused');
  });
});
