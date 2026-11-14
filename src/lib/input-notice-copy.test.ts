import type { InputNotice } from '@/tmux/input-lane';

import { inputNoticeCopy, shownInputNotice } from './input-notice-copy';

const held = (paneId: string, over: Partial<Extract<InputNotice, { kind: 'held' }>> = {}): Extract<InputNotice, { kind: 'held' }> => ({
  kind: 'held',
  paneId,
  preview: 'ls -la⏎',
  reasons: ['risky-keys'],
  draft: { text: 'ls -la\n', dropped: [] },
  ...over,
});

describe('which notice the screen shows', () => {
  const waiting: InputNotice = { kind: 'waiting', paneId: '%1', preview: 'a' };
  const discarded: InputNotice = { kind: 'discarded', paneId: '%2', preview: 'b', reason: 'pane-gone' };

  it('the active Pane’s, when it has one', () => {
    expect(shownInputNotice([discarded, held('%3')], '%3')).toEqual(held('%3'));
  });

  it('else the first, also for a Pane that is not on screen', () => {
    expect(shownInputNotice([waiting, discarded, held('%3')], '%1')).toEqual(discarded);
  });

  it('none for keys that only wait for the Connection', () => {
    expect(shownInputNotice([waiting], '%1')).toBeNull();
  });
});

describe('what a notice says', () => {
  it('names each reason that the keys were not sent', () => {
    expect(inputNoticeCopy(held('%1', { reasons: ['stale', 'program-changed'] }), '%1').reason).toBe(
      'Not sent: it was typed more than 30 seconds ago, the Pane runs another program now.',
    );
  });

  it('names the keys that Move to Composer drops, before the tap', () => {
    expect(inputNoticeCopy(held('%1'), '%1').compose).toBe('Move to Composer');
    expect(inputNoticeCopy(held('%1', { draft: { text: 'x', dropped: ['↑', '^C'] } }), '%1').compose).toBe(
      'Move to Composer, without ↑ ^C',
    );
  });

  it('says so when the keys are for another Pane', () => {
    expect(inputNoticeCopy(held('%2'), '%1').reason).toBe(
      'Typed in another Pane. Not sent: it has Enter or a control key.',
    );
  });

  it('says why keys were discarded', () => {
    const notice: InputNotice = { kind: 'discarded', paneId: '%1', preview: 'abc', reason: 'server-restarted' };
    expect(inputNoticeCopy(notice, '%1')).toMatchObject({
      preview: 'abc',
      reason: 'Discarded: tmux started again on the Host.',
    });
  });

  it('cuts a long preview at 120 characters', () => {
    const { preview } = inputNoticeCopy(held('%1', { preview: '漢'.repeat(300) }), '%1');
    expect(preview).toBe(`${'漢'.repeat(120)}…`);
  });
});
