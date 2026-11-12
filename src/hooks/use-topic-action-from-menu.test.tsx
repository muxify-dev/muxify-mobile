import React from 'react';
import { Alert } from 'react-native';
import { act, create } from 'react-test-renderer';

import type { TopicId } from '@/topics/environment';
import type { TopicAction } from '@/topics/topic-action';
import type { TopicWrite } from '@/topics/topic-edit';

import { useTopicActionFromMenu } from './use-topic-action-from-menu';

jest.mock('@/topics/act-on-topic', () => ({ actOnTopic: jest.fn() }));

const TOPIC = 'topic' as TopicId;

async function pick(action: TopicAction, answer: TopicWrite) {
  const order: string[] = [];
  const act = jest.fn(async () => {
    order.push('write');
    return answer;
  });
  const readAgain = jest.fn(async () => {
    order.push('read');
  });
  let pickIt: ReturnType<typeof useTopicActionFromMenu>;
  function Screen() {
    pickIt = useTopicActionFromMenu('host', readAgain, act);
    return null;
  }
  await act_(() => {
    create(<Screen />);
  });
  await act_(async () => {
    await pickIt(TOPIC, action);
  });
  return { order, act, readAgain };
}

const act_ = act as (callback: () => void | Promise<void>) => Promise<void>;

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('a menu order on a Topic card', () => {
  it('writes to the Host and then reads the Listing again', async () => {
    const { order, act: write } = await pick('move-up', { kind: 'changed' });

    expect(write).toHaveBeenCalledWith('host', TOPIC, 'move-up');
    expect(order).toEqual(['write', 'read']);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows the Host's reason on a refusal, and still reads the Listing again", async () => {
    const { order } = await pick('move-up', { kind: 'failed', error: 'The card is at the top.' });

    expect(Alert.alert).toHaveBeenCalledWith('Could not Move Up', 'The card is at the top.');
    expect(order).toEqual(['write', 'read']);
  });
});
