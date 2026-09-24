import type { SshConnection } from '@osuki-dev/react-native-ssh';

import type { TmuxShell, TmuxShellEvents, TmuxShellOptions, TmuxTransport } from './transport';

/**
 * Adapts a live SSH Connection to the transport seam.
 *
 * Deliberately thin — the seam was shaped to match what an SSH client already
 * offers, so this is a rename and nothing more. Everything with a decision in
 * it lives above the seam in TmuxClient, where it is tested; this file is the
 * part that is verified by running the app.
 */
export function sshTmuxTransport(connection: SshConnection): TmuxTransport {
  return {
    async exec(command: string) {
      const { stdout, stderr, exitCode } = await connection.exec(command);
      return { stdout, stderr, exitCode };
    },

    async openShell(options: TmuxShellOptions, events: TmuxShellEvents): Promise<TmuxShell> {
      const shell = await connection.openShell(
        {
          term: options.term,
          cols: options.cols,
          rows: options.rows,
          command: options.command,
        },
        {
          onData: events.onData,
          onClosed: events.onClosed,
        },
      );

      return {
        write: (bytes) => shell.write(bytes),
        resize: (cols, rows) => shell.resize(cols, rows),
        close: () => shell.close(),
      };
    },
  };
}
