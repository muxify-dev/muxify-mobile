import { bytesToUtf8 } from '@/lib/utf8';

import { renderControlCommand, type TmuxArgv } from './commands';
import type { CommandReply, CommandRunner } from './control-connection';
import { TmuxClient, TmuxError } from './tmux-client';

/**
 * A tmux that answers whatever the test says it does, keyed by the rendered
 * command line — so a test that gets the command wrong gets no answer, rather
 * than the answer it wanted.
 */
function fakeTmux(answers: Record<string, string[] | { error: string[] }>) {
  const asked: string[] = [];

  function reply(argv: TmuxArgv): CommandReply {
    const line = renderControlCommand(argv);
    asked.push(line);
    const answer = answers[line];
    if (answer === undefined) return replyOf(false, [`no such command in this test: ${line}`]);
    return Array.isArray(answer) ? replyOf(true, answer) : replyOf(false, answer.error);
  }

  const runner: CommandRunner = {
    run: (argv) => Promise.resolve(reply(argv)),
    runAll: (commands) => Promise.resolve(commands.map(reply)),
  };

  return { runner, asked, client: new TmuxClient(runner) };
}

function replyOf(ok: boolean, text: string[]): CommandReply {
  return { ok, lines: text.map((line) => new TextEncoder().encode(line)), text };
}

const LIST_SESSIONS = renderControlCommand([
  'list-sessions',
  '-F',
  '#{session_name}\t#{session_windows}',
]);

const listWindows = (session: string) =>
  renderControlCommand([
    'list-windows',
    '-t',
    session,
    '-F',
    '#{window_id}\t#{window_index}\t#{window_active}\t#{window_panes}' +
      '\t#{window_zoomed_flag}\t#{window_name}\t#{pane_current_command}',
  ]);

const listPanes = (session: string, window: number) =>
  renderControlCommand([
    'list-panes',
    '-t',
    `${session}:${window}`,
    '-F',
    '#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_active}' +
      '\t#{pane_current_path}\t#{window_layout}',
  ]);

describe('listing Sessions', () => {
  it('reads the name and the Window count', async () => {
    const { client } = fakeTmux({
      [LIST_SESSIONS]: ['work\t3', 'play\t1'],
    });
    expect(await client.listSessions()).toEqual([
      { name: 'work', windowCount: 3 },
      { name: 'play', windowCount: 1 },
    ]);
  });

  it('keeps a Session name that contains a tab whole', async () => {
    const { client } = fakeTmux({
      [LIST_SESSIONS]: ['my\twork\t2'],
    });
    expect(await client.listSessions()).toEqual([{ name: 'my\twork', windowCount: 2 }]);
  });

  it('reads a Host with no tmux server as no Sessions, not as a failure', async () => {
    const { client } = fakeTmux({
      [LIST_SESSIONS]: { error: ['no server running on /tmp/tmux-501/default'] },
    });
    expect(await client.listSessions()).toEqual([]);
  });

  it('reports a failure that is not about a missing server', async () => {
    const { client } = fakeTmux({
      [LIST_SESSIONS]: { error: ['tmux: command not found'] },
    });
    await expect(client.listSessions()).rejects.toThrow(TmuxError);
  });
});

describe('listing Windows and Panes', () => {
  it('reads a Window’s fields', async () => {
    const { client } = fakeTmux({
      [listWindows('work')]: ['@0\t0\t1\t2\t1\tshell\tzsh', '@1\t1\t0\t1\t0\tlogs\ttail'],
    });
    expect(await client.listWindows('work')).toEqual([
      { id: '@0', index: 0, name: 'shell', active: true, paneCount: 2, zoomed: true, command: 'zsh' },
      { id: '@1', index: 1, name: 'logs', active: false, paneCount: 1, zoomed: false, command: 'tail' },
    ]);
  });

  it('keeps tmux’s own Window handle, which is what notifications name', async () => {
    const { client } = fakeTmux({
      [listWindows('work')]: ['@7\t2\t1\t1\t0\tshell\tzsh'],
    });
    const [window] = await client.listWindows('work');
    expect(window.id).toBe('@7');
    expect(window.index).toBe(2);
  });

  it('places Panes by the Window’s layout, not by where a zoomed one is drawn', async () => {
    const layout = 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]';
    const { client } = fakeTmux({
      [listPanes('work', 0)]: [
        `0\t%0\tzsh\t1\t/home/user\t${layout}`,
        `1\t%2\tvim\t0\t/home/user/src\t${layout}`,
      ],
    });
    expect(await client.listPanes('work', 0)).toEqual([
      {
        index: 0,
        id: '%0',
        command: 'zsh',
        active: true,
        path: '/home/user',
        left: 0,
        top: 0,
        width: 80,
        height: 12,
      },
      {
        index: 1,
        id: '%2',
        command: 'vim',
        active: false,
        path: '/home/user/src',
        left: 0,
        top: 13,
        width: 80,
        height: 11,
      },
    ]);
  });

  it('keeps tmux’s own Pane handle, which is what input is aimed at', async () => {
    const { client } = fakeTmux({
      [listPanes('work', 0)]: ['0\t%17\tzsh\t1\t/home/user\tbad-layout'],
    });
    const [pane] = await client.listPanes('work', 0);
    expect(pane.id).toBe('%17');
  });

  it('reads a Session that has gone as nothing, not as a failure', async () => {
    const { client } = fakeTmux({
      [listWindows('gone')]: { error: ["can't find session: gone"] },
      [listPanes('gone', 0)]: { error: ["can't find window: gone:0"] },
    });
    expect(await client.listWindows('gone')).toEqual([]);
    expect(await client.listPanes('gone', 0)).toEqual([]);
  });
});

describe('moving the Client', () => {
  it('reports a refused move rather than doing nothing quietly', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['select-window', '-t', 'work:9'])]: {
        error: ["can't find window: work:9"],
      },
    });
    await expect(client.selectWindow('work', 9)).rejects.toThrow("can't find window");
  });

  it('switches Session', async () => {
    const { client, asked } = fakeTmux({
      [renderControlCommand(['switch-client', '-t', 'play'])]: [],
    });
    await client.switchSession('play');
    expect(asked).toEqual(["'switch-client' '-t' 'play'"]);
  });
});

describe('zoom', () => {
  const zoomed = (flag: string, panes: string) => ({
    [listWindows('work')]: [`@0\t0\t1\t${panes}\t${flag}\tshell\tzsh`],
    [renderControlCommand(['resize-pane', '-Z', '-t', 'work:'])]: [],
  });

  it('toggles only when the Window is not already the way it is wanted', async () => {
    const { client, asked } = fakeTmux(zoomed('0', '2'));
    await client.setZoom('work', true);
    expect(asked).toContain("'resize-pane' '-Z' '-t' 'work:'");
  });

  it('does nothing when the Window is already zoomed', async () => {
    const { client, asked } = fakeTmux(zoomed('1', '2'));
    await client.setZoom('work', true);
    expect(asked).not.toContain("'resize-pane' '-Z' '-t' 'work:'");
  });

  it('reads the Window for a second request only after the first one toggled it', async () => {
    const { client, asked } = fakeTmux(zoomed('0', '2'));
    await Promise.all([client.setZoom('work', true), client.setZoom('work', true)]);
    expect(asked.map((each) => each.split(' ')[0])).toEqual([
      "'list-windows'",
      "'resize-pane'",
      "'list-windows'",
      "'resize-pane'",
    ]);
  });

  it('does not spend a round trip zooming a Window with one Pane', async () => {
    const { client, asked } = fakeTmux(zoomed('0', '1'));
    await client.setZoom('work', true);
    expect(asked).not.toContain("'resize-pane' '-Z' '-t' 'work:'");
  });
});

describe('sizing the Client', () => {
  it('takes the Window and asks tmux for the size, and sets no Session option to do it', async () => {
    const { client, asked } = fakeTmux({
      [renderControlCommand(['select-window'])]: [],
      [renderControlCommand(['refresh-client', '-C', '40x20'])]: [],
    });
    await client.resizeClient({ cols: 40, rows: 20 });
    // The claim first: without it, a laptop that typed last keeps the Window
    // at its own size whatever this Client asks for. See claimWindowCommand.
    expect(asked).toEqual(["'select-window'", "'refresh-client' '-C' '40x20'"]);
    expect(asked.join(' ')).not.toContain('set-option');
  });

  it('reports a refusal rather than swallowing it', async () => {
    // The resize scheduler must not record a size it never sent.
    const { client } = fakeTmux({
      [renderControlCommand(['select-window'])]: [],
      [renderControlCommand(['refresh-client', '-C', '40x20'])]: { error: ['no client'] },
    });
    await expect(client.resizeClient({ cols: 40, rows: 20 })).rejects.toThrow(TmuxError);
  });
});

describe('typing', () => {
  it('sends bytes to the Pane they were typed at', async () => {
    const { client, asked } = fakeTmux({
      [renderControlCommand(['send-keys', '-t', '%4', '-H', '68', '69'])]: [],
    });
    await client.sendKeys('%4', Uint8Array.of(0x68, 0x69));
    expect(asked).toEqual(["'send-keys' '-t' '%4' '-H' '68' '69'"]);
  });

  it('does not spend a round trip on nothing', async () => {
    const { client, asked } = fakeTmux({});
    await client.sendKeys('%4', new Uint8Array(0));
    expect(asked).toEqual([]);
  });
});

describe('reading a Pane back', () => {
  it('returns the capture as bytes, so escape sequences survive', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['capture-pane', '-t', '%1', '-p', '-e', '-N'])]: ['[31mred'],
    });
    const [line] = await client.capturePane('%1');
    expect([...line.subarray(0, 2)]).toEqual([0x1b, 0x5b]);
  });

  it('reads an empty capture from a Pane that has gone, rather than throwing', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['capture-pane', '-t', '%9', '-p', '-e', '-N'])]: {
        error: ["can't find pane: %9"],
      },
    });
    expect(await client.capturePane('%9')).toEqual([]);
  });

  it('reads a range for a Selection: the rows to paint, their text, and their lines', async () => {
    const range = ['-S', '-1', '-E', '1'];
    const { client } = fakeTmux({
      [renderControlCommand(['display-message', '-p', '-t', '%1', '#{history_size}'])]: ['40'],
      [renderControlCommand(['capture-pane', '-t', '%1', '-p', '-e', '-N', ...range])]: [
        '\u001b[31mold\u001b[0m',
        'a long ',
        'line   ',
      ],
      [renderControlCommand(['capture-pane', '-t', '%1', '-p', '-J', ...range])]: ['old', 'a long line'],
    });

    const shot = await client.captureSelection('%1', -1, 1);

    // Line 39 is the last of 40 lines of Scrollback: one above the screen.
    expect(shot.top).toBe(39);
    expect(shot.lines).toHaveLength(3);
    expect(shot.rows(80)).toEqual([
      { line: 39, text: 'old', wraps: false },
      { line: 40, text: 'a long ', wraps: true },
      { line: 41, text: 'line', wraps: false },
    ]);
  });

  it('refuses a Selection when tmux does not answer for the Pane', async () => {
    const { client } = fakeTmux({});
    await expect(client.captureSelection('%9', 0, 23)).rejects.toThrow(/read the Pane text/);
  });

  it('reads where the cursor is and what kind of screen the Pane is showing', async () => {
    const { client } = fakeTmux({
      [renderControlCommand([
        'display-message',
        '-p',
        '-t',
        '%1',
        '#{cursor_x}\t#{cursor_y}\t#{alternate_on}\t#{history_size}' +
          '\t#{pane_width}\t#{pane_height}\t#{mouse_any_flag}\t#{cursor_flag}\t#{bracket_paste_flag}',
      ])]: ['43\t2\t1\t120\t80\t24\t1\t0\t1'],
    });
    expect(await client.paneState('%1')).toEqual({
      cursorColumn: 43,
      cursorRow: 2,
      alternate: true,
      scrollbackLines: 120,
      width: 80,
      height: 24,
      wantsMouse: true,
      cursorShown: false,
      bracketedPaste: true,
    });
  });

  it('says nothing about a Pane tmux will not describe', async () => {
    const { client } = fakeTmux({});
    expect(await client.paneState('%9')).toBeUndefined();
  });
});

describe('previews', () => {
  it('captures several Panes in one go, keyed by target', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['capture-pane', '-t', 'work:0', '-p'])]: ['first'],
      [renderControlCommand(['capture-pane', '-t', 'work:1', '-p'])]: ['second', 'lines'],
    });
    const previews = await client.capturePanes(['work:0', 'work:1']);
    expect(previews.get('work:0')).toEqual(['first']);
    expect(previews.get('work:1')).toEqual(['second', 'lines']);
  });

  it('leaves out a Pane that would not capture, rather than failing the picker', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['capture-pane', '-t', 'work:0', '-p'])]: ['first'],
      [renderControlCommand(['capture-pane', '-t', 'gone', '-p'])]: {
        error: ["can't find pane"],
      },
    });
    const previews = await client.capturePanes(['work:0', 'gone']);
    expect(previews.get('work:0')).toEqual(['first']);
    expect(previews.has('gone')).toBe(false);
  });

  it('gives up quietly when the whole batch fails', async () => {
    const runner: CommandRunner = {
      run: () => Promise.reject(new Error('gone')),
      runAll: () => Promise.reject(new Error('gone')),
    };
    expect(await new TmuxClient(runner).capturePanes(['work:0'])).toEqual(new Map());
  });
});

describe('Pane text', () => {
  it('joins the lines and drops the empty ones under the prompt', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['capture-pane', '-t', '%3', '-p', '-J'])]: ['$ echo hi', 'hi', '', '  ', ''],
    });
    expect(await client.capturePaneText('%3')).toBe('$ echo hi\nhi');
  });

  it('reports a Pane tmux cannot capture', async () => {
    const { client } = fakeTmux({
      [renderControlCommand(['capture-pane', '-t', '%9', '-p', '-J'])]: { error: ["can't find pane: %9"] },
    });
    await expect(client.capturePaneText('%9')).rejects.toBeInstanceOf(TmuxError);
  });
});

describe('nothing borrows anything', () => {
  it('has no way to set a Session option at all', () => {
    const surface = Object.getOwnPropertyNames(TmuxClient.prototype);
    expect(surface).not.toContain('setStatusLine');
    expect(surface).not.toContain('setWindowSizing');
    expect(surface).not.toContain('setMouse');
    expect(surface).not.toContain('restoreOnDetach');
  });

  it('never writes the words a borrow would need', async () => {
    const { client, asked } = fakeTmux({
      [LIST_SESSIONS]: ['work\t1'],
      [listWindows('work')]: ['@0\t0\t1\t1\t0\tshell\tzsh'],
      [renderControlCommand(['select-window'])]: [],
      [renderControlCommand(['refresh-client', '-C', '40x20'])]: [],
      [renderControlCommand(['send-keys', '-t', '%0', '-H', '61'])]: [],
    });
    await client.listSessions();
    await client.setZoom('work', true);
    await client.resizeClient({ cols: 40, rows: 20 });
    await client.sendKeys('%0', Uint8Array.of(0x61));

    const everything = asked.join('\n');
    expect(everything).not.toContain('set-option');
    expect(everything).not.toContain('set-hook');
    expect(everything).not.toContain('setw');
  });
});

describe('what a reply is made of', () => {
  it('decodes text lines as UTF-8, so a named Session survives', async () => {
    const { client } = fakeTmux({
      [LIST_SESSIONS]: ['漢字\t1'],
    });
    const [session] = await client.listSessions();
    expect(session.name).toBe('漢字');
    expect(bytesToUtf8(new TextEncoder().encode(session.name))).toBe('漢字');
  });
});
