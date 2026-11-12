import React from 'react';
import { Alert } from 'react-native';
import { act, create } from 'react-test-renderer';

import type { TopicId } from '@/topics/environment';
import type { Drop } from '@/topics/topic-drop';
import type { TopicWrite } from '@/topics/topic-edit';

import { useTopicDrop } from './use-topic-drop';

jest.mock('@/topics/act-on-topic', () => ({ dropTopic: jest.fn() }));

const TOPIC = 'topic' as TopicId;
const TRADE: Drop = { kind: 'trade', with: { kind: 'topic', id: 'other' as TopicId } };

async function dropIt(drop: Drop, answer: TopicWrite) {
  const order: string[] = [];
  const send = jest.fn(async () => {
    order.push('write');
    return answer;
  });
  const readAgain = jest.fn(async () => {
    order.push('read');
  });
  let dropCard: ReturnType<typeof useTopicDrop>;
  function Screen() {
    dropCard = useTopicDrop('host', readAgain, send);
    return null;
  }
  await act_(() => {
    create(<Screen />);
  });
  await act_(async () => {
    await dropCard(TOPIC, drop);
  });
  return { order, send };
}

const act_ = act as (callback: () => void | Promise<void>) => Promise<void>;

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('the drop of a dragged Topic card', () => {
  it('writes to the Host once and then reads the Listing again', async () => {
    const { order, send } = await dropIt(TRADE, { kind: 'changed' });

    expect(send).toHaveBeenCalledWith('host', TOPIC, TRADE);
    expect(order).toEqual(['write', 'read']);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows the Host's reason on a refusal, and still reads the Listing again", async () => {
    const { order } = await dropIt(TRADE, { kind: 'failed', error: 'This card is Pinned.' });

    expect(Alert.alert).toHaveBeenCalledWith('Could not Trade the Topics', 'This card is Pinned.');
    expect(order).toEqual(['write', 'read']);
  });
});
