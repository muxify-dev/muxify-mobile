import { parseBrowserTabs, type BrowserTabsRead } from '@/browser/tabs';
import { shellQuote } from '@/tmux/commands';
import type { TmuxTransport } from '@/tmux/transport';

import { folderArgument, parseAddedSession, type AddSessionRead } from './add-session';
import { parseEnvironment } from './environment';
import type { TopicId } from './environment';
import type { TopicsRead } from './host-topics';
import { parseNewTopic, type NewTopicRead } from './new-topic';
import { parseTopicDetail, type TopicRead } from './topic-detail';
import type { TopicChange, TopicWrite } from './topic-edit';

type Exec = TmuxTransport['exec'];

const APP_BUNDLE_CLI = '/Applications/Muxify.app/Contents/Resources/bin/muxify';

/**
 * Where desktop Muxify's `muxify` can be, in the order the probe asks. An SSH
 * exec runs `$SHELL -c` without a login shell, so its PATH can lack the
 * folder that holds `muxify`. The second and third steps are the places the
 * Mac app puts it.
 */
const PROBE_STEPS = [
  { step: 'PATH', command: 'command -v muxify' },
  {
    step: '~/.local/bin',
    command: 'test -x ~/.local/bin/muxify && echo ~/.local/bin/muxify',
  },
  {
    step: 'app bundle',
    command: `test -x ${shellQuote(APP_BUNDLE_CLI)} && echo ${shellQuote(APP_BUNDLE_CLI)}`,
  },
] as const;

const NO_MUXIFY = 'Desktop Muxify is not on this Host.';

/** `muxify` exits 2 on a usage error, which is how a CLI with no `environment show` answers. */
const USAGE_ERROR = 2;

/**
 * A usage error answers a change with the whole help text. It comes from a
 * value that starts with -, which `muxify` reads as an option even after --,
 * or from a `muxify` too old to have the command.
 */
const CHANGE_USAGE_ERROR =
  'muxify on this Host did not take this. It reads a value that starts with - as an option, and an old muxify does not have this command.';

export interface MuxifyCli {
  /**
   * One read of the Host's Topics: `environment show --json`, parsed.
   *
   * The first call finds `muxify` on the Host and every later call reuses
   * what the first found, so a refresh is one exec. A call that throws, because
   * the Connection broke, finds nothing out and leaves the next one to probe.
   */
  read(exec: Exec): Promise<TopicsRead>;

  /**
   * One read of one Topic: `topic show --json`, parsed. It names the Topic by
   * id, because a rename on the Mac changes its label. It finds `muxify` as
   * `read` does. With no `muxify`, or a Topic the Mac has closed, the read
   * fails with the reason.
   */
  show(exec: Exec, topic: TopicId): Promise<TopicRead>;

  /**
   * Makes an Empty Topic with this title and these Tags: `topic new --json`.
   * It finds `muxify` as `read` does. A Tag the Config does not define, or any
   * other refusal, fails with the Host's reason, and the Host makes nothing.
   */
  create(exec: Exec, title: string, tags: string[]): Promise<NewTopicRead>;

  /**
   * Changes one field of a Topic: `topic rename`, `topic note` (`--clear` for
   * no Note) or `topic tag set`. It names the Topic by id and finds `muxify`
   * as `read` does. A refusal fails with the Host's reason, and the Host
   * changes nothing.
   */
  change(exec: Exec, topic: TopicId, change: TopicChange): Promise<TopicWrite>;

  /**
   * Makes a Session at a folder on the Host in this Topic: `topic add-session`,
   * with no Worktree. It names the Topic by id and finds `muxify` as `read`
   * does. A folder that is not there, or any other refusal, fails with the
   * Host's reason, and the Host makes nothing.
   */
  addSession(exec: Exec, topic: TopicId, folder: string): Promise<AddSessionRead>;

  /**
   * The Tabs of one Window's Browser: `browser tabs --json`. It names the
   * Window by tmux's id, such as `@12`, because an SSH exec is in no Pane for
   * `muxify` to take the Window from. It finds `muxify` as `read` does. A
   * Window with no Browser lists no Tabs.
   */
  browserTabs(exec: Exec, window: string): Promise<BrowserTabsRead>;
}

/**
 * The only code that talks to desktop Muxify's CLI. The registry of
 * Connections makes one per Connection: it remembers where `muxify` is for as
 * long as it lives, so a read is one exec. See ADR 0012.
 *
 * `log` hears where the probe found it, which is what the Log needs to say why
 * a Host has Topics or not.
 */
export function createMuxifyCli(log: (line: string) => void = () => {}): MuxifyCli {
  let probed: Promise<string | null> | undefined;

  async function probe(exec: Exec): Promise<string | null> {
    for (const { step, command } of PROBE_STEPS) {
      const result = await exec(command);
      const path = result.stdout.trim().split('\n')[0] ?? '';
      // `command -v` also prints an alias or a function name, which is not
      // something to run with a path's quoting.
      if (result.exitCode === 0 && path.startsWith('/')) {
        log(`found muxify at ${path} by ${step}`);
        return path;
      }
    }
    log('muxify is not on this Host');
    return null;
  }

  async function locate(exec: Exec): Promise<string | null> {
    probed ??= probe(exec);
    return probed.catch((error: unknown) => {
      probed = undefined;
      throw error;
    });
  }

  /**
   * The parsed answer to `muxify <args>`, which must ask for `--json`. A Host
   * with no `muxify`, a non-zero exit or an answer of the wrong shape gives
   * the reason instead.
   */
  async function answerTo<T>(
    exec: Exec,
    args: string,
    parse: (json: unknown) => T,
  ): Promise<{ value: T } | { error: string }> {
    const path = await locate(exec);
    if (path === null) return { error: NO_MUXIFY };
    const result = await exec(`${shellQuote(path)} ${args}`);
    if (result.exitCode !== 0) return { error: failureText(result) };
    return parseAnswer(result.stdout, parse);
  }

  return {
    async read(exec) {
      const path = await locate(exec);
      if (path === null) return { kind: 'absent' };

      const result = await exec(`${shellQuote(path)} environment show --json`);
      if (result.exitCode === USAGE_ERROR) return { kind: 'old' };
      if (result.exitCode !== 0) return { kind: 'failed', error: failureText(result) };
      const parsed = parseAnswer(result.stdout, parseEnvironment);
      return 'error' in parsed ? { kind: 'failed', ...parsed } : { kind: 'listed', snapshot: parsed.value };
    },

    async show(exec, topic) {
      const parsed = await answerTo(exec, `topic show --json --topic ${shellQuote(topic)}`, parseTopicDetail);
      return 'error' in parsed ? { kind: 'failed', ...parsed } : { kind: 'shown', topic: parsed.value };
    },

    async create(exec, title, tags) {
      const tagFlags = tags.map((tag) => ` --tag ${shellQuote(tag)}`).join('');
      const parsed = await answerTo(exec, `topic new ${shellQuote(title)}${tagFlags} --json`, parseNewTopic);
      return 'error' in parsed ? { kind: 'failed', ...parsed } : { kind: 'created', topic: parsed.value };
    },

    async change(exec, topic, change) {
      const path = await locate(exec);
      if (path === null) return { kind: 'failed', error: NO_MUXIFY };

      const result = await exec(
        `${shellQuote(path)} ${changeCommand(change)} --topic ${shellQuote(topic)} --json`,
      );
      if (result.exitCode === USAGE_ERROR) return { kind: 'failed', error: CHANGE_USAGE_ERROR };
      return result.exitCode === 0
        ? { kind: 'changed' }
        : { kind: 'failed', error: failureText(result) };
    },

    async addSession(exec, topic, folder) {
      const parsed = await answerTo(
        exec,
        `topic add-session ${folderArgument(folder)} --topic ${shellQuote(topic)} --json`,
        parseAddedSession,
      );
      return 'error' in parsed ? { kind: 'failed', ...parsed } : { kind: 'added', session: parsed.value };
    },

    async browserTabs(exec, window) {
      const parsed = await answerTo(exec, `browser tabs --window ${shellQuote(window)} --json`, parseBrowserTabs);
      return 'error' in parsed ? { kind: 'failed', ...parsed } : { kind: 'listed', tabs: parsed.value };
    },
  };
}

/** The subcommand and arguments that make one change, before the `--topic` that names the Topic. */
function changeCommand(change: TopicChange): string {
  switch (change.field) {
    case 'title':
      return `topic rename ${shellQuote(change.title)}`;
    case 'note':
      return change.note === null ? 'topic note --clear' : `topic note ${shellQuote(change.note)}`;
    case 'tags':
      return ['topic tag set', ...change.tags.map(shellQuote)].join(' ');
  }
}

/** A successful answer, parsed, or why it could not be. */
function parseAnswer<T>(stdout: string, parse: (json: unknown) => T): { value: T } | { error: string } {
  try {
    return { value: parse(JSON.parse(stdout)) };
  } catch (error) {
    return {
      error: `Could not read the answer of muxify: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * What a failed `muxify … --json` says for itself. The CLI puts the reason in
 * `failed.message` on stdout and a human line on stderr, so the message wins,
 * then stderr, then whatever stdout holds.
 */
function failureText(result: { stdout: string; stderr: string; exitCode: number }): string {
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const message = (parsed as { failed?: { message?: unknown } } | null)?.failed?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // Not JSON: fall through to the plain text.
  }
  return (
    result.stderr.trim() || result.stdout.trim() || `muxify exited with status ${result.exitCode}`
  );
}
