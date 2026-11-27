import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { HostServerError, type HostServer, type HostServerCall } from '@/ssh/host-server';
import { cancelOnAbort } from '@/ssh/host-server-channel';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import type { BoardSessionId, SessionId, TopicId } from './environment';
import { REQUEST_MISMATCH_ERROR, WriteOutcomeUnknown, type RequestId, type UnknownOutcome } from './request';

/** The version of MuxifyCore's `EnvironmentRequest` that the phone sends. */
const ENVIRONMENT_VERSION = 2;

/** One case of MuxifyCore's `EnvironmentCommand`, as JSON: `{ "<case>": { … } }`. */
export type EnvironmentCommand = Readonly<Record<string, unknown>>;

/**
 * What a write acts on, MuxifyCore's `EnvironmentTarget`: an open Topic, a
 * tmux Session or Window by tmux's own id (`$3`, `@5`), or a Board Session by
 * its id, which names a Dormant one.
 */
export type WriteTarget =
  | { topic: TopicId }
  | { session: SessionId }
  | { window: string }
  | { board_session: BoardSessionId };

/** One Host Write as the Host Server takes it: the command, what it acts on, and its Request id. */
export interface EnvironmentWrite {
  command: EnvironmentCommand;
  /** None for a command that takes no target, such as `create`. */
  target?: WriteTarget;
  request: RequestId;
}

/** What one Host Write came to: the Host's answer, its refusal, or a Request in doubt. */
export type EnvironmentAnswer = { kind: 'answered'; answer: unknown } | { kind: 'failed'; error: string } | UnknownOutcome;

/** The part of the Connections that a Host Write uses. */
export type ServerConnections = { onServer<T>(host: Host, work: (server: HostServer) => Promise<T>): Promise<T> };

const say = speakingAs(deviceLog(), 'topic');

/** The `environment` request of a write: a typed `EnvironmentRequest` with its Request id. */
export function environmentRequest(write: EnvironmentWrite): object {
  return {
    environment: {
      version: ENVIRONMENT_VERSION,
      command: write.command,
      ...(write.target === undefined ? {} : { target: wireTarget(write.target) }),
      request: write.request,
    },
  };
}

function wireTarget(target: WriteTarget): object {
  return 'topic' in target ? { topic: { id: target.topic } } : target;
}

/**
 * Sends one Host Write as an `environment` request on the Host's Host Server,
 * and turns its end into what the screens know. `sending` hears the moment it
 * leaves the phone.
 *
 * - A refusal (`failed`, with a `topic_failure`) is failed with the Host's
 *   message. A Request in doubt is unknown with the Host's words.
 * - A clash of the id with other arguments is a phone bug: it is logged and
 *   fails with a plain reason.
 * - When the channel ends before the `end`, the same request, with the same
 *   Request id, goes one more time to the next Host Server of the Host: the
 *   one that starts again on the Connection, or the one of a new Connection.
 *   The Host applies the Request one time and answers the second send with
 *   the end of the first. With no answer to that either, it throws
 *   `WriteOutcomeUnknown`. See ADR 0021.
 * - A failure before the request went out, such as a Connection that does not
 *   open or a Host in Sessions only, is thrown as it is: nothing reached the
 *   Host.
 */
export async function sendEnvironment(
  host: Host,
  write: EnvironmentWrite,
  sending: () => void = () => {},
  connections: ServerConnections = appConnections(),
): Promise<EnvironmentAnswer> {
  const payload = environmentRequest(write);
  try {
    return { kind: 'answered', answer: await sendWithResend(host, payload, sending, connections) };
  } catch (error) {
    if (!(error instanceof HostServerError)) throw error;
    return refusal(host, write, error);
  }
}

async function sendWithResend(host: Host, payload: object, sending: () => void, connections: ServerConnections): Promise<unknown> {
  const first = await connections.onServer(host, (server) => {
    sending();
    return answerOf(server.request(payload));
  });
  if ('value' in first) return first.value;
  say(`${host.displayName}: the Host Server ended before it answered a write; sending the same Request to the next one`);
  let second: Awaited<ReturnType<typeof answerOf>>;
  try {
    second = await connections.onServer(host, (server) => answerOf(server.request(payload)));
  } catch (error) {
    throw new WriteOutcomeUnknown(true, error);
  }
  if ('value' in second) return second.value;
  throw new WriteOutcomeUnknown(true, new Error('The Host Server ended before it answered.'));
}

/** The `ok` of a request, or `lost` when its channel ended before the `end`. Any other end is thrown. */
async function answerOf(call: HostServerCall<unknown>): Promise<{ value: unknown } | { lost: true }> {
  try {
    return { value: await call };
  } catch (error) {
    if (error instanceof HostServerError && error.code === 'unavailable') return { lost: true };
    throw error;
  }
}

/** What an `end` with an error means for a write. Each of them answers that the Host has the Request. */
function refusal(host: Host, write: EnvironmentWrite, error: HostServerError): EnvironmentAnswer {
  const kind = (error.topic_failure as { kind?: unknown } | undefined)?.kind;
  if (kind === 'request_in_doubt') return { kind: 'unknown', message: error.message };
  if (kind === 'request_clash') {
    say(`phone bug: ${host.displayName} refused Request ${write.request}, which came before with other arguments: ${error.message}`);
    return { kind: 'failed', error: REQUEST_MISMATCH_ERROR };
  }
  return { kind: 'failed', error: error.message };
}

/**
 * The first item of a subscription, which holds the whole state, and then the
 * subscription ends. It is how a check reads what the Host Server pushes.
 */
export function firstPush(server: HostServer, payload: object, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let heard = false;
    let call: HostServerCall<unknown> | undefined;
    call = server.subscribe(payload, (item) => {
      if (heard) return;
      heard = true;
      resolve(item);
      call?.cancel();
    });
    if (heard) call.cancel();
    else if (signal) cancelOnAbort(call, signal);
    call.then(
      () => reject(new Error('The Host Server ended the subscription before its first item.')),
      (error: unknown) => reject(error),
    );
  });
}
