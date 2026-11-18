import { useCallback, useEffect, useRef, useState } from 'react';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { answered, asking, HOST_PROBLEM, refused, UNASKED, type Listing } from '@/domain/host-listing';
import { useLiveReading } from '@/hooks/use-host-listing';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { HostProblem } from '@/ssh/failures';
import { deviceHostStore } from '@/storage/device-store';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';

/** The screens' own voice in the Log: what the Host answered when asked. */
const say = speakingAs(deviceLog(), 'host');

/**
 * What one Host has said about its Sessions and Topics, and the way to ask it
 * again, for the Title Sheet. It reads on the app's one Connection to the Host
 * (ADR 0012).
 *
 * The Topics are what the Host Server of the Host's Connection pushes, as the
 * Host Screen draws them. `listing` is the Sessions as tmux lists them, which
 * the sheet shows once the Attach has stopped. `read` lists them again, and
 * opens a Connection, with its Host Server, when none is open.
 *
 * A Host that cannot be used is the Host Problem's to show, as `problem`.
 * After a read meets it, the Sessions are read again once any use reaches the
 * Host and clears it.
 */
export function useHostReading(hostId: string) {
  const [sessions, setSessions] = useState<Listing>(UNASKED);
  const [failure, setFailure] = useState<string | null>(null);
  const [hostName, setHostName] = useState('this Host');
  const { topics, problem } = useLiveReading(hostId, { sessions, failure, host: hostName });
  /** Whether the last read met the Host Problem, so that its clearing reads again. */
  const metProblem = useRef(false);

  const read = useCallback(async () => {
    metProblem.current = false;
    setSessions(asking);
    const records = await deviceHostStore().load();
    const found = records.hosts.find((candidate) => candidate.id === hostId);
    if (!found) {
      setSessions(refused('This Host is no longer saved.'));
      setFailure('This Host is no longer saved.');
      return;
    }
    setHostName(found.displayName);

    say(`asking ${found.displayName} for its Sessions`);
    try {
      // A Host with no tmux server is a Host with no Sessions, which the
      // client already forgives: it must not read as a failure here.
      const listed = await appConnections().read(found, (transport) =>
        new TmuxClient(execCommandRunner(transport, found.tmuxExecutablePath)).listSessions());
      say(`${found.displayName} listed ${listed.length} Sessions`);
      setSessions(answered(listed));
      setFailure(null);
    } catch (error) {
      const message = describeConnectionFailure(error);
      say(`${found.displayName} refused the listing: ${message}`);
      if (error instanceof HostProblem) {
        metProblem.current = true;
        setSessions(HOST_PROBLEM);
        setFailure(null);
        return;
      }
      setSessions(refused(message));
      setFailure(message);
    }
  }, [hostId]);

  useEffect(() => {
    const connections = appConnections();
    return connections.subscribeProblem((which) => {
      if (which === hostId && metProblem.current && connections.problem(hostId) === null) void read();
    });
  }, [hostId, read]);

  return { listing: sessions, topics, read, problem };
}
