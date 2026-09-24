import { bytesToUtf8 } from '@/lib/utf8';

import { openControlConnection, type ControlConnection } from './control-connection';
import type { ControlEvent } from './control-protocol';
import { TmuxError } from './tmux-error';
import type { ControlChannel, ControlChannelEvents, TmuxTransport } from './transport';

/**
 * A Host that speaks the control protocol, driven line by line from the test.
 *
 * Below the seam, so nothing here is asserted for its own sake — it exists to
 * let the Connection be fed exactly the bytes a real tmux sends, including the
 * ones that arrive halfway through a line.
 */
function fakeHost() {
  const written: string[] = [];
  let events: ControlChannelEvents | null = null;
  let closed = false;
  let attachCommand = '';

  const transport: TmuxTransport = {
    exec: () => Promise.reject(new Error('the Control Connection does not exec')),
    openControl(command, channelEvents): Promise<ControlChannel> {
      attachCommand = command;
      events = channelEvents;
      return Promise.resolve({
        write: (bytes) => {
          written.push(bytesToUtf8(bytes));
        },
        close: async () => {
          closed = true;
        },
      });
    },
  };

  return {
    transport,
    get written() {
      return written;
    },
    get attachCommand() {
      return attachCommand;
    },
    get closed() {
      return closed;
    },
    /** What the last command written was, without its newline. */
    lastCommand(): string {
      return (written[written.length - 1] ?? '').trimEnd();
    },
    say(text: string): void {
      events?.onData(new TextEncoder().encode(text).buffer as ArrayBuffer);
    },
    /** The `%begin`/`%end` pair tmux answers the attach with. */
    accept(): void {
      this.say('%begin 1 1 0\n%end 1 1 0\n');
    },
    reply(id: number, lines: string[] = []): void {
      this.say(`%begin 1 ${id} 1\n${lines.map((line) => `${line}\n`).join('')}%end 1 ${id} 1\n`);
    },
    refuse(id: number, message: string): void {
      this.say(`%begin 1 ${id} 1\n${message}\n%error 1 ${id} 1\n`);
    },
    drop(): void {
      events?.onClosed(undefined);
    },
  };
}

async function connected(host: ReturnType<typeof fakeHost>, sessionName = 'work') {
  const notifications: ControlEvent[] = [];
  const output: { pane: string; text: string }[] = [];
  const closures: string[] = [];

  const opening = openControlConnection(
    host.transport,
    { sessionName },
    {
      onOutput: (pane, bytes) => output.push({ pane, text: bytesToUtf8(bytes) }),
      onNotification: (event) => notifications.push(event),
      onClosed: (reason) => closures.push(reason),
    },
  );
  // Let the transport resolve before tmux answers, as it does on a real Host.
  await Promise.resolve();
  host.accept();

  return { connection: await opening, notifications, output, closures };
}

describe('opening a Control Connection', () => {
  it('runs tmux in control mode with no PTY asked for', async () => {
    const host = fakeHost();
    await connected(host, 'my work');
    expect(host.attachCommand).toBe("tmux '-C' 'attach-session' '-t' 'my work'");
  });

  it('runs the Host’s own tmux when it has one', async () => {
    const host = fakeHost();
    const opening = openControlConnection(
      host.transport,
      { sessionName: 'work', tmuxExecutablePath: '/opt/homebrew/bin/tmux' },
      { onOutput: () => {}, onNotification: () => {}, onClosed: () => {} },
    );
    await Promise.resolve();
    host.accept();
    await opening;
    expect(host.attachCommand).toBe(
      "'/opt/homebrew/bin/tmux' '-C' 'attach-session' '-t' 'work'",
    );
  });

  it('waits for the attach’s own reply before it is open', async () => {
    const host = fakeHost();
    let open = false;
    const opening = openControlConnection(
      host.transport,
      { sessionName: 'work' },
      { onOutput: () => {}, onNotification: () => {}, onClosed: () => {} },
    ).then((connection) => {
      open = true;
      return connection;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(open).toBe(false);

    host.accept();
    await opening;
    expect(open).toBe(true);
  });

  it('does not open when there is nothing to attach to', async () => {
    const host = fakeHost();
    const opening = openControlConnection(
      host.transport,
      { sessionName: 'gone' },
      { onOutput: () => {}, onNotification: () => {}, onClosed: () => {} },
    );
    await Promise.resolve();
    host.say("%begin 1 1 0\ncan't find session: gone\n%error 1 1 0\n");
    await expect(opening).rejects.toThrow("can't find session: gone");
  });

  it('does not open when the channel dies first', async () => {
    const host = fakeHost();
    const opening = openControlConnection(
      host.transport,
      { sessionName: 'work' },
      { onOutput: () => {}, onNotification: () => {}, onClosed: () => {} },
    );
    await Promise.resolve();
    host.drop();
    await expect(opening).rejects.toThrow(TmuxError);
  });

  it('holds a command asked for before the attach answered', async () => {
    const host = fakeHost();
    const opening = openControlConnection(
      host.transport,
      { sessionName: 'work' },
      { onOutput: () => {}, onNotification: () => {}, onClosed: () => {} },
    );
    await Promise.resolve();
    expect(host.written).toHaveLength(0);
    host.accept();
    const connection = await opening;

    const asked = connection.run(['list-sessions']);
    host.reply(2, ['work']);
    expect((await asked).text).toEqual(['work']);
  });
});

describe('running commands', () => {
  let host: ReturnType<typeof fakeHost>;
  let connection: ControlConnection;

  beforeEach(async () => {
    host = fakeHost();
    ({ connection } = await connected(host));
  });

  it('resolves with the reply lines', async () => {
    const asked = connection.command(['list-sessions']);
    expect(host.lastCommand()).toBe("'list-sessions'");
    host.reply(2, ['work', 'play']);
    expect((await asked).map(bytesToUtf8)).toEqual(['work', 'play']);
  });

  it('rejects on %error, and says what tmux said', async () => {
    const asked = connection.command(['select-window', '-t', 'work:9']);
    host.refuse(2, "can't find window: work:9");
    await expect(asked).rejects.toThrow("can't find window: work:9");
  });

  it('reports a failed command as an answer to run(), not a rejection', async () => {
    const asked = connection.run(['list-windows', '-t', 'gone']);
    host.refuse(2, "can't find session: gone");
    const reply = await asked;
    expect(reply.ok).toBe(false);
    expect(reply.text).toEqual(["can't find session: gone"]);
  });

  it('keeps a reply as bytes, so a capture survives', async () => {
    const asked = connection.command(['capture-pane', '-t', '%0', '-p', '-e']);
    // A colour escape and a byte that is not valid UTF-8.
    host.say('%begin 1 2 1\n[31mredÿ\n%end 1 2 1\n');
    const [line] = await asked;
    expect([...line.subarray(0, 5)]).toEqual([0x1b, 0x5b, 0x33, 0x31, 0x6d]);
  });

  it('serialises concurrent callers rather than interleaving them', async () => {
    const first = connection.command(['list-sessions']);
    const second = connection.command(['list-windows', '-t', 'work']);
    const third = connection.command(['list-panes', '-t', 'work:0']);

    expect(host.written.map((line) => line.trimEnd())).toEqual([
      "'list-sessions'",
      "'list-windows' '-t' 'work'",
      "'list-panes' '-t' 'work:0'",
    ]);

    // Answered in the order tmux read them, which is how they are matched.
    host.reply(2, ['sessions']);
    host.reply(3, ['windows']);
    host.reply(4, ['panes']);

    expect((await first).map(bytesToUtf8)).toEqual(['sessions']);
    expect((await second).map(bytesToUtf8)).toEqual(['windows']);
    expect((await third).map(bytesToUtf8)).toEqual(['panes']);
  });

  it('lets one command of a batch fail without taking the rest', async () => {
    const asked = connection.runAll([
      ['capture-pane', '-t', '%0', '-p'],
      ['capture-pane', '-t', '%9', '-p'],
      ['capture-pane', '-t', '%1', '-p'],
    ]);
    host.reply(2, ['first']);
    host.refuse(3, "can't find pane: %9");
    host.reply(4, ['third']);

    const replies = await asked;
    expect(replies.map((reply) => reply.ok)).toEqual([true, false, true]);
    expect(replies[2].text).toEqual(['third']);
  });

  it('ignores a reply nobody asked for', async () => {
    // tmux answers its own hooks; a reply matched to the wrong command would
    // put every later one out of step.
    host.reply(99, ['nobody asked']);
    const asked = connection.command(['list-sessions']);
    host.reply(2, ['work']);
    expect((await asked).map(bytesToUtf8)).toEqual(['work']);
  });

  it('quotes a Session name a shell would have mangled', async () => {
    void connection.run(['switch-client', '-t', "it's $HOME"]);
    expect(host.lastCommand()).toBe('\'switch-client\' \'-t\' "it\'s \\$HOME"');
  });
});

describe('what tmux pushes while commands are in flight', () => {
  it('hands Pane output straight through, keyed by Pane', async () => {
    const host = fakeHost();
    const { output } = await connected(host);
    host.say('%output %3 hello\\015\\012\n');
    expect(output).toEqual([{ pane: '%3', text: 'hello\r\n' }]);
  });

  it('reports a notification without confusing it for a reply', async () => {
    const host = fakeHost();
    const { connection, notifications } = await connected(host);
    const asked = connection.command(['list-sessions']);
    host.say('%window-add @4\n');
    host.reply(2, ['work']);
    await asked;
    expect(notifications).toEqual([{ kind: 'window-add', window: '@4' }]);
  });
});

describe('a Connection that ends', () => {
  it('rejects everything outstanding when the channel drops', async () => {
    const host = fakeHost();
    const { connection, closures } = await connected(host);
    const first = connection.command(['list-sessions']);
    const second = connection.command(['list-windows', '-t', 'work']);

    host.drop();

    await expect(first).rejects.toThrow(TmuxError);
    await expect(second).rejects.toThrow(TmuxError);
    expect(closures).toEqual(['The Connection to the Host was closed']);
  });

  it('rejects a command asked for after it has gone', async () => {
    const host = fakeHost();
    const { connection } = await connected(host);
    host.drop();
    await expect(connection.command(['list-sessions'])).rejects.toThrow(TmuxError);
  });

  it('reports tmux exiting as the end of the Connection', async () => {
    const host = fakeHost();
    const { connection, closures } = await connected(host);
    const asked = connection.command(['list-sessions']);
    host.say('%exit server exited\n');
    await expect(asked).rejects.toThrow('server exited');
    expect(closures).toEqual(['server exited']);
  });

  it('closes the channel when asked, and only says so once', async () => {
    const host = fakeHost();
    const { connection, closures } = await connected(host);
    await connection.close();
    await connection.close();
    expect(host.closed).toBe(true);
    expect(closures).toHaveLength(1);
  });
});
