import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ExecDeadlineError } from '@/ssh/host-connections';
import type { sendTopicOrder, TopicOrder } from '@/topics/act-on-topic';
import type { TopicId } from '@/topics/environment';
import type { TopicWrite } from '@/topics/topic-edit';

import { useTopicCardWrites } from './use-topic-card-writes';

jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({}) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));

const TOPIC = 'topic' as TopicId;
const MOVE_UP: TopicOrder = { kind: 'action', action: 'move-up' };
const TRADE: TopicOrder = { kind: 'drop', drop: { kind: 'trade', with: { kind: 'topic', id: 'other' as TopicId } } };
const REOPEN: TopicOrder = { kind: 'wake', wake: 'reopen' };

let renderer: ReactTestRenderer;
let card: ReturnType<typeof useTopicCardWrites>;
const order: string[] = [];
const readAgain = jest.fn(async () => { order.push('read'); });

async function mount(send: typeof sendTopicOrder) {
  function Screen() {
    card = useTopicCardWrites('host', readAgain, send);
    return null;
  }
  await act(async () => { renderer = create(<Screen />); });
}

/** A Host that answers each order in turn, after `sending`. */
function host(...answers: (TopicWrite | Error)[]): jest.MockedFunction<typeof sendTopicOrder> {
  return jest.fn(async (_host, _topic, _order, sending) => {
    order.push('write');
    sending();
    const answer = answers.shift()!;
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

beforeEach(() => {
  order.length = 0;
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

describe('a write from a Topic card', () => {
  it('writes to the Host and then reads the Listing again', async () => {
    const send = host({ kind: 'changed' });
    await mount(send);
    await act(async () => { await card.order(TOPIC, MOVE_UP); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), TOPIC, MOVE_UP, expect.any(Function));
    expect(order).toEqual(['write', 'read']);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows the Host's reason on a refusal, and still reads the Listing again", async () => {
    await mount(host({ kind: 'failed', error: 'The card is at the top.' }));
    await act(async () => { await card.order(TOPIC, MOVE_UP); });
    expect(Alert.alert).toHaveBeenCalledWith('Could not Move Up', 'The card is at the top.');
    expect(order).toEqual(['write', 'read']);
  });

  it('marks the card while it runs, and ignores a second order for it', async () => {
    let finish!: (write: TopicWrite) => void;
    const send = jest.fn((_host, _topic, _order, sending: () => void) => {
      sending();
      return new Promise<TopicWrite>((resolve) => { finish = resolve; });
    });
    await mount(send);
    let first!: Promise<void>;
    await act(async () => { first = card.order(TOPIC, TRADE); });
    expect(card.writing(TOPIC)).toBe(true);
    await act(async () => { await card.order(TOPIC, TRADE); });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ kind: 'changed' }); await first; });
    expect(card.writing(TOPIC)).toBe(false);
  });

  it('says a wake the Host did not answer may have happened, reads again, and takes the next order', async () => {
    const send = host(new ExecDeadlineError(), { kind: 'changed' });
    await mount(send);
    await act(async () => { await card.order(TOPIC, REOPEN); });
    expect(Alert.alert).toHaveBeenCalledWith('Reopen may have happened', expect.stringContaining('The Host did not answer in time.'));
    expect(order).toEqual(['write', 'read']);
    await act(async () => { await card.order(TOPIC, REOPEN); });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fails without a question when the Connection breaks before the order leaves the phone', async () => {
    const send = jest.fn(async () => { throw new Error('Connection refused'); });
    await mount(send);
    await act(async () => { await card.order(TOPIC, MOVE_UP); });
    expect(Alert.alert).toHaveBeenCalledWith('Could not Move Up', 'Connection refused');
  });
});
