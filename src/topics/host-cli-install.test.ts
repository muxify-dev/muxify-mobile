import { createTestClock } from '@/lib/test-clock';

import {
  bootstrapCommand,
  HOST_CLI_BASE,
  hostCliBase,
  installHostCli,
  INSTALL_TIMEOUT_MS,
  type HostCliInstall,
  type OpenCommandChannel,
} from './host-cli-install';

/** One channel the runner opened: what it ran, and the Host's half of it. */
interface FakeChannel {
  command: string;
  closed: boolean;
  print(text: string): void;
  exit(code?: number): void;
}

/** A Host that opens channels and lets the test answer on them. */
function fakeHost(options: { refuse?: Error } = {}) {
  const channels: FakeChannel[] = [];
  const open: OpenCommandChannel = (command, events) => {
    if (options.refuse) return Promise.reject(options.refuse);
    const channel: FakeChannel = {
      command,
      closed: false,
      print: (text) => events.onData(new TextEncoder().encode(text).buffer as ArrayBuffer),
      exit: (code) => events.onClosed(code),
    };
    channels.push(channel);
    return Promise.resolve({
      close: () => {
        channel.closed = true;
        return Promise.resolve();
      },
    });
  };
  return { open, channels };
}

/** Lets every promise that can settle, settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function answering(output: string, code = 0): Promise<HostCliInstall> {
  const host = fakeHost();
  const result = installHostCli(host.open, { clock: createTestClock() });
  await settle();
  host.channels[0]!.print(output);
  host.channels[0]!.exit(code);
  return result;
}

describe('the bootstrap', () => {
  it('fetches install.sh with curl, else wget, pipes it to sh with the base, and runs in /bin/sh', () => {
    const script = [
      'exec 2>&1',
      `base='${HOST_CLI_BASE}'`,
      'if command -v curl >/dev/null 2>&1; then',
      '  curl -fsSL "${base}install.sh" | sh -s -- "$base"',
      'elif command -v wget >/dev/null 2>&1; then',
      '  wget -qO- "${base}install.sh" | sh -s -- "$base"',
      'else',
      "  echo 'failed: neither curl nor wget'",
      'fi',
      '',
    ].join('\n');
    expect(bootstrapCommand(HOST_CLI_BASE)).toBe(`/bin/sh -c '${script.split("'").join("'\\''")}'`);
  });

  it('is what the runner sends', async () => {
    const host = fakeHost();
    void installHostCli(host.open, { clock: createTestClock() });
    await settle();

    expect(host.channels.map((channel) => channel.command)).toEqual([bootstrapCommand(hostCliBase())]);
  });
});

describe('the base URL', () => {
  it('is the cli-latest prerelease', () => {
    expect(HOST_CLI_BASE).toBe('https://github.com/muxify-dev/muxify/releases/download/cli-latest/');
    expect(hostCliBase(true, undefined)).toBe(HOST_CLI_BASE);
    expect(hostCliBase(true, '')).toBe(HOST_CLI_BASE);
  });

  it('comes from EXPO_PUBLIC_MUXIFY_CLI_BASE_URL in a dev build', () => {
    expect(hostCliBase(true, 'http://host.orb.internal:8765/')).toBe('http://host.orb.internal:8765/');
    expect(hostCliBase(true, 'http://host.orb.internal:8765')).toBe('http://host.orb.internal:8765/');
  });

  it('ignores the variable in a release build', () => {
    expect(hostCliBase(false, 'http://host.orb.internal:8765/')).toBe(HOST_CLI_BASE);
  });

  it('reads the variable by default in a dev build, and the runner sends it', async () => {
    const before = process.env.EXPO_PUBLIC_MUXIFY_CLI_BASE_URL;
    process.env.EXPO_PUBLIC_MUXIFY_CLI_BASE_URL = 'http://localhost:8765/';
    try {
      const host = fakeHost();
      void installHostCli(host.open, { clock: createTestClock() });
      await settle();

      expect(host.channels[0]?.command).toBe(bootstrapCommand('http://localhost:8765/'));
    } finally {
      if (before === undefined) delete process.env.EXPO_PUBLIC_MUXIFY_CLI_BASE_URL;
      else process.env.EXPO_PUBLIC_MUXIFY_CLI_BASE_URL = before;
    }
  });
});

describe('the install runner', () => {
  it.each<[string, HostCliInstall]>([
    ['installed abc1234 1700000000', { kind: 'installed', text: 'abc1234 1700000000', line: 'installed abc1234 1700000000' }],
    [
      'updated abc1234 1700000000 -> def5678 1700000100',
      {
        kind: 'updated',
        text: 'abc1234 1700000000 -> def5678 1700000100',
        line: 'updated abc1234 1700000000 -> def5678 1700000100',
      },
    ],
    ['current def5678 1700000100', { kind: 'current', text: 'def5678 1700000100', line: 'current def5678 1700000100' }],
    [
      'kept fff0000 1800000000 (newer than def5678 1700000100)',
      {
        kind: 'kept',
        text: 'fff0000 1800000000 (newer than def5678 1700000100)',
        line: 'kept fff0000 1800000000 (newer than def5678 1700000100)',
      },
    ],
    [
      'skipped: app bundle /Applications/Muxify.app/Contents/Resources/bin/muxify',
      {
        kind: 'skipped',
        text: 'app bundle /Applications/Muxify.app/Contents/Resources/bin/muxify',
        line: 'skipped: app bundle /Applications/Muxify.app/Contents/Resources/bin/muxify',
      },
    ],
    [
      'failed: neither curl nor wget',
      { kind: 'failed', text: 'neither curl nor wget', line: 'failed: neither curl nor wget' },
    ],
  ])('reads %s', async (line, expected) => {
    expect(await answering(`${line}\n`)).toEqual(expected);
  });

  it('finds the result line among other output, and reads one with no newline', async () => {
    expect(await answering('downloading muxify-linux-arm64\r\ninstalled abc1234 1700000000', 0)).toMatchObject({
      kind: 'installed',
      text: 'abc1234 1700000000',
    });
  });

  it('takes the result line as soon as it comes, and closes its channel', async () => {
    const host = fakeHost();
    const result = installHostCli(host.open, { clock: createTestClock() });
    await settle();
    host.channels[0]!.print('current abc 1\n');

    expect(await result).toMatchObject({ kind: 'current' });
    expect(host.channels[0]?.closed).toBe(true);
  });

  it('fails, and closes its channel, when the Host does not answer in about 3 minutes', async () => {
    const clock = createTestClock();
    const host = fakeHost();
    const result = installHostCli(host.open, { clock });
    await settle();

    clock.advance(INSTALL_TIMEOUT_MS - 1);
    host.channels[0]!.print('downloading\n');
    clock.advance(1);

    expect(await result).toEqual({
      kind: 'failed',
      text: 'no answer in 3 minutes',
      line: 'failed: no answer in 3 minutes',
    });
    expect(host.channels[0]?.closed).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('fails when the channel closes before the install answers', async () => {
    const host = fakeHost();
    const result = installHostCli(host.open, { clock: createTestClock() });
    await settle();
    host.channels[0]!.exit();

    expect(await result).toEqual({
      kind: 'failed',
      text: 'the channel closed before the install answered',
      line: 'failed: the channel closed before the install answered',
    });
  });

  it('fails, with the last line it printed, on output with no result line', async () => {
    expect(await answering('curl: (22) The requested URL returned error: 404\n', 0)).toEqual({
      kind: 'failed',
      text: 'the install printed no result line: curl: (22) The requested URL returned error: 404',
      line: 'failed: the install printed no result line: curl: (22) The requested URL returned error: 404',
    });
  });

  it('does not take a line that only looks like a result for one', async () => {
    expect(await answering('updated the cache\nkept going\n', 1)).toMatchObject({
      kind: 'failed',
      text: 'the install printed no result line: kept going',
    });
  });

  it('fails, and never throws, when the channel cannot be opened', async () => {
    const host = fakeHost({ refuse: new Error('channel refused') });
    const clock = createTestClock();

    expect(await installHostCli(host.open, { clock })).toEqual({
      kind: 'failed',
      text: 'could not open a channel: channel refused',
      line: 'failed: could not open a channel: channel refused',
    });
    expect(clock.pending()).toBe(0);
  });

  it('never throws when opening throws at once', async () => {
    const open: OpenCommandChannel = () => {
      throw new Error('no session');
    };

    expect(await installHostCli(open, { clock: createTestClock() })).toMatchObject({ kind: 'failed' });
  });
});
