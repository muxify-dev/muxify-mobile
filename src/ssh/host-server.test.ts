import { readFileSync } from 'fs';
import { join } from 'path';

import { createTestClock } from '@/lib/test-clock';
import { bytesToUtf8 } from '@/lib/utf8';
import type { HostCliInstall } from '@/topics/host-cli-install';

import { createHostServer, HostServerError, PHONE_CAPABILITIES, type OpenServerChannel } from './host-server';
import { createFrameReader, HELLO_TIMEOUT_MS, MAX_PREAMBLE_BYTES, PING_AFTER_MS, type ServerChannelEvents } from './host-server-channel';

/**
 * The frames MuxifyCore's tests pin, copied from
 * `muxify-shell/Packages/MuxifyCore/Tests/MuxifyCoreTests/Fixtures/Protocol`.
 * They are the contract: the phone must read every server frame there and
 * write its own frames the way they are written there. Of `3-colour-reports`
 * only the server's protocol 2 `hello` is copied: the phone sends no `colours`
 * and no `focus`. `5-board` adds the capability `board`, which the phone
 * requires since it shows Board Sessions.
 */
function fixture(name: '1-first-server' | '2-phone' | '3-colour-reports' | '5-board'): string[] {
  const text = readFileSync(join(__dirname, '__fixtures__', 'host-server', name, 'frames.jsonl'), 'utf8');
  return text.split('\n').filter((line) => line.length > 0);
}

const FIRST = fixture('1-first-server');
const PHONE = fixture('2-phone');
const COLOURS = fixture('3-colour-reports');
const BOARD = fixture('5-board');

/** The fixture's frame on `line` (from 1), with its id changed to `id`, as a line the server sends. */
function line(frames: string[], at: number, id?: number): string {
  const frame = JSON.parse(frames[at - 1] as string) as { id: number };
  return `${JSON.stringify(id === undefined ? frame : { ...frame, id })}\n`;
}

/** A server `hello` that also declares `board`, as a Host CLI from `5-board` on does. */
function withBoard(hello: string): string {
  const frame = JSON.parse(hello) as { hello: { capabilities: string[] } };
  return `${JSON.stringify({ ...frame, hello: { ...frame.hello, capabilities: [...frame.hello.capabilities, 'board'] } })}\n`;
}

const FIRST_SERVER_HELLO = line(FIRST, 1);
/** The `2-phone` server's protocol 1 `hello`, from a Host CLI that also has `board`. */
const SERVER_HELLO = withBoard(line(PHONE, 1));

/** A server's `hello` with every capability the phone uses, offering `min_protocol`…`protocol`, or `protocol` alone. */
function offering(protocol: number, min?: number, build = 'muxify next'): string {
  const hello = { build, capabilities: [...PHONE_CAPABILITIES], ...(min === undefined ? {} : { min_protocol: min }), protocol };
  return `${JSON.stringify({ hello, id: 0, kind: 'hello' })}\n`;
}
const BUILD = 'Muxify 1.0.0 build 1';
const PATH = '/usr/local/bin/muxify';

/** A `muxify server` on an exec channel, which the test scripts frame by frame. */
interface FakeChannel {
  command: string;
  /** The frames the phone wrote, parsed. */
  sent: Record<string, unknown>[];
  closed: boolean;
  print(text: string): void;
  printError(text: string): void;
  exit(code?: number): void;
}

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

function setup(options: { path?: string | null; version?: string } = {}) {
  const clock = createTestClock();
  const channels: FakeChannel[] = [];
  const logged: string[] = [];
  const state = { path: options.path === undefined ? PATH : options.path, forgotten: 0, connected: true };

  const open: OpenServerChannel = (command, events: ServerChannelEvents) => {
    let partial = '';
    const channel: FakeChannel = {
      command,
      sent: [],
      closed: false,
      print: (text) => events.onData(encode(text)),
      printError: (text) => events.onStderr(encode(text)),
      exit: (code) => {
        channel.closed = true;
        events.onClosed(code);
      },
    };
    channels.push(channel);
    return Promise.resolve({
      write(bytes) {
        partial += bytesToUtf8(bytes);
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        for (const text of lines) channel.sent.push(JSON.parse(text) as Record<string, unknown>);
      },
      close() {
        channel.closed = true;
        return Promise.resolve();
      },
    });
  };

  const server = createHostServer({
    open,
    locate: () => Promise.resolve(state.path),
    forget: () => {
      state.forgotten += 1;
    },
    version: () => Promise.resolve(options.version ?? ''),
    connected: () => state.connected,
    build: BUILD,
    clock,
    say: (text) => logged.push(text),
  });

  const channel = (at = channels.length - 1): FakeChannel => {
    const found = channels[at];
    if (!found) throw new Error(`no channel ${at}`);
    return found;
  };

  /** The server's side of the handshake, on the latest channel. */
  async function answer(hello = SERVER_HELLO): Promise<FakeChannel> {
    await settle();
    const opened = channel();
    opened.print(`MUXIFY-PROTOCOL\n${hello}`);
    await settle();
    return opened;
  }

  return { clock, channels, channel, logged, state, server, answer };
}

/** Lets every promise that can settle, settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The requests the phone wrote, without its `hello`. */
const requests = (channel: FakeChannel) => channel.sent.filter((frame) => frame.kind !== 'hello');

describe('the Host Server link', () => {
  describe('the wire', () => {
    it('runs the probed muxify’s `server` on an exec channel', async () => {
      const { channel } = setup({ path: '/Users/me/.local/bin/muxify' });
      await settle();

      expect(channel().command).toBe("'/Users/me/.local/bin/muxify' server");
    });

    it('skips the shell’s output before MUXIFY-PROTOCOL, also when it comes in pieces', async () => {
      const { server, channel } = setup();
      await settle();

      channel().print('Last login: Mon Nov 17\r\nWelcome to the Host\nMUXIFY-PRO');
      channel().print(`TOCOL\n${SERVER_HELLO.slice(0, 20)}`);
      channel().print(SERVER_HELLO.slice(20));
      await settle();

      expect(server.state()).toEqual({ kind: 'live', build: 'muxify 1a2b3c4 1763100000', protocol: 1 });
    });

    it('logs the byte count and the first line when MUXIFY-PROTOCOL never comes in the first 64 KiB', async () => {
      const { channel, logged } = setup();
      await settle();

      channel().print(`a profile that talks\n${'x'.repeat(MAX_PREAMBLE_BYTES)}\n`);
      await settle();

      expect(channel(0).closed).toBe(true);
      expect(logged[0]).toMatch(/the shell printed 655\d\d bytes before it, first "a profile that talks"/);
    });

    it('decodes a frame split inside a UTF-8 character with the phone’s own decoder', () => {
      const reader = createFrameReader();
      const bytes = new TextEncoder().encode('MUXIFY-PROTOCOL\n{"id":1,"title":"Café ☕"}\n');
      const cut = bytes.indexOf(0xe2) + 1;

      const lines = [...reader.feed(bytes.slice(0, cut)), ...reader.feed(bytes.slice(cut))];

      expect(lines).toEqual(['{"id":1,"title":"Café ☕"}']);
    });

    it('keeps stderr apart from the frames and quotes its last line when the channel fails', async () => {
      const { channel, logged, answer } = setup();
      await answer();

      channel().printError('muxify server: speaks protocols 1 to 1\nmuxify server: lost tmux\n');
      channel().exit(1);
      await settle();

      expect(logged).toContain('the channel failed: the channel closed, exit 1; last stderr line: "muxify server: lost tmux"');
    });

    it('closes a channel that sends a line that is not JSON, or a frame with no id', async () => {
      const { channel, answer, logged } = setup();
      await answer();

      channel().print('not json\n');
      await settle();

      expect(channel(0).closed).toBe(true);
      expect(logged.join('\n')).toMatch(/a line that is not JSON/);
    });
  });

  describe('the handshake', () => {
    it('answers the server’s hello with protocol 1, its build and its capabilities, and no nonce', async () => {
      const { channel, answer } = setup();
      await answer();

      const phoneHello = JSON.parse(withBoard(line(PHONE, 2))) as { hello: { capabilities: string[] } };
      expect(channel().sent[0]).toEqual({
        id: 0,
        kind: 'hello',
        hello: { protocol: 1, build: BUILD, capabilities: phoneHello.hello.capabilities },
      });
      expect(phoneHello.hello.capabilities).toEqual([...PHONE_CAPABILITIES]);
    });

    it.each([
      { offers: '1 to 1', hello: SERVER_HELLO, protocol: 1 },
      { offers: '2 to 2', hello: line(BOARD, 1), protocol: 2 },
      { offers: '2 to 2, with the colour reports', hello: withBoard(line(COLOURS, 1)), protocol: 2 },
      { offers: '1 to 2', hello: offering(2, 1, 'muxify 1a2b3c4 1763100000'), protocol: 2 },
      { offers: '2 alone, with no min_protocol', hello: offering(2, undefined, 'muxify 1a2b3c4 1763100000'), protocol: 2 },
      { offers: '1 to 3', hello: offering(3, 1, 'muxify 1a2b3c4 1763100000'), protocol: 2 },
    ])('is live on the highest protocol both speak, which its hello carries, with a server that offers $offers', async ({ hello, protocol }) => {
      const { server, channel, logged, answer } = setup();
      await answer(hello);

      expect(channel().sent[0]).toMatchObject({ id: 0, kind: 'hello', hello: { protocol } });
      expect(server.state()).toEqual({ kind: 'live', build: 'muxify 1a2b3c4 1763100000', protocol });
      expect(logged).toEqual([`muxify 1a2b3c4 1763100000, protocol ${protocol}`]);
    });

    it('is live, and logs the server’s build and protocol once', async () => {
      const { server, logged, answer } = setup();
      await answer();

      expect(server.state()).toEqual({ kind: 'live', build: 'muxify 1a2b3c4 1763100000', protocol: 1 });
      expect(logged).toEqual(['muxify 1a2b3c4 1763100000, protocol 1']);
    });

    it('is Sessions only, too old, with a server from before `board`, which shows no Board Sessions', async () => {
      const { server, logged, answer } = setup();
      await answer(line(PHONE, 1));

      expect(server.state()).toMatchObject({ kind: 'sessions-only', tooOld: 'host' });
      expect(logged).toContain('muxify 1a2b3c4 1763100000 lacks the capabilities board');
    });

    it('is Sessions only, too old, when the server lacks a capability the phone uses', async () => {
      const { server, channel, logged, answer } = setup();
      await answer(FIRST_SERVER_HELLO);

      expect(server.state()).toEqual({
        kind: 'sessions-only',
        reason: "the Host's muxify is too old (muxify 1a2b3c4 1763100000)",
        tooOld: 'host',
      });
      expect(channel().closed).toBe(true);
      expect(logged).toContain("Sessions only: the Host's muxify is too old (muxify 1a2b3c4 1763100000)");
    });

    it('says the phone is too old when every protocol of the server is above the phone’s', async () => {
      const { server, channel, logged, answer } = setup();
      await answer(offering(3, 3));

      expect(server.state()).toEqual({
        kind: 'sessions-only',
        reason: "Muxify Mobile is too old for the Host's muxify (muxify next). Update the app.",
        tooOld: 'phone',
      });
      expect(channel().sent).toEqual([]);
      expect(channel().closed).toBe(true);
      expect(logged).toContain("Sessions only: Muxify Mobile is too old for the Host's muxify (muxify next). Update the app.");
    });

    it('says the Host’s muxify is too old when every protocol of the server is below the phone’s', async () => {
      const { server, channel, answer } = setup();
      await answer(offering(0, 0, 'muxify old'));

      expect(server.state()).toEqual({ kind: 'sessions-only', reason: "the Host's muxify is too old (muxify old)", tooOld: 'host' });
      expect(channel().sent).toEqual([]);
    });

    it('is too old, naming the `--version` line, when `muxify` exits 2 before hello', async () => {
      const { server, channel, logged } = setup({ version: 'muxify 0aa0aa0 1700000000' });
      await settle();

      channel().printError("muxify: unknown command 'server'\n");
      channel().exit(2);
      await settle();

      expect(server.state()).toEqual({
        kind: 'sessions-only',
        reason: "the Host's muxify is too old (muxify 0aa0aa0 1700000000)",
        tooOld: 'host',
      });
      expect(logged[0]).toContain(`last stderr line: "muxify: unknown command 'server'"`);
    });

    it('is Sessions only when no hello comes within 10 s', async () => {
      const { server, clock, channel } = setup();
      await settle();

      clock.advance(HELLO_TIMEOUT_MS);
      await settle();

      expect(server.state()).toEqual({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
      expect(channel().closed).toBe(true);
    });
  });

  describe('requests', () => {
    it('numbers its requests from 1 and resolves each with the ok of its end', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const asked = server.request({ ping: {} });
      await settle();
      channel().print(line(FIRST, 6));

      await expect(asked).resolves.toEqual({});
      expect(requests(channel())).toEqual([JSON.parse(line(FIRST, 3))]);
    });

    it('waits while the server starts, and sends after the handshake', async () => {
      const { server, channel, answer } = setup();

      const asked = server.request({ ping: {} });
      await answer();
      channel().print(line(FIRST, 6));

      await expect(asked).resolves.toEqual({});
    });

    it('rejects with each error code and its message', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const asked = Array.from({ length: 8 }, () => server.request({ ping: {} }));
      for (const settled of asked) settled.catch(() => {});
      await settle();
      for (const at of [6, 7, 8, 9, 10, 11]) channel().print(line(FIRST, at));
      await settle();

      await expect(asked[0]).resolves.toEqual({});
      const codes = await Promise.all(
        asked.slice(3).map((call) => call.then(() => null, (error: HostServerError) => [error.code, error.message])),
      );
      expect(codes).toEqual([
        ['unsupported', 'this muxify does not know the request frob'],
        ['invalid', 'm'],
        ['cancelled', 'cancelled'],
        ['unavailable', 'the subscriber fell behind'],
        ['failed', 'm'],
      ]);
    });

    it('carries the topic_failure of a failed environment request', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const asked = Array.from({ length: 4 }, () => server.request({ ping: {} }));
      for (const settled of asked) settled.catch(() => {});
      await settle();
      channel().print(line(PHONE, 6, 4));
      await settle();

      const error = (await asked[3]?.catch((thrown: unknown) => thrown)) as HostServerError;
      expect(error).toBeInstanceOf(HostServerError);
      expect(error.code).toBe('failed');
      expect(error.topic_failure).toMatchObject({ kind: 'request_clash', phase: 'nothing_changed' });
    });

    it('sends cancel for a request that went out', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const asked = server.request({ ping: {} });
      asked.catch(() => {});
      await settle();
      asked.cancel();
      channel().print(line(FIRST, 9, 1));

      expect(channel().sent.at(-1)).toEqual(JSON.parse(line(FIRST, 12, 1)));
      await expect(asked).rejects.toMatchObject({ code: 'cancelled' });
    });

    it('fails every waiting request and subscription at once with unavailable when the channel ends', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const asked = server.request({ ping: {} });
      const watched = server.subscribe({ snapshot: {} }, () => {});
      await settle();
      channel().exit();

      await expect(asked).rejects.toMatchObject({ code: 'unavailable' });
      await expect(watched).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('answers a request from the server with unsupported', async () => {
      const { channel, answer } = setup();
      await answer();

      channel().print('{"id":1,"kind":"request","request":{"claim_open":{}}}\n');

      expect(channel().sent.at(-1)).toEqual({
        id: 1,
        kind: 'end',
        end: { error: { code: 'unsupported', message: 'the phone serves no request from the Host Server' } },
      });
    });
  });

  describe('subscriptions', () => {
    it('delivers the first item, holding the whole state, and every later one', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const items: unknown[] = [];
      void server.subscribe({ snapshot: {} }, (item) => items.push(item)).catch(() => {});
      await settle();
      channel().print(line(PHONE, 22, 1));
      channel().print(line(PHONE, 23, 1));

      expect(requests(channel())).toEqual([JSON.parse(line(PHONE, 21, 1))]);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ no_topic: ['$1'], sidebar: { sessions: true, topics: true } });
      expect(items[1]).toMatchObject({ no_topic: [], unpinned: { places: [{ topic: { id: 't1' } }] } });
    });

    it('delivers a null item when the Topic is gone', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const items: unknown[] = [];
      void server.subscribe({ topic: { id: 't' } }, (item) => items.push(item)).catch(() => {});
      await settle();
      channel().print(line(PHONE, 10, 1));
      channel().print(line(PHONE, 11, 1));

      expect(requests(channel())).toEqual([JSON.parse(line(PHONE, 9, 1))]);
      expect(items[0]).toMatchObject({ topic: { title: 'Ship' } });
      expect(items[1]).toBeNull();
    });
  });

  describe('liveness', () => {
    it('pings after 15 s with nothing sent, and not before', async () => {
      const { clock, channel, answer } = setup();
      await answer();

      clock.advance(PING_AFTER_MS - 1);
      expect(requests(channel())).toEqual([]);
      clock.advance(1);

      expect(requests(channel())).toEqual([JSON.parse(line(FIRST, 3))]);
    });

    it('waits 15 s again after each frame it sends', async () => {
      const { clock, server, channel, answer } = setup();
      await answer();

      clock.advance(10_000);
      void server.request({ snapshot: {} }).catch(() => {});
      await settle();
      clock.advance(10_000);

      expect(requests(channel())).toHaveLength(1);
      clock.advance(5_000);
      expect(requests(channel()).at(-1)).toMatchObject({ request: { ping: {} } });
    });

    it('gives a request no timeout of its own', async () => {
      const { clock, server, answer } = setup();
      await answer();

      let ended = false;
      void server.request({ snapshot: {} }).finally(() => {
        ended = true;
      });
      clock.advance(10 * 60_000);
      await settle();

      expect(ended).toBe(false);
    });
  });

  describe('stops', () => {
    it('starts again when the server stops while the Connection lives', async () => {
      const { server, channels, channel, answer } = setup();
      await answer();

      channel().exit(1);
      await answer();

      expect(channels).toHaveLength(2);
      expect(server.state()).toMatchObject({ kind: 'live' });
    });

    it('is Sessions only after 3 stops within 60 s, quoting the last stderr line', async () => {
      const { server, clock, channels, channel, answer } = setup();
      for (let stop = 1; stop <= 3; stop += 1) {
        await answer();
        channel().printError(`muxify server: crash ${stop}\n`);
        channel().exit(1);
        clock.advance(10_000);
        await settle();
      }

      expect(server.state()).toEqual({
        kind: 'sessions-only',
        reason: 'the Host Server stopped 3 times in a minute (muxify server: crash 3)',
      });
      expect(channels).toHaveLength(3);
      await expect(server.request({ ping: {} })).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('keeps starting when the stops are more than a minute apart', async () => {
      const { server, clock, channel, answer } = setup();
      for (let stop = 1; stop <= 3; stop += 1) {
        await answer();
        channel().exit(1);
        clock.advance(31_000);
        await settle();
      }
      await answer();

      expect(server.state()).toMatchObject({ kind: 'live' });
    });

    it('does not start again when its Connection is gone', async () => {
      const { server, state, channels, channel, answer } = setup();
      await answer();

      state.connected = false;
      channel().exit();
      await settle();

      expect(channels).toHaveLength(1);
      server.close();
      expect(server.state()).toEqual({ kind: 'closed' });
    });

    it('closes the channel and fails waiting requests when the Connection closes', async () => {
      const { server, channel, answer } = setup();
      await answer();

      const asked = server.request({ snapshot: {} });
      await settle();
      server.close();

      await expect(asked).rejects.toMatchObject({ code: 'unavailable' });
      expect(channel().closed).toBe(true);
    });
  });

  describe('the install', () => {
    const updated: HostCliInstall = { kind: 'updated', line: 'updated: muxify 7593671 1794697369' } as HostCliInstall;

    it('restarts on the new binary after an install `updated`: shutdown, forget, start', async () => {
      const { server, state, channels, channel, answer } = setup();
      await answer(FIRST_SERVER_HELLO.replace('"capabilities":[]', `"capabilities":${JSON.stringify(PHONE_CAPABILITIES)}`));

      const old = channel();
      state.path = '/Users/me/.local/bin/muxify';
      server.installAnswered(updated);
      await settle();

      expect(requests(old)).toEqual([JSON.parse(line(FIRST, 4, 1))]);
      expect(state.forgotten).toBe(1);
      expect(channels).toHaveLength(2);
      expect(channel().command).toBe("'/Users/me/.local/bin/muxify' server");

      old.print(line(FIRST, 6, 1));
      await settle();
      expect(old.closed).toBe(true);
      await answer(SERVER_HELLO);
      expect(server.state()).toMatchObject({ kind: 'live', build: 'muxify 1a2b3c4 1763100000' });
    });

    it('starts again after an update that follows a too-old server', async () => {
      const { server, channels, answer } = setup();
      await answer(FIRST_SERVER_HELLO);
      expect(server.state()).toMatchObject({ kind: 'sessions-only' });

      server.installAnswered(updated);
      await answer();

      expect(channels).toHaveLength(2);
      expect(server.state()).toMatchObject({ kind: 'live' });
    });

    it('waits for the install when the Host has no muxify, then starts on it', async () => {
      const { server, state, channels, answer } = setup({ path: null });
      await settle();

      expect(server.state()).toEqual({ kind: 'installing' });
      expect(channels).toHaveLength(0);

      state.path = '/Users/me/.local/bin/muxify';
      server.installAnswered({ kind: 'installed', line: 'installed: muxify 7593671 1794697369' } as HostCliInstall);
      await answer();

      expect(server.state()).toMatchObject({ kind: 'live' });
    });

    it('is Sessions only when the install fails on a Host with no muxify', async () => {
      const { server, logged } = setup({ path: null });
      await settle();

      server.installAnswered({ kind: 'failed', line: 'failed: no curl on the Host' } as HostCliInstall);

      expect(server.state()).toEqual({
        kind: 'sessions-only',
        reason: 'the Host CLI could not be installed (failed: no curl on the Host)',
      });
      expect(logged).toEqual(['Sessions only: the Host CLI could not be installed (failed: no curl on the Host)']);
    });

    it('stays live on an install `current`', async () => {
      const { server, channels, answer } = setup();
      await answer();

      server.installAnswered({ kind: 'current', line: 'current: muxify 7593671 1794697369' } as HostCliInstall);
      await settle();

      expect(channels).toHaveLength(1);
      expect(server.state()).toMatchObject({ kind: 'live' });
    });
  });
});
