import type { RecentSession } from '@/storage/records';
import type { TopicDetail, TopicSession } from './topic-detail';

export function chooseTopicSession(
  topic: TopicDetail,
  hostId: string,
  recent: readonly RecentSession[],
): TopicSession | null {
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
