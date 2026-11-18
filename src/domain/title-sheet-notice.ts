import type { DisconnectReason } from '@/tmux/disconnect-reason';
import type { TopicView } from '@/topics/topic-detail';

import { hostProblemWords } from './cover';

/**
 * The Title Sheet's one notice, and what its one button tries again: every
 * read of the Host, the Topic read, or nothing.
 */
export interface TitleSheetNotice {
  text: string;
  retry: 'host' | 'topic' | null;
}

/**
 * The one thing the Title Sheet says went wrong, or null.
 *
 * An act the user started in the sheet comes first, because it answers the
 * last tap. Then the Host Problem, which also stands for every read that met
 * it. Last a Topic read that the Host refused.
 */
export function titleSheetNotice({
  actionError,
  problem,
  hostName,
  topic,
}: {
  actionError: string | undefined;
  problem: DisconnectReason | null;
  hostName: string;
  topic: TopicView | undefined;
}): TitleSheetNotice | null {
  if (actionError !== undefined) return { text: actionError, retry: null };
  if (problem !== null) {
    const { title, detail } = hostProblemWords(problem, hostName);
    return { text: detail === null ? title : `${title}. ${detail}`, retry: 'host' };
  }
  if (topic?.kind === 'failed') return { text: topic.error, retry: 'topic' };
  return null;
}
