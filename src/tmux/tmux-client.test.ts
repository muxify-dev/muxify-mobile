import { TmuxClient, TmuxError } from './tmux-client';
import type { TmuxExecResult, TmuxShell, TmuxShellOptions, TmuxTransport } from './transport';

/**
 * A transport that returns canned tmux output. This is the project's single
 * seam: the SSH library sits behind this interface and is never unit-tested,
 * because asserting that a mock was called proves nothing about whether bytes
 * reach a terminal.
 */
class FakeTransport implements TmuxTransport {
  readonly commands: string[] = [];
  shellOptions: TmuxShellOptions | null = null;

  constructor(private readonly responses: Record<string, Partial<TmuxExecResult>> = {}) {}

  /** Matches on a substring so tests need not restate the whole command. */
  private lookup(command: string): Partial<TmuxExecResult> | undefined {
    const key = Object.keys(this.responses).find((candidate) => command.includes(candidate));
    return key === undefined ? undefined : this.responses[key];
  }

  async exec(command: string): Promise<TmuxExecResult> {
    this.commands.push(command);
    const response = this.lookup(command) ?? {};
    return { stdout: '', stderr: '', exitCode: 0, ...response };
  }

  async openShell(options: TmuxShellOptions): Promise<TmuxShell> {
    this.shellOptions = options;
    return {
      write: () => {},
      resize: () => {},
      close: async () => {},
    };
  }
}

describe('listSessions', () => {
  it('returns each Session with how many Windows it holds', async () => {
    const transport = new FakeTransport({ 'list-sessions': { stdout: 'main\t3\nwork\t1\n0\t2\n' } });
    await expect(new TmuxClient(transport).listSessions()).resolves.toEqual([
      { name: 'main', windowCount: 3 },
      { name: 'work', windowCount: 1 },
      { name: '0', windowCount: 2 },
    ]);
  });

  it('ignores blank lines and trailing whitespace', async () => {
    const transport = new FakeTransport({
      'list-sessions': { stdout: '  main\t1  \n\n\nwork\t2\n\n' },
    });
    await expect(new TmuxClient(transport).listSessions()).resolves.toEqual([
      { name: 'main', windowCount: 1 },
      { name: 'work', windowCount: 2 },
    ]);
  });

  it('returns an empty list when no tmux server is running', async () => {
    // The case that must never read as an error: a Host with tmux installed but
    // nothing running is simply a Host with no Sessions.
    const transport = new FakeTransport({
      'list-sessions': { exitCode: 1, stderr: 'no server running on /tmp/tmux-1000/default' },
    });
    await expect(new TmuxClient(transport).listSessions()).resolves.toEqual([]);
  });

  it('returns an empty list when the tmux socket does not exist', async () => {
    const transport = new FakeTransport({
      'list-sessions': {
        exitCode: 1,
        stderr: 'error connecting to /tmp/tmux-1000/default (No such file or directory)',
      },
    });
    await expect(new TmuxClient(transport).listSessions()).resolves.toEqual([]);
  });

  it('throws when tmux is not installed, which is a real failure', async () => {
    const transport = new FakeTransport({
      'list-sessions': { exitCode: 127, stderr: 'bash: tmux: command not found' },
    });
    await expect(new TmuxClient(transport).listSessions()).rejects.toBeInstanceOf(TmuxError);
  });

  it('surfaces the stderr text on failure so the cause is visible', async () => {
    const transport = new FakeTransport({
      'list-sessions': { exitCode: 127, stderr: 'bash: tmux: command not found' },
    });
    await expect(new TmuxClient(transport).listSessions()).rejects.toThrow(/command not found/);
  });

  it('uses the Host tmux path when one is configured', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport, { tmuxExecutablePath: '/usr/bin/tmux' }).listSessions();
    expect(transport.commands[0]).toContain("'/usr/bin/tmux'");
  });
});

describe('listWindows', () => {
  it('parses everything a Window preview needs', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\t3\t1\tvim\n1\teditor\t0\t1\t0\tfish\n' },
    });
    await expect(new TmuxClient(transport).listWindows('main')).resolves.toEqual([
      { index: 0, name: 'bash', active: true, paneCount: 3, zoomed: true, command: 'vim' },
      { index: 1, name: 'editor', active: false, paneCount: 1, zoomed: false, command: 'fish' },
    ]);
  });

  it('keeps a Window name containing spaces and colons intact', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '2\tvim: src/app.ts\t0\t1\t0\tvim\n' },
    });
    const [window] = await new TmuxClient(transport).listWindows('main');
    expect(window.name).toBe('vim: src/app.ts');
  });

  it('returns an empty list when the Session has no Windows', async () => {
    const transport = new FakeTransport({ 'list-windows': { stdout: '' } });
    await expect(new TmuxClient(transport).listWindows('main')).resolves.toEqual([]);
  });

  it('skips a malformed line rather than failing the whole read', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\t1\t0\tbash\ngarbage\n' },
    });
    await expect(new TmuxClient(transport).listWindows('main')).resolves.toHaveLength(1);
  });

  it('treats a vanished Session as no Windows', async () => {
    const transport = new FakeTransport({
      'list-windows': { exitCode: 1, stderr: "can't find session: main" },
    });
    await expect(new TmuxClient(transport).listWindows('main')).resolves.toEqual([]);
  });
});

describe('listPanes', () => {
  it('parses everything a Pane preview needs, geometry included', async () => {
    const transport = new FakeTransport({
      'list-panes': { stdout: '0\tbash\t0\thost\t0\t0\t40\t24\n1\tvim\t1\thost\t41\t0\t39\t24\n' },
    });
    await expect(new TmuxClient(transport).listPanes('main', 1)).resolves.toEqual([
      { index: 0, command: 'bash', active: false, title: 'host', left: 0, top: 0, width: 40, height: 24 },
      { index: 1, command: 'vim', active: true, title: 'host', left: 41, top: 0, width: 39, height: 24 },
    ]);
  });

  it('targets the requested Window', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport).listPanes('main', 3);
    expect(transport.commands[0]).toContain("-t 'main:3'");
  });
});

describe('switching', () => {
  it('selects a Window', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport).selectWindow('main', 2);
    expect(transport.commands).toEqual(["tmux select-window -t 'main:2'"]);
  });

  it('selects a Pane', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport).selectPane('main', 2, 1);
    expect(transport.commands).toEqual(["tmux select-pane -t 'main:2.1'"]);
  });

  it('switches Session', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport).switchSession('other');
    expect(transport.commands).toEqual(["tmux switch-client -t 'other'"]);
  });

  it('throws when a switch fails, since the user asked for it explicitly', async () => {
    const transport = new FakeTransport({
      'select-window': { exitCode: 1, stderr: "can't find window: 9" },
    });
    await expect(new TmuxClient(transport).selectWindow('main', 9)).rejects.toBeInstanceOf(
      TmuxError,
    );
  });
});

describe('attach', () => {
  it('opens a Shell Channel running the attach command at the given grid', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport).attach(
      'main',
      { cols: 80, rows: 24 },
      { onData: () => {}, onClosed: () => {} },
    );

    expect(transport.shellOptions).toEqual({
      term: 'xterm-256color',
      cols: 80,
      rows: 24,
      command: "tmux attach-session -t 'main'",
    });
  });

  it('never creates a Session', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport).attach(
      'main',
      { cols: 80, rows: 24 },
      { onData: () => {}, onClosed: () => {} },
    );
    expect(transport.shellOptions?.command).not.toContain('new-session');
  });

  it('honours the Host tmux path', async () => {
    const transport = new FakeTransport();
    await new TmuxClient(transport, { tmuxExecutablePath: '/usr/bin/tmux' }).attach(
      'main',
      { cols: 80, rows: 24 },
      { onData: () => {}, onClosed: () => {} },
    );
    expect(transport.shellOptions?.command).toBe("'/usr/bin/tmux' attach-session -t 'main'");
  });
});

describe('setWindowSize', () => {
  it('makes the Session sizeable by hand before resizing it', async () => {
    const transport = new FakeTransport();

    await new TmuxClient(transport).setWindowSize('main', { cols: 38, rows: 14 });

    expect(transport.commands).toEqual([
      "tmux set-option -t 'main' window-size manual",
      "tmux resize-window -t 'main' -x 38 -y 14",
    ]);
  });

  it('only sets manual sizing once per Session, so a resize costs one round trip', async () => {
    const transport = new FakeTransport();
    const client = new TmuxClient(transport);

    await client.setWindowSize('main', { cols: 38, rows: 14 });
    await client.setWindowSize('main', { cols: 38, rows: 30 });

    // Every extra Control Command is latency the Surface spends showing tmux's
    // padding, so the repeat must carry nothing but the resize.
    expect(transport.commands).toEqual([
      "tmux set-option -t 'main' window-size manual",
      "tmux resize-window -t 'main' -x 38 -y 14",
      "tmux resize-window -t 'main' -x 38 -y 30",
    ]);
  });

  it('sets manual sizing again for a Session it has not sized before', async () => {
    const transport = new FakeTransport();
    const client = new TmuxClient(transport);

    await client.setWindowSize('main', { cols: 38, rows: 14 });
    await client.setWindowSize('other', { cols: 38, rows: 14 });

    expect(transport.commands.filter((c) => c.includes('window-size manual'))).toEqual([
      "tmux set-option -t 'main' window-size manual",
      "tmux set-option -t 'other' window-size manual",
    ]);
  });

  it('retries manual sizing when it failed, rather than assuming it took', async () => {
    const transport = new FakeTransport({ 'window-size manual': { exitCode: 1 } });
    const client = new TmuxClient(transport);

    await client.setWindowSize('main', { cols: 38, rows: 14 });
    await client.setWindowSize('main', { cols: 38, rows: 30 });

    expect(transport.commands.filter((c) => c.includes('window-size manual'))).toHaveLength(2);
  });

  it('keeps the Session usable when the Host refuses the resize', async () => {
    const transport: TmuxTransport = {
      exec: async () => {
        throw new Error('channel closed');
      },
      openShell: async () => {
        throw new Error('not used');
      },
    };

    await expect(
      new TmuxClient(transport).setWindowSize('main', { cols: 38, rows: 14 }),
    ).resolves.toBeUndefined();
  });
});

describe('newestClient', () => {
  it('returns the tty of the most recently attached Client, which is ours', async () => {
    const transport = new FakeTransport({
      'list-clients': { stdout: '1700000000\t/dev/pts/1\n1700000009\t/dev/pts/3\n' },
    });

    await expect(new TmuxClient(transport).newestClient('main')).resolves.toBe('/dev/pts/3');
  });

  it('is undefined when the Session has no Clients', async () => {
    const transport = new FakeTransport({ 'list-clients': { stdout: '' } });

    await expect(new TmuxClient(transport).newestClient('main')).resolves.toBeUndefined();
  });

  it('is undefined when tmux will not say, rather than a failure', async () => {
    const transport = new FakeTransport({
      'list-clients': { exitCode: 1, stderr: 'no server running' },
    });

    await expect(new TmuxClient(transport).newestClient('main')).resolves.toBeUndefined();
  });

  it('skips a line it cannot read rather than returning a nonsense tty', async () => {
    const transport = new FakeTransport({
      'list-clients': { stdout: 'nonsense\n1700000009\t/dev/pts/3\n' },
    });

    await expect(new TmuxClient(transport).newestClient('main')).resolves.toBe('/dev/pts/3');
  });
});

describe('redrawClient', () => {
  it('asks the Client to repaint everything', async () => {
    const transport = new FakeTransport();

    await new TmuxClient(transport).redrawClient('/dev/pts/3');

    expect(transport.commands).toEqual(["tmux refresh-client -t '/dev/pts/3'"]);
  });

  it('keeps the Session usable when the redraw fails', async () => {
    const transport: TmuxTransport = {
      exec: async () => {
        throw new Error('channel closed');
      },
      openShell: async () => {
        throw new Error('not used');
      },
    };

    await expect(new TmuxClient(transport).redrawClient('/dev/pts/3')).resolves.toBeUndefined();
  });
});

describe('capturePanes', () => {
  it('reads several Panes in one round trip', async () => {
    const transport = new FakeTransport({
      'capture-pane': { stdout: 'one\ntwo\n@@muxify@@\nthree\n' },
    });

    const previews = await new TmuxClient(transport).capturePanes(['a:0', 'a:1']);

    expect(transport.commands).toHaveLength(1);
    expect(previews.get('a:0')).toEqual(['one', 'two']);
    expect(previews.get('a:1')).toEqual(['three']);
  });

  it('sends nothing at all for no targets', async () => {
    const transport = new FakeTransport();

    await expect(new TmuxClient(transport).capturePanes([])).resolves.toEqual(new Map());
    expect(transport.commands).toEqual([]);
  });

  it('is empty rather than broken when the capture fails', async () => {
    // A preview is worth nothing when it costs a working picker.
    const transport = new FakeTransport({ 'capture-pane': { exitCode: 1 } });

    await expect(new TmuxClient(transport).capturePanes(['a:0'])).resolves.toEqual(new Map());
  });
});

describe('setZoom', () => {
  it('zooms the active Window when it is not zoomed', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\t3\t0\tvim\n' },
    });

    await new TmuxClient(transport).setZoom('main', true);

    expect(transport.commands.some((c) => c.includes('resize-pane -Z'))).toBe(true);
  });

  it('leaves a Window that is already zoomed alone, since -Z only toggles', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\t3\t1\tvim\n' },
    });

    await new TmuxClient(transport).setZoom('main', true);

    expect(transport.commands.some((c) => c.includes('resize-pane -Z'))).toBe(false);
  });

  it('does not bother zooming a Window with a single Pane', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\t1\t0\tvim\n' },
    });

    await new TmuxClient(transport).setZoom('main', true);

    expect(transport.commands.some((c) => c.includes('resize-pane -Z'))).toBe(false);
  });

  it('unzooms when asked for no zoom', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\t3\t1\tvim\n' },
    });

    await new TmuxClient(transport).setZoom('main', false);

    expect(transport.commands.some((c) => c.includes('resize-pane -Z'))).toBe(true);
  });
});
