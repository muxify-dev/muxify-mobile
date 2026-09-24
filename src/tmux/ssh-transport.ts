import type { SshConnection } from '@osuki-dev/react-native-ssh';

import type {
  ControlChannel,
  ControlChannelEvents,
  TmuxTransport,
} from './transport';

/**
 * Adapts a live SSH Connection to the transport seam.
 *
 * Deliberately thin — the seam was shaped to match what an SSH client already
 * offers, so this is a rename and nothing more. Everything with a decision in
 * it lives above the seam, where it is tested; this file is the part that is
 * verified by running the app.
 */
export function sshTmuxTransport(connection: SshConnection): TmuxTransport {
  return {
    async exec(command: string) {
      const { stdout, stderr, exitCode } = await connection.exec(command);
      return { stdout, stderr, exitCode };
    },

    async openControl(
      command: string,
      events: ControlChannelEvents,
    ): Promise<ControlChannel> {
      const shell = await connection.openShell(
        {
          // The empty TERM is load-bearing: it is how this library is asked
          // for a channel with no pty. A control client wants none, and asking
          // for one would put the Session's options back in play.
          term: '',
          command,
        },
        {
          onData: events.onData,
          // Without a pty the server keeps stderr separate. tmux writes its
          // own startup failures there — "no sessions", a bad path — and they
          // are the most useful thing a dead Connection has to say.
          onStderr: events.onData,
          onClosed: events.onClosed,
        },
      );

      return {
        write: (bytes) => shell.write(bytes),
        // Both halves, because either can go without the other noticing: the
        // transport can drop while the channel object still says it is open,
        // and a channel can be closed by the far end over a connection that is
        // perfectly alive. Neither flag costs a round trip.
        isOpen: () => connection.isConnected && shell.isOpen,
        close: () => shell.close(),
      };
    },
  };
}
