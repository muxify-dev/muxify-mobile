import { execCommandRunner } from './exec-runner';
import type { TmuxExecResult, TmuxTransport } from './transport';

function fakeShell(answer: Partial<TmuxExecResult> & { exitCode: number }) {
  const ran: string[] = [];
  const transport: TmuxTransport = {
    async exec(command) {
      ran.push(command);
      return { stdout: '', stderr: '', ...answer };
    },
    openControl: () => Promise.reject(new Error('not this path')),
  };
  return { transport, ran };
}

describe('running a command before there is a Session to attach to', () => {
  it('sends it through a shell, with the tmux binary in front', async () => {
    const { transport, ran } = fakeShell({ exitCode: 0, stdout: 'work\t3\n' });
    await execCommandRunner(transport).run(['list-sessions', '-F', '#{session_name}']);
    expect(ran).toEqual(["tmux 'list-sessions' '-F' '#{session_name}'"]);
  });

  it('uses the Host’s own tmux when it has one', async () => {
    const { transport, ran } = fakeShell({ exitCode: 0 });
    await execCommandRunner(transport, '/opt/homebrew/bin/tmux').run(['list-sessions']);
    expect(ran).toEqual(["'/opt/homebrew/bin/tmux' 'list-sessions'"]);
  });

  it('reads the output of a command that worked', async () => {
    const { transport } = fakeShell({ exitCode: 0, stdout: 'work\t3\nplay\t1\n\n' });
    const reply = await execCommandRunner(transport).run(['list-sessions']);
    expect(reply.ok).toBe(true);
    expect(reply.text).toEqual(['work\t3', 'play\t1']);
  });

  it('reads the error of a command that failed, which is where tmux explains itself', async () => {
    // "no server running" is how a Host with no tmux answers, and the caller
    // tells that from a real failure by reading it.
    const { transport } = fakeShell({
      exitCode: 1,
      stderr: 'no server running on /tmp/tmux-501/default\n',
    });
    const reply = await execCommandRunner(transport).run(['list-sessions']);
    expect(reply.ok).toBe(false);
    expect(reply.text).toEqual(['no server running on /tmp/tmux-501/default']);
  });

  it('falls back to the output when a failure said nothing on stderr', async () => {
    const { transport } = fakeShell({ exitCode: 127, stdout: 'tmux: not found' });
    const reply = await execCommandRunner(transport).run(['list-sessions']);
    expect(reply.text).toEqual(['tmux: not found']);
  });

  it('reports a channel that closed without a status as a failure', async () => {
    const { transport } = fakeShell({ exitCode: -1 });
    expect((await execCommandRunner(transport).run(['list-sessions'])).ok).toBe(false);
  });

  it('runs a batch in order, one channel each', async () => {
    const { transport, ran } = fakeShell({ exitCode: 0 });
    await execCommandRunner(transport).runAll([['list-sessions'], ['new-session', '-d']]);
    expect(ran).toEqual(["tmux 'list-sessions'", "tmux 'new-session' '-d'"]);
  });

  it('keeps the reply as bytes as well as text', async () => {
    const { transport } = fakeShell({ exitCode: 0, stdout: 'hi' });
    const reply = await execCommandRunner(transport).run(['list-sessions']);
    expect([...reply.lines[0]]).toEqual([0x68, 0x69]);
  });
});
