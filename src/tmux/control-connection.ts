import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import { systemClock, type Clock } from '@/lib/clock';
import { bytesToUtf8 } from '@/lib/utf8';

import {
  argvOf,
  controlAttachCommand,
  describeCommand,
  isAnswerTo,
  renderControlCommand,
  type TmuxArgv,
  type TmuxCommand,
} from './commands';
import { createControlParser, type ControlEvent } from './control-protocol';
import { TmuxError } from './tmux-error';
import type { ControlChannel, TmuxTransport } from './transport';

/**
 * What a command answered: the reply lines, and whether tmux liked it.
 *
 * Bytes rather than text, because a `capture-pane` reply carries the Pane's
 * own escape sequences and turning those into a JS string would lose them.
 * `text` is there for the many commands whose reply really is text.
 */
export interface CommandReply {
  ok: boolean;
  lines: Uint8Array[];
  readonly text: string[];
}

/**
 * Runs tmux commands and gets replies. The seam everything tmux-shaped sits on.
 *
 * Two implementations: the Control Connection below, and the one-shot exec
 * runner the screens above the terminal use, which have no Session to attach
 * to. See `exec-runner.ts`.
 */
export interface CommandRunner {
  /**
   * Runs one command. Resolves whether or not tmux liked it — a failed command
   * is an answer, and a great many of them ("no server running", "can't find
   * session") are the normal way to learn something is not there.
   *
   * Rejects only when the channel itself is gone.
   */
  run(command: TmuxCommand): Promise<CommandReply>;

  /**
   * Runs several commands off one write, answered in order.
   *
   * One round trip rather than one each, which is the difference between a
   * picker that opens and a picker that loads.
   */
  runAll(commands: TmuxCommand[]): Promise<CommandReply[]>;

  /**
   * Runs several commands as one line, joined with ` ; `, and resolves with
   * every reply block the line produced, in order.
   *
   * For a line whose commands must run back to back or not at all. The count
   * of blocks is not the count of commands. Measured on tmux 3.8
   * (`e2e/probe-input-guard.mjs`): a command that `if-shell` starts answers
   * with a block of its own, an `%error` from one of those does not stop the
   * rest of the line, and an `%error` from a command of the line itself does.
   * So the end of the line's replies is marked, not counted: a second line
   * that prints a marker goes in the same write, and tmux always runs it.
   */
  runChain(commands: TmuxArgv[]): Promise<CommandReply[]>;
}

/**
 * Why a Control Connection ended, which is not the same as what it said.
 *
 * The text is tmux's or the library's own and belongs in front of the user;
 * this says which *kind* of ending it was, which is what decides whether
 * anything should be tried again. `exit` is tmux letting go — the Session was
 * killed, the server went — `channel` is the link underneath disappearing, and
 * `local` is this app closing it on purpose. Only the middle one is worth a
 * reconnect. See the Attach's reconnect policy.
 */
export type ClosedCause = 'exit' | 'channel' | 'local';

export interface ControlConnectionEvents {
  /** Bytes a Pane wrote. The hot path, and the reason this exists. */
  onOutput: (pane: string, bytes: Uint8Array) => void;
  /**
   * Everything else tmux pushed: layout changes, Windows coming and going,
   * the Session changing under the Client. Topology is kept from these rather
   * than polled — see ticket 05.
   */
  onNotification: (event: ControlEvent) => void;
  /** The Connection is finished, for whatever reason. Fires at most once. */
  onClosed: (reason: string, cause: ClosedCause) => void;
}

export interface ControlConnection extends CommandRunner {
  /** Runs one command and returns its lines, throwing TmuxError on `%error`. */
  command(argv: TmuxArgv): Promise<Uint8Array[]>;
  /**
   * Whether the channel underneath is still there, as the library reports it.
   *
   * Answered without sending anything. False is final. True can be stale: a
   * link that died without a close keeps its flags, so the Attach asks tmux
   * before it trusts one.
   */
  isOpen(): boolean;
  /**
   * Calls `fire` once the channel has brought nothing for `ms`, counted from
   * now. Every chunk that comes up the channel starts the count again, so a
   * slow link busy with Pane output never fires. Answers a function that
   * stops it.
   */
  whenQuiet(ms: number, fire: () => void): () => void;
  close(): Promise<void>;
}

/**
 * Hears when the channel has brought nothing for `afterMs` while a command
 * waits for its reply. The library's flags do not change when a link dies
 * without a close, so this silence is the sign the Attach acts on.
 */
export interface SilenceWatch {
  afterMs: number;
  silent: () => void;
}

/** A command that has been written and is waiting for its reply. */
interface Pending {
  line: string;
  /** The command as the Log names it, so its reply can be matched to it. */
  what: string;
  /** Takes the next reply block. Answers true when it was this command's last. */
  take: (reply: CommandReply) => boolean;
  fail: (error: Error) => void;
}

/**
 * Opens a Control Connection: one SSH channel running `tmux -C attach`.
 *
 * This is Attach. There is no second channel and no PTY anywhere: commands go
 * down the same channel as the Pane output they are about, and tmux sets no
 * Session option for a client that renders nothing. See ADR 0006.
 *
 * Commands are answered in the order they were written, which is what makes
 * correlation possible at all — tmux's `%begin` id groups a reply, but says
 * nothing about which command asked. So the connection keeps a queue and hands
 * each reply to the caller at its head. A block whose flags say tmux wrote it
 * for itself, such as a hook's, answers nothing in the queue and is dropped.
 * A read also checks the tag at the front of its lines; see TmuxRead.
 *
 * The attach itself answers first, unprompted, before anything has been sent.
 * That reply is the readiness signal: until it lands, no command is written,
 * and if it is an `%error` the Connection never opens at all.
 */
export async function openControlConnection(
  transport: TmuxTransport,
  options: { sessionName: string; tmuxExecutablePath?: string; log?: Log; clock?: Clock; watch?: SilenceWatch },
  events: ControlConnectionEvents,
): Promise<ControlConnection> {
  const say = speakingAs(options.log ?? silentLog, 'control');
  const clock = options.clock ?? systemClock;
  const parser = createControlParser();
  /** Written, waiting for a reply, oldest first. */
  const pending: Pending[] = [];
  /** Built, but not written: the attach has not answered yet. */
  const waiting: Pending[] = [];

  /** How many chains were written, which numbers each one's end marker. */
  let chains = 0;

  let ready = false;
  let closed: string | null = null;
  /** When the channel last brought anything: a reply, Pane output, a notification, or part of one. */
  let heardAt = clock.now();
  /** Stops the silence watch, while a command waits. */
  let unwatch: (() => void) | null = null;
  let channel: ControlChannel | null = null;
  /**
   * What came up the channel that was not protocol, before the attach answered.
   *
   * A shell channel with no pty keeps stderr separate and the SSH adapter
   * merges it into this stream, so a `tmux` that is not there, or a
   * `tmux -C attach` the shell could not run, says so here and nowhere else.
   * Kept only until the attach is answered: after that the Connection is up
   * and stray text is not what ended it.
   */
  const notices: string[] = [];

  let opened!: (connection: ControlConnection) => void;
  let refused!: (error: Error) => void;
  /** Resolves when tmux has answered the attach; rejects if it refused it. */
  const connected = new Promise<ControlConnection>((resolve, reject) => {
    opened = resolve;
    refused = reject;
  });

  /**
   * Writes everything that is allowed to go now.
   *
   * Two things hold a command back: the channel not existing yet, and the
   * attach not having answered. Both are moments, not states — but a command
   * written during either is a command that is never answered, so they are
   * checked here rather than remembered by each caller.
   */
  function flush(): void {
    const open = channel;
    if (!ready || open === null) return;
    for (let entry = waiting.shift(); entry !== undefined; entry = waiting.shift()) {
      pending.push(entry);
      say(`→ ${entry.what}`);
      open.write(new TextEncoder().encode(`${entry.line}\n`));
    }
    rewatch();
  }

  /** Watches for silence while a command waits, and stops when nothing does. */
  function rewatch(): void {
    const watch = options.watch;
    if (!watch) return;
    if (closed !== null || pending.length === 0) {
      unwatch?.();
      unwatch = null;
    } else if (unwatch === null) {
      unwatch = whenQuiet(watch.afterMs, () => {
        unwatch = null;
        watch.silent();
      });
    }
  }

  function whenQuiet(ms: number, fire: () => void): () => void {
    const from = clock.now();
    let timer = clock.after(ms, check);
    function check(): void {
      const quiet = clock.now() - Math.max(from, heardAt);
      if (quiet >= ms) fire();
      else timer = clock.after(ms - quiet, check);
    }
    return () => clock.cancel(timer);
  }

  /** Ends the Connection, telling everyone still waiting why. */
  function finish(reason: string, cause: ClosedCause): void {
    if (closed !== null) return;
    closed = reason;
    rewatch();
    const stranded = [...pending, ...waiting];
    pending.length = 0;
    waiting.length = 0;
    say(`closed (${cause}): ${reason}${stranded.length > 0 ? `; ${stranded.length} commands stranded` : ''}`);
    for (const entry of stranded) entry.fail(new TmuxError(reason));
    if (!ready) refused(new TmuxError(reason));
    events.onClosed(reason, cause);
  }

  function receive(event: ControlEvent): void {
    if (event.kind === 'notice') {
      say(`notice: ${event.text}`);
      // Bounded: a Host that floods the channel with text must not be able to
      // grow this without limit, and the first few lines are the message.
      if (!ready && notices.length < 8) notices.push(event.text);
      return;
    }

    if (event.kind === 'output') {
      events.onOutput(event.pane, event.bytes);
      return;
    }

    if (event.kind === 'reply') {
      const reply = replyOf(event.ok, event.lines);

      if (!ready) {
        // The attach's own reply. An `%error` here means there is nothing to
        // attach to, which is a Connection that never opened rather than a
        // command that failed — so `ready` stays false and `finish` refuses it.
        if (!reply.ok) {
          // tmux refusing the attach is tmux talking, not the link failing:
          // "no sessions", "can't find session work". Its own words are the
          // most useful thing a Connection that never opened has to say.
          finish(reply.text.join(' ').trim() || 'Could not attach', 'exit');
          return;
        }
        say('attach answered; commands may go');
        ready = true;
        opened(connection);
        flush();
        return;
      }

      // A hook that ran in this client's queue: a foreground `run-shell` on
      // `after-select-pane` writes one after every `select-pane`. It answers
      // no command, so it must not take the head of the queue.
      if (!event.mine) {
        say(`← tmux's own block (${reply.lines.length} lines), dropped`);
        return;
      }

      // A reply nobody asked for is tmux talking to itself; dropping it is the
      // only safe thing, because handing it to the next command would put
      // every later reply one out of step.
      const entry = pending[0];
      if (!entry) {
        say(`← a reply nobody asked for (${reply.lines.length} lines), dropped`);
        return;
      }
      if (entry.take(reply)) pending.shift();
      rewatch();
      return;
    }

    if (event.kind === 'exit') {
      finish(event.reason === '' ? 'The Session ended' : event.reason, 'exit');
      return;
    }

    events.onNotification(event);
  }

  const connection: ControlConnection = {
    run(command: TmuxCommand): Promise<CommandReply> {
      return runLines([command]).then((replies) => replies[0]);
    },

    runAll(commands: TmuxCommand[]): Promise<CommandReply[]> {
      if (commands.length === 0) return Promise.resolve([]);
      return runLines(commands);
    },

    runChain(commands: TmuxArgv[]): Promise<CommandReply[]> {
      const what = commands.map(describeCommand).join(' ; ');
      if (closed !== null) {
        say(`refused ${what}: the Connection is closed`);
        return Promise.reject(new TmuxError(closed));
      }
      chains += 1;
      const end = `muxify-chain-end-${chains}`;
      const line = commands.map(renderControlCommand).join(' ; ');
      const got: CommandReply[] = [];
      return new Promise<CommandReply[]>((resolve, reject) => {
        waiting.push({
          line: `${line}\n${renderControlCommand(['display-message', '-p', end])}`,
          what,
          take: (reply) => {
            if (!(reply.ok && reply.text.length === 1 && reply.text[0] === end)) {
              got.push(reply);
              return false;
            }
            const errors = got.filter((each) => !each.ok);
            say(
              `← ${what}: ${got.length} replies` +
                (errors.length > 0 ? `, error: ${errors.map((each) => each.text.join(' ').trim()).join('; ')}` : ''),
            );
            resolve(got);
            return true;
          },
          fail: reject,
        });
        flush();
      });
    },

    async command(argv: TmuxArgv): Promise<Uint8Array[]> {
      const reply = await connection.run(argv);
      if (!reply.ok) {
        const detail = reply.text.join(' ').trim() || 'the command failed';
        throw new TmuxError(`tmux refused ${argv[0]}: ${detail}`, detail);
      }
      return reply.lines;
    },

    isOpen: () => closed === null && (channel?.isOpen() ?? false),

    whenQuiet,

    async close(): Promise<void> {
      finish('The Connection was closed', 'local');
      await channel?.close();
    },
  };

  /**
   * Queues commands to be written together and resolves with their replies.
   *
   * Written in one go rather than one after another: tmux answers in the order
   * it read them, so a batch costs one round trip. Every line still gets its
   * own entry in the queue and its own reply, so a command that fails does not
   * take its neighbours with it.
   */
  function runLines(commands: TmuxCommand[]): Promise<CommandReply[]> {
    if (closed !== null) {
      say(`refused ${commands.map((command) => describeCommand(argvOf(command))).join(', ')}: the Connection is closed`);
      return Promise.reject(new TmuxError(closed));
    }

    const replies = commands.map(
      (command) =>
        new Promise<CommandReply>((resolve, reject) => {
          const argv = argvOf(command);
          const what = describeCommand(argv);
          waiting.push({
            line: renderControlCommand(argv),
            what,
            take: (reply) => {
              // A block out of step: it answers the command before this one,
              // or none. This read's own block is still to come.
              if (!isAnswerTo(command, reply)) {
                say(`← ${what}: a block without its tag (${reply.lines.length} lines), skipped`);
                return false;
              }
              say(
                reply.ok
                  ? `← ${what}: ok, ${reply.lines.length} lines`
                  : `← ${what}: error: ${reply.text.join(' ').trim()}`,
              );
              resolve(reply);
              return true;
            },
            fail: reject,
          });
        }),
    );
    flush();
    return Promise.all(replies);
  }

  const attaching = controlAttachCommand(options.sessionName, options.tmuxExecutablePath);
  say(`opening: ${attaching}`);
  channel = await transport.openControl(
    attaching,
    {
      onData: (data) => {
        heardAt = clock.now();
        for (const event of parser.push(new Uint8Array(data))) receive(event);
      },
      // A channel that closes before the attach was answered did not lose a
      // Connection — it never opened one, and whatever tmux wrote to stderr on
      // the way out is the reason.
      onClosed: () =>
        ready || notices.length === 0
          ? finish('The Connection to the Host was closed', 'channel')
          : finish(notices.join(' ').trim(), 'exit'),
    },
  );
  // The attach's own reply may already have arrived and set `ready`; nothing is
  // written until both that and the channel exist, which is what flush checks.
  flush();

  return connected;
}

function replyOf(ok: boolean, lines: Uint8Array[]): CommandReply {
  let text: string[] | undefined;
  return {
    ok,
    lines,
    // Decoded once, and only if somebody asks: a capture is read as bytes and
    // a big one has no business being turned into a string on the way past.
    get text(): string[] {
      if (text === undefined) text = lines.map(bytesToUtf8);
      return text;
    },
  };
}
