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
  it('returns one Session per line', async () => {
    const transport = new FakeTransport({ 'list-sessions': { stdout: 'main\nwork\n0\n' } });
    await expect(new TmuxClient(transport).listSessions()).resolves.toEqual(['main', 'work', '0']);
  });

  it('ignores blank lines and trailing whitespace', async () => {
    const transport = new FakeTransport({ 'list-sessions': { stdout: '  main  \n\n\nwork\n\n' } });
    await expect(new TmuxClient(transport).listSessions()).resolves.toEqual(['main', 'work']);
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
  it('parses index, name and active flag', async () => {
    const transport = new FakeTransport({
      'list-windows': { stdout: '0\tbash\t1\n1\teditor\t0\n' },
    });
    await expect(new TmuxClient(transport).listWindows('main')).resolves.toEqual([
      { index: 0, name: 'bash', active: true },
      { index: 1, name: 'editor', active: false },
    ]);
  });

  it('keeps a Window name containing spaces and colons intact', async () => {
    const transport = new FakeTransport({ 'list-windows': { stdout: '2\tvim: src/app.ts\t0\n' } });
    const [window] = await new TmuxClient(transport).listWindows('main');
    expect(window.name).toBe('vim: src/app.ts');
  });

  it('returns an empty list when the Session has no Windows', async () => {
    const transport = new FakeTransport({ 'list-windows': { stdout: '' } });
    await expect(new TmuxClient(transport).listWindows('main')).resolves.toEqual([]);
  });

  it('skips a malformed line rather than failing the whole read', async () => {
    const transport = new FakeTransport({ 'list-windows': { stdout: '0\tbash\t1\ngarbage\n' } });
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
  it('parses index, running command and active flag', async () => {
    const transport = new FakeTransport({ 'list-panes': { stdout: '0\tbash\t0\n1\tvim\t1\n' } });
    await expect(new TmuxClient(transport).listPanes('main', 1)).resolves.toEqual([
      { index: 0, command: 'bash', active: false },
      { index: 1, command: 'vim', active: true },
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
