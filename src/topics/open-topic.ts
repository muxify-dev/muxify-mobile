import type { Place, RecentSession } from '@/storage/records';
import type { TopicDetail, TopicSession } from './topic-detail';

/**
 * The Session a Topic opens in: its Topic Place's, when the Topic still lists
 * it live, else the one this phone opened most recently.
 */
export function chooseTopicSession(
  topic: TopicDetail,
  hostId: string,
  recent: readonly RecentSession[],
  place: Place | null = null,
): TopicSession | null {
  const placed = place && topic.sessions.find((session) => session.name === place.session);
  if (placed) return placed;
  let chosen = topic.sessions[0] ?? null;
  let latest = '';
  for (const session of topic.sessions) {
    const visit = recent.find((entry) => entry.hostId === hostId && entry.name === session.name);
    if (visit && visit.lastOpenedAt > latest) {
      chosen = session;
      latest = visit.lastOpenedAt;
    }
  }
  return chosen;
}
