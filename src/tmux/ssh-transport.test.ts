import type { SshConnection } from '@osuki-dev/react-native-ssh';

import { sshTmuxTransport } from './ssh-transport';
import type { ControlChannel } from './transport';

/**
 * The one thing below the seam that is worth a test.
 *
 * `transport.ts` says the SSH half is never unit-tested, and it is right about
 * the part it is arguing with: asserting that a mock's `write` was called
 * proves nothing about whether bytes reach a terminal, and the way to find
 * that out is to run the app.
 *
 * Liveness is not that. It is a *predicate over two flags the library already
 * publishes*, and it has a wrong answer that is easy to write and impossible
 * to see: reading the channel alone says a Connection is alive when the
 * transport under it has gone, which is exactly the case the foreground check
 * exists for. The failure is a Surface that looks connected and is not.
 */
function fakeSsh(state: { connected: boolean; channelOpen: boolean }) {
  const shell = {
    write: () => {},
    close: () => Promise.resolve(),
    get isOpen() {
      return state.channelOpen;
    },
  };
  const connection = {
    get isConnected() {
      return state.connected;
    },
    openShell: () => Promise.resolve(shell),
    exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    disconnect: () => Promise.resolve(),
  };
  return connection as unknown as SshConnection;
}

async function channelOn(state: { connected: boolean; channelOpen: boolean }): Promise<ControlChannel> {
  return sshTmuxTransport(fakeSsh(state)).openControl('tmux -C attach-session -t work', {
    onData: () => {},
    onClosed: () => {},
  });
}

describe('whether the control channel is still there', () => {
  it('is open while both the Connection and the channel are', async () => {
    const channel = await channelOn({ connected: true, channelOpen: true });
    expect(channel.isOpen()).toBe(true);
  });

  it('is shut when the channel has gone, though the Connection has not', async () => {
    // The far end closed `tmux -C attach` — the Session ended — over a
    // transport that is perfectly alive.
    const state = { connected: true, channelOpen: false };
    const channel = await channelOn(state);
    expect(channel.isOpen()).toBe(false);
  });

  it('is shut when the Connection has gone, though the channel still says otherwise', async () => {
    // What a suspension does. The channel object has heard nothing and goes on
    // reporting itself open; the transport underneath is what actually went,
    // and reading only the channel is what leaves a Surface looking connected.
    const channel = await channelOn({ connected: false, channelOpen: true });
    expect(channel.isOpen()).toBe(false);
  });

  it('follows the flags as they change, rather than reading them once', async () => {
    const state = { connected: true, channelOpen: true };
    const channel = await channelOn(state);
    expect(channel.isOpen()).toBe(true);

    state.connected = false;
    expect(channel.isOpen()).toBe(false);
  });
});
