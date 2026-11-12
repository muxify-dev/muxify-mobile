import { describeError } from '@/lib/describe-error';
import { systemClock, type Clock, type Timer } from '@/lib/clock';
import { bytesToUtf8 } from '@/lib/utf8';
import { shellQuote } from '@/tmux/commands';

/** Where muxify-shell publishes the Host CLI: the rolling `cli-latest` prerelease. */
export const HOST_CLI_BASE = 'https://github.com/muxify-dev/muxify/releases/download/cli-latest/';

/** How long the install may take, a download of tens of MB included. */
export const INSTALL_TIMEOUT_MS = 180_000;

/** One non-PTY channel on the Host's Connection that runs one command, as an upload does. */
export interface CommandChannel {
  close(): Promise<void>;
}

/** Opens a non-PTY channel for a command: `connection.openShell({ term: '', command }, events)`. */
export type OpenCommandChannel = (
  command: string,
  events: { onData(data: ArrayBuffer): void; onClosed(code?: number): void },
) => Promise<CommandChannel>;

/** What the install script answered, in its one result line. */
export type HostCliOutcome = 'installed' | 'updated' | 'current' | 'kept' | 'skipped' | 'failed';

export interface HostCliInstall {
  kind: HostCliOutcome;
  /** The line without its keyword: the version, `<old> -> <new>`, or the reason. */
  text: string;
  /** The whole line, as the Log shows it. */
  line: string;
}

/** Where a Host's install stands, for the Host Screen to draw. */
export type HostCliState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: HostCliInstall };

/**
 * The base URL the bootstrap fetches from. A dev build takes
 * `EXPO_PUBLIC_MUXIFY_CLI_BASE_URL` when it is set, so a test can serve a local
 * build of the Host CLI; a release build ignores it.
 */
export function hostCliBase(
  dev: boolean = __DEV__,
  override: string | undefined = process.env.EXPO_PUBLIC_MUXIFY_CLI_BASE_URL,
): string {
  if (!dev || !override) return HOST_CLI_BASE;
  return override.endsWith('/') ? override : `${override}/`;
}

/**
 * The one command the phone sends. It fetches `<base>install.sh` with curl,
 * else wget, and pipes it to `sh -s -- <base>`. It runs in `/bin/sh`, whatever
 * the user's login shell is, and stderr joins stdout so a failed download can
 * say why.
 */
export function bootstrapCommand(base: string): string {
  const script = `exec 2>&1
base=${shellQuote(base)}
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "\${base}install.sh" | sh -s -- "$base"
elif command -v wget >/dev/null 2>&1; then
  wget -qO- "\${base}install.sh" | sh -s -- "$base"
else
  echo 'failed: neither curl nor wget'
fi
`;
  return `/bin/sh -c ${shellQuote(script)}`;
}

/** The script's result line, parsed, or null for any other line. */
export function parseResultLine(raw: string): HostCliInstall | null {
  const line = raw.trim();
  const worded = /^(installed|updated|current|kept) (.+)$/.exec(line);
  if (worded) {
    const kind = worded[1] as HostCliOutcome;
    const text = worded[2] ?? '';
    if (kind === 'updated' && !text.includes(' -> ')) return null;
    if (kind === 'kept' && !text.includes('(newer than ')) return null;
    return { kind, text, line };
  }
  const reasoned = /^(skipped|failed): (.+)$/.exec(line);
  if (reasoned) return { kind: reasoned[1] as HostCliOutcome, text: reasoned[2] ?? '', line };
  return null;
}

function failed(reason: string): HostCliInstall {
  return { kind: 'failed', text: reason, line: `failed: ${reason}` };
}

/** Output kept while waiting for a newline: a line longer than this is not a result line. */
const MAX_BUFFERED = 32_768;

/**
 * Installs or updates the Host CLI on its own channel and answers the script's
 * result line. A timeout, a channel that closes before the answer, or output
 * with no result line answers `failed` with the reason. It never throws.
 */
export function installHostCli(
  open: OpenCommandChannel,
  options: { base?: string; clock?: Clock } = {},
): Promise<HostCliInstall> {
  const base = options.base ?? hostCliBase();
  const clock = options.clock ?? systemClock;

  return new Promise((resolve) => {
    let finished = false;
    let channel: CommandChannel | undefined;
    let buffered = '';
    let last = '';
    let timer: Timer | null = null;

    function finish(result: HostCliInstall, closeChannel: boolean) {
      if (finished) return;
      finished = true;
      clock.cancel(timer);
      if (closeChannel) void channel?.close().catch(() => {});
      resolve(result);
    }

    function receive(raw: string) {
      const result = parseResultLine(raw);
      if (result) {
        finish(result, true);
        return;
      }
      if (raw.trim()) last = raw.trim();
    }

    timer = clock.after(INSTALL_TIMEOUT_MS, () =>
      finish(failed(`no answer in ${INSTALL_TIMEOUT_MS / 60_000} minutes`), true),
    );

    const events = {
      onData(data: ArrayBuffer) {
        if (finished) return;
        buffered += bytesToUtf8(new Uint8Array(data));
        let end: number;
        while (!finished && (end = buffered.indexOf('\n')) >= 0) {
          receive(buffered.slice(0, end));
          buffered = buffered.slice(end + 1);
        }
        if (buffered.length > MAX_BUFFERED) buffered = '';
      },
      onClosed(code?: number) {
        if (finished) return;
        if (buffered) receive(buffered);
        buffered = '';
        if (finished) return;
        const exit = code === undefined ? '' : ` (exit ${code})`;
        finish(
          last
            ? failed(`the install printed no result line: ${last}`)
            : failed(`the channel closed before the install answered${exit}`),
          false,
        );
      },
    };

    let opening: Promise<CommandChannel>;
    try {
      opening = open(bootstrapCommand(base), events);
    } catch (error) {
      opening = Promise.reject(error);
    }
    opening.then(
      (opened) => {
        channel = opened;
        if (finished) void opened.close().catch(() => {});
      },
      (error: unknown) => finish(failed(`could not open a channel: ${describeError(error)}`), false),
    );
  });
}
