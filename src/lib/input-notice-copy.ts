import type { DiscardReason, HoldReason, InputNotice } from '@/tmux/input-lane';

/** The longest preview the card shows. A long paste is not for reading in a card. */
const PREVIEW_LENGTH = 120;

const HELD: Record<HoldReason, string> = {
  'risky-keys': 'it has Enter or a control key',
  stale: 'it was typed more than 30 seconds ago',
  'program-changed': 'the Pane runs another program now',
  'unsure-delivered': 'a part of it can be in the Pane already',
  unwitnessed: 'the Pane was not read before the break',
  refused: 'tmux refused it',
};

const DISCARDED: Record<DiscardReason, string> = {
  'pane-gone': 'the Pane is gone',
  'server-restarted': 'tmux started again on the Host',
  'pane-replaced': 'the Pane was started again',
};

export interface InputNoticeCopy {
  /** The keys, as typed. */
  preview: string;
  /** One line that says what became of them, and why. */
  reason: string;
  /** The Move to Composer button, which names the keys that a Draft cannot hold. Held notices only. */
  compose: string;
}

/** The notice the screen shows: the active Pane's first, else the oldest. A waiting one is not drawn. */
export function shownInputNotice(
  notices: readonly InputNotice[],
  activePaneId: string,
): Exclude<InputNotice, { kind: 'waiting' }> | null {
  const drawn = notices.flatMap((notice) => (notice.kind === 'waiting' ? [] : [notice]));
  return drawn.find((notice) => notice.paneId === activePaneId) ?? drawn[0] ?? null;
}

export function inputNoticeCopy(
  notice: Exclude<InputNotice, { kind: 'waiting' }>,
  activePaneId: string,
): InputNoticeCopy {
  const characters = [...notice.preview];
  const preview =
    characters.length > PREVIEW_LENGTH ? `${characters.slice(0, PREVIEW_LENGTH).join('')}…` : notice.preview;
  const where = notice.paneId === activePaneId ? '' : 'Typed in another Pane. ';
  if (notice.kind === 'discarded') {
    return { preview, reason: `${where}Discarded: ${DISCARDED[notice.reason]}.`, compose: '' };
  }
  const { dropped } = notice.draft;
  return {
    preview,
    reason: `${where}Not sent: ${notice.reasons.map((reason) => HELD[reason]).join(', ')}.`,
    compose: dropped.length === 0 ? 'Move to Composer' : `Move to Composer, without ${dropped.join(' ')}`,
  };
}
