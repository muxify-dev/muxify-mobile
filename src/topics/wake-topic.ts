import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';
import type { TopicWrite } from './topic-edit';

const say = speakingAs(deviceLog(), 'topic');

/** The two ways to wake a Dormant Topic, in the Mac's words. */
export type Wake = 'reopen' | 'start-fresh';

/** Where waking a Topic stands on the Topic Screen. */
export type WakeState =
  | { kind: 'idle' }
  | { kind: 'working'; wake: Wake }
  | { kind: 'failed'; message: string };

export const WAKE_LABEL: Record<Wake, string> = {
  reopen: 'Reopen',
  'start-fresh': 'Start Fresh',
};

/**
 * `topic reopen` took 0.3 s on the dev Host for a Topic with four Agent
 * Windows, because it returns once the Sessions and Windows exist and does not
 * wait for the Agents. 30 s is 100 times that, for a slow Host.
 */
export const WAKE_TIMEOUT_MS = 30_000;

/**
 * Wakes one Topic on its Host, on the Host's Connection. It never throws: a
 * Host that is no longer saved, a Host that refuses and a Host that does not
 * answer in time are each a failed write that carries its reason.
 */
export async function wakeTopic(hostId: string, topicId: TopicId, wake: Wake): Promise<TopicWrite> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<TopicWrite>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          kind: 'failed',
          error: `${host.displayName} did not answer in ${WAKE_TIMEOUT_MS / 1000} seconds. It may still be working: go back and open the Topic again.`,
        }),
      WAKE_TIMEOUT_MS,
    );
  });
  try {
    const write = await Promise.race([
      appConnections().write(host, (transport, muxify) =>
        wake === 'reopen'
          ? muxify.reopenTopic((command) => transport.exec(command), topicId)
          : muxify.startTopicFresh((command) => transport.exec(command), topicId),
      ),
      silence,
    ]);
    say(
      write.kind === 'changed'
        ? `${host.displayName} woke a Topic: ${WAKE_LABEL[wake]}`
        : `${host.displayName} did not wake a Topic: ${write.error}`,
    );
    return write;
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} refused to wake a Topic: ${message}`);
    return { kind: 'failed', error: message };
  } finally {
    clearTimeout(timer);
  }
}
