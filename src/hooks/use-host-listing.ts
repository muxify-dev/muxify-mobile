import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { answered, asking, HOST_PROBLEM, refused, UNASKED, type Listing } from '@/domain/host-listing';
import { HostProblem } from '@/ssh/failures';
import { deviceHostStore } from '@/storage/device-store';
import { execCommandRunner } from '@/tmux/exec-runner';
import type { LiveListing } from '@/ssh/host-listing-feed';
import { describeConnectionFailure, type DisconnectReason } from '@/tmux/disconnect-reason';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import type { EnvironmentSnapshot } from '@/topics/environment';
import { liveReading, withHostCli } from '@/topics/host-topics';

/** The screens' own voice in the Log: what the Host answered when asked. */
const say = speakingAs(deviceLog(), 'host');

/**
 * The Host Screen's account of one Host: the Listing that its Host Server
 * pushes, drawn as it arrives. Nothing is read on focus or after a write: the
 * push brings the change.
 *
 * While the screen is focused it holds the Host's Connection, as an Attach
 * does, so its Host Server stays and the Listing stays live. Leaving it starts
 * the idle minute. A Connection that closes while the screen is focused, such
 * as one a return from the background drops, is held again.
 *
 * In Sessions only, and while the Host CLI install puts a first `muxify` on
 * the Host, tmux lists the Sessions as it did before the Host Server, on
 * focus and when that state begins.
 *
 * A Host that cannot be used leaves its Host Problem in the Connections,
 * which `problem` is. The screen holds the Connection again when any use
 * reaches the Host and clears it.
 *
 * `retry` holds the Connection again after it could not be held, and lists the
 * Sessions again.
 */
export function useHostListing(hostId: string) {
  const [failure, setFailure] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Listing>(UNASKED);
  const [hostName, setHostName] = useState('this Host');
  const [attempt, setAttempt] = useState(0);
  const { live, listing, topics, problem } = useLiveReading(hostId, { sessions, failure, host: hostName });

  const focused = useIsFocused();
  const closed = live?.server.kind === 'closed';
  // `closed` and `attempt` are here to hold the Connection again.
  useEffect(() => {
    if (!focused) return;
    let release: (() => void) | null = null;
    let stopHearing: (() => void) | null = null;
    let left = false;
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
      if (left) return;
      if (!host) {
        setFailure('This Host is no longer saved.');
        return;
      }
      setHostName(host.displayName);
      try {
        const held = await appConnections().hold(host);
        if (left) held();
        else {
          release = held;
          setFailure(null);
        }
      } catch (error) {
        const message = describeConnectionFailure(error);
        say(`${host.displayName} could not be reached: ${message}`);
        if (left) return;
        if (!(error instanceof HostProblem)) {
          setFailure(message);
          return;
        }
        setFailure(null);
        const connections = appConnections();
        stopHearing = connections.subscribeProblem((which) => {
          if (which === hostId && connections.problem(hostId) === null) setAttempt((count) => count + 1);
        });
      }
    })();
    return () => {
      left = true;
      release?.();
      stopHearing?.();
    };
  }, [focused, hostId, closed, attempt]);

  const fallback = live?.server.kind === 'sessions-only' || live?.server.kind === 'installing';
  useEffect(() => {
    if (!focused || !fallback) return;
    let left = false;
    void (async () => {
      setSessions(asking);
      const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
      if (!host) {
        if (!left) setSessions(refused('This Host is no longer saved.'));
        return;
      }
      try {
        // A Host with no tmux server is a Host with no Sessions, which the
        // client already forgives: it must not read as a failure here.
        const listed = await appConnections().read(host, (transport) =>
          new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).listSessions());
        say(`${host.displayName} listed ${listed.length} Sessions`);
        if (!left) setSessions(answered(listed));
      } catch (error) {
        const message = describeConnectionFailure(error);
        say(`${host.displayName} refused the listing: ${message}`);
        if (!left) setSessions(error instanceof HostProblem ? HOST_PROBLEM : refused(message));
      }
    })();
    return () => {
      left = true;
    };
  }, [focused, hostId, fallback, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return {
    listing,
    topics,
    /** No Host Server runs: Topic Actions, Go to and New Topic are hidden. */
    sessionsOnly: live?.server.kind === 'sessions-only',
    problem,
    retry,
  };
}

/**
 * The Listing and Topics that the Host Server of the Host's Connection pushes,
 * as `liveReading` draws them with what the screen read itself: `sessions`
 * from tmux, for Sessions only and while the Host CLI install puts a first
 * `muxify` on the Host, and `failure`, a Connection that could not be had.
 * The latest push stays until the next Connection's first push. The Topics
 * say where the Host CLI install stands. A Host Problem stands in for both,
 * and `problem` says why.
 */
export function useLiveReading(hostId: string, read: { sessions: Listing; failure: string | null; host: string }) {
  const connections = appConnections();
  const live = useLiveListing(hostId);
  const hostCli = useSyncExternalStore(
    useCallback((changed: () => void) => connections.subscribeHostCli(changed), [connections]),
    () => connections.hostCli(hostId),
  );
  /** The latest push, which stays on screen until the next Connection's first push. */
  const [last, setLast] = useState<EnvironmentSnapshot | null>(null);
  const pushed = live?.snapshot ?? null;
  if (pushed !== null && pushed !== last) setLast(pushed);
  const problem = useHostProblem(hostId);
  const reading = liveReading({ live, last, ...read, problem: problem !== null });
  return { live, listing: reading.listing, topics: withHostCli(reading.topics, hostCli), problem };
}

/**
 * The Listing that the Host Server of the Host's Connection pushes, and where
 * that server stands, as it changes. It holds nothing: null while no
 * Connection has a Host Server.
 */
export function useLiveListing(hostId: string): LiveListing | null {
  const connections = appConnections();
  return useSyncExternalStore(
    useCallback((changed: () => void) => connections.subscribeListing((which) => {
      if (which === hostId) changed();
    }), [connections, hostId]),
    () => connections.listing(hostId),
  );
}

/** The Host Problem of one Host, as it changes: why the phone could not use it, or null. */
export function useHostProblem(hostId: string): DisconnectReason | null {
  const connections = appConnections();
  return useSyncExternalStore(
    useCallback((changed: () => void) => connections.subscribeProblem((which) => {
      if (which === hostId) changed();
    }), [connections, hostId]),
    () => connections.problem(hostId),
  );
}
