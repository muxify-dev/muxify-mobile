import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  LOOKUP_START,
  placeOfLastPlace,
  reconnect as reconnectToSession,
  type Lookup,
  type SessionVisit,
} from '@/domain/reconnect';
import { describeError } from '@/lib/describe-error';
import { useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';
import type { Host } from '@/storage/records';
import { useAttachHolder } from '@/tmux/attach-context';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import type { TopicId } from '@/topics/environment';

/** The Session a screen's route names: a cold start's Last Place, or an external link. */
export type RouteSession = {
  hostId?: string;
  session?: string;
  topicId?: string;
  /** Set by a cold start that reopens the Last Place: look first, then attach. */
  reconnect?: string;
};

/**
 * What the screen shows of the Place it opens at. The Terminal Screen shows
 * its Window and Pane only: a route to it means the terminal, and the cold
 * start opens a Place with a Tab on the Web View instead. The Web View shows
 * the Tab too.
 */
export type RouteShows = 'terminal' | 'page';

export interface RouteSessionState {
  /** Why the screen could not even ask for an Attach: a Host that has gone. */
  missing: string | null;
  /** The visit that finds the Session before a cold start attaches, or null when this is not one. */
  lookup: Lookup | null;
  /** The Host's name, for the Connection Screen before an Attach has one. */
  hostName: string;
  /** The Session the route asked for, for the Connection Screen before an Attach has one. */
  session: string;
  /** Runs the request once more. Nothing else retries it. */
  tryAgain: () => void;
  /** A cold start's visit is over once a Session is picked in place of one that stopped. */
  forgetLookup: () => void;
}

/**
 * Asks the root for the Session the route names, if it is not already up.
 *
 * A request rather than a start: the holder decides whether anything happens,
 * and a route to a Session that is already attached means nothing at all. A
 * cold start looks for the Session first, on one short visit, and asks for the
 * Attach only once the visit found it. The Attach goes back to the Place of the
 * Topic or Session. `route` null: the screen was not opened for a Session.
 */
export function useRouteSession(route: RouteSession | null, shows: RouteShows, say: (line: string) => void): RouteSessionState {
  const router = useRouter();
  const holder = useAttachHolder();
  const { settings } = useSettings();
  const routeHostId = route?.hostId;
  const sessionParam = route?.session;
  const bootstrap = useRef(route ?? {});
  /** Kept past the clearing of the route's params once the Attach is asked for. */
  const [session] = useState(route?.session ?? '');
  const bootstrapAttempt = useRef(-1);
  const [missing, setMissing] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(route?.reconnect ? LOOKUP_START : null);
  const [hostName, setHostName] = useState('');
  const [attempt, setAttempt] = useState(0);
  const tryAgain = useCallback(() => {
    setLookup(LOOKUP_START);
    setAttempt((before) => before + 1);
  }, []);
  const forgetLookup = useCallback(() => setLookup(null), []);

  useEffect(() => {
    if (route === null) return;
    say(`opened for ${holder.current()?.hostId ?? routeHostId ?? '?'}:${sessionParam ?? '?'}`);
    const requested = routeHostId && sessionParam
      ? { hostId: routeHostId, session: sessionParam, topicId: route.topicId, reconnect: route.reconnect }
      : attempt > 0 && attempt > bootstrapAttempt.current ? bootstrap.current : null;
    if (!requested?.hostId || !requested.session) {
      setMissing(holder.current() ? null : 'No Host was chosen.');
      return;
    }
    bootstrap.current = requested;
    bootstrapAttempt.current = attempt;
    const sessionName = requested.session;
    let left = false;
    void (async () => {
      const records = await deviceHostStore().load();
      const host = records.hosts.find((candidate) => candidate.id === requested.hostId);
      if (left) return;
      if (!host) {
        say('the Host in the route is no longer saved');
        setMissing('This Host is no longer saved.');
        return;
      }
      setMissing(null);
      const topicId = requested.topicId || null;
      const place = placeOfLastPlace(records, { hostId: host.id, session: sessionName, topicId });
      const request = {
        host,
        destination: {
          sessionName,
          topic: topicId ? { id: topicId as TopicId, seed: null } : null,
          restore: place && shows === 'terminal' ? { ...place, tab: null } : place,
        },
        zoomed: settings.zoomMultipaneWindows,
      };
      const opened = () => {
        if (!left) router.setParams({ hostId: '', session: '', topicId: '', reconnect: '' });
      };
      if (!requested.reconnect) {
        await holder.open(request);
        opened();
        return;
      }
      setHostName(host.displayName);
      let accepted = false;
      await reconnectToSession({
        session: sessionName,
        visit: sessionVisit(host, say),
        attach: async () => {
          if (left) return;
          await holder.open(request);
          accepted = true;
        },
        progress: (next) => {
          if (!left) setLookup(next);
        },
      });
      if (accepted) opened();
    })().catch((error) => { if (!left) setMissing(describeError(error)); });
    return () => {
      left = true;
      say('left');
    };
    // The Zoom preference is what the Session is *opened* with; changing it in
    // Settings must not reopen a Session that is already up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holder, routeHostId, sessionParam, attempt]);

  return { missing, lookup, hostName, session, tryAgain, forgetLookup };
}

/** The reconnect's visit to `host`, on the Host's Connection. */
function sessionVisit(host: Host, say: (line: string) => void): SessionVisit {
  return async ({ onHostKey, onSignedIn }) => {
    const sessions = await appConnections().read(
      host,
      (transport) => {
        onSignedIn();
        return new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).listSessions();
      },
      { onHostKey },
    );
    const names = sessions.map((candidate) => candidate.name);
    say(`reconnect: ${host.displayName} has ${names.join(', ') || 'no Sessions'}`);
    return names;
  };
}
