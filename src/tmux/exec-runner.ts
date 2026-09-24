import type { CommandReply, CommandRunner } from './control-connection';
import { renderExecCommand, type TmuxArgv } from './commands';
import type { TmuxTransport } from './transport';

/**
 * Runs tmux commands one to a channel, for the screens that have no Session.
 *
 * The Host Screen lists what is running before anything has been attached to,
 * and the new-Session form makes one. Neither has a Control Connection to ask,
 * because a Control Connection *is* an Attach — so these two go out as
 * ordinary one-shot commands through a shell on the Host.
 *
 * That is not a hole in ADR 0006. What the ADR objects to is borrowing Session
 * options; `list-sessions` and `new-session -d` set none, leave nothing behind,
 * and are gone the moment they answer.
 */
export function execCommandRunner(
  transport: TmuxTransport,
  tmuxExecutablePath?: string,
): CommandRunner {
  async function run(argv: TmuxArgv): Promise<CommandReply> {
    const result = await transport.exec(renderExecCommand(argv, tmuxExecutablePath));
    const ok = result.exitCode === 0;
    // A failure says what went wrong on stderr — "no server running", "can't
    // find session" — and the caller reads that to tell "nothing there" from
    // "something broke". So the text of a failure is its error, not its
    // (usually empty) output.
    const source = ok ? result.stdout : result.stderr.trim() || result.stdout;
    const text = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return { ok, lines: text.map((line) => new TextEncoder().encode(line)), text };
  }

  return {
    run,
    async runAll(commands: TmuxArgv[]): Promise<CommandReply[]> {
      const replies: CommandReply[] = [];
      // One channel each, in order. There are only ever one or two, and the
      // batching that makes the Control Connection worth having has nothing to
      // coalesce here.
      for (const argv of commands) replies.push(await run(argv));
      return replies;
    },
  };
}
