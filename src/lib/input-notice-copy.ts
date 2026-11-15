import type { DiscardReason, HoldReason, InputNotice } from '@/tmux/input-lane';

/** The longest preview the card shows. A long paste is not for reading in a card. */
const PREVIEW_LENGTH = 120;

const HELD: Record<HoldReason, string> = {
  'risky-keys': 'it has Enter or a control key',
  stale: 'it was typed more than 30 seconds ago',
  'program-changed': 'the Pane runs another program now',
  'unsure-delivered': 'a part of it can be in the Pane already',
  unwitnessed: 'the Pane was not read before the break',
  unguarded: 'tmux on the Host is older than 3.2, and it can paste it two times',
  refused: 'tmux refused it',
};

const DISCARDED: Record<DiscardReason, string> = {
  'pane-gone': 'the Pane is gone',
  'server-restarted': 'tmux started again on the Host',
  'pane-replaced': 'the Pane was started again',
};

/** Why the Lane threw keys away, as the end of a sentence. */
export const whyDiscarded = (reason: DiscardReason) => DISCARDED[reason];

export interface InputNoticeCopy {
  /** The keys, as typed. */
  preview: string;
  /** One line that says what became of them, and why. */
  reason: string;
  /**
   * The Move to Composer button, which names the keys that a Draft cannot
   * hold. Empty when there is no button.
   */
  compose: string;
  /** What the notice is about, for VoiceOver. */
  label: string;
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
  const elsewhere = notice.paneId !== activePaneId;
  if (notice.message) {
    const where = elsewhere ? 'For another Pane. ' : '';
    const label = 'A message was not sent';
    if (notice.kind === 'discarded') {
      // The Draft of another Pane can be of a Pane that is gone, which the user cannot open.
      return elsewhere
        ? { preview, reason: `${where}Message not sent: ${DISCARDED[notice.reason]}.`, compose: 'Move to Composer', label }
        : { preview, reason: `Message not sent: ${DISCARDED[notice.reason]}. The Composer keeps it.`, compose: '', label };
    }
    const reason = `${where}Message not sent: ${heldReasons(notice)}.`;
    return { preview, reason, compose: composeLabel('Edit in Composer', notice), label };
  }
  const where = elsewhere ? 'Typed in another Pane. ' : '';
  if (notice.kind === 'discarded') {
    const reason = `${where}Discarded: ${DISCARDED[notice.reason]}.`;
    return { preview, reason, compose: '', label: 'Typed keys were discarded' };
  }
  return {
    preview,
    reason: `${where}Not sent: ${heldReasons(notice)}.`,
    compose: notice.draft.text === '' ? '' : composeLabel('Move to Composer', notice),
    label: 'Typed keys were not sent',
  };
}

const heldReasons = (notice: Extract<InputNotice, { kind: 'held' }>) =>
  notice.reasons.map((reason) => HELD[reason]).join(', ');

function composeLabel(action: string, notice: Extract<InputNotice, { kind: 'held' }>): string {
  const { dropped } = notice.draft;
  return dropped.length === 0 ? action : `${action}, without ${dropped.join(' ')}`;
}
