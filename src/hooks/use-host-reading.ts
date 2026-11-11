import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { answered, asking, refused, UNASKED, type Listing } from '@/domain/host-listing';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import type { HostCliState } from '@/topics/host-cli-install';
import {
  listedSessions,
  loadingTopics,
  settled,
  TOPICS_UNASKED,
  withHostCli,
  type HostTopics,
} from '@/topics/host-topics';

/** The screens' own voice in the Log: what the Host answered when asked. */
const say = speakingAs(deviceLog(), 'host');

/**
 * What one Host has said about its Sessions and Topics, and the way to ask it
 * again. The Host Screen and each section of Home read a Host through this, on
 * the app's one Connection to it (ADR 0012).
 *
 * Asking again does not take down the last answer: see host-listing.
 *
 * `hostCli` is where the Host CLI install on the Host's Connection stands.
 * The Topics say so while it runs on a Host with no Host CLI or an old one,
 * and why when it fails. When it answers `installed` or `updated`, the Topics
 * are read again.
 *
 * With Topics on, the one exec of each read is `environment show`, whose
 * snapshot has the Sessions too. When it gives no snapshot — no Host CLI,
 * an old one, a failed read — the Sessions still need their own
 * answer, so tmux is asked after all.
 */
export function useHostReading(hostId: string, topicsOn: boolean) {
  const [listing, setListing] = useState<Listing>(UNASKED);
  const [topics, setTopics] = useState<HostTopics>(TOPICS_UNASKED);

  const read = useCallback(async () => {
    setListing(asking);
    if (topicsOn) setTopics(loadingTopics);
    const records = await deviceHostStore().load();
    const found = records.hosts.find((candidate) => candidate.id === hostId);
    if (!found) {
      setListing(refused('This Host is no longer saved.'));
      return;
    }

    say(`asking ${found.displayName} for its ${topicsOn ? 'Topics' : 'Sessions'}`);
    let topicsRead = false;
    try {
      await appConnections().read(found, async (transport, muxify) => {
        const result = topicsOn ? await muxify.read((command) => transport.exec(command)) : null;
        if (result) {
          topicsRead = true;
          setTopics((previous) => settled(previous, result));
        }
        if (result?.kind === 'listed') {
          const sessions = listedSessions(result.snapshot);
          say(`${found.displayName} listed ${sessions.length} Sessions with its Topics`);
          setListing(answered(sessions));
        } else {
          const client = new TmuxClient(execCommandRunner(transport, found.tmuxExecutablePath));
          // A Host with no tmux server is a Host with no Sessions, which the
          // client already forgives — it must not read as a failure here.
          const sessions = await client.listSessions();
          say(`${found.displayName} listed ${sessions.length} Sessions`);
          setListing(answered(sessions));
        }
      });
    } catch (error) {
      const message = describeConnectionFailure(error);
      say(`${found.displayName} refused the listing: ${message}`);
      setListing(refused(message));
      if (topicsOn && !topicsRead) {
        setTopics((previous) => settled(previous, { kind: 'failed', error: message }));
      }
    }
  }, [hostId, topicsOn]);

  // The Host CLI install runs once per Connection, beside the reads. When it
  // puts a new Host CLI on the Host, the Topics module has forgotten where
  // `muxify` was, and reading again finds the new one.
  const hostCli: HostCliState = useSyncExternalStore(
    (changed) => appConnections().subscribeHostCli(changed),
    () => appConnections().hostCli(hostId),
  );
  useEffect(
    () =>
      appConnections().subscribeHostCli((changed, state) => {
        if (changed !== hostId || !topicsOn || state.kind !== 'done') return;
        if (state.result.kind === 'installed' || state.result.kind === 'updated') void read();
      }),
    [hostId, topicsOn, read],
  );

  return { listing, topics: withHostCli(topics, hostCli), hostCli, read };
}
