import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { describeApp, describeDevice, deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { renderReport } from '@/diagnostics/report';
import { describeError } from '@/lib/describe-error';
import { useAttachState, useCurrentAttach } from '@/tmux/attach-context';

const say = speakingAs(deviceLog(), 'host');

/**
 * Puts the Log on the clipboard, for pasting wherever the problem is being
 * looked at. The report's head describes the Attach as it stands, so a Log
 * copied with a Session still attached says what state it was left in. See
 * ADR 0010.
 */
export function useCopyLog(): () => void {
  const attach = useCurrentAttach();
  const attachState = useAttachState(attach);

  return useCallback(() => {
    const book = deviceLog();
    say('Log copied from Settings');
    const text = renderReport(book, {
      app: describeApp(),
      device: describeDevice(),
      now: Date.now(),
      attached: attach && attachState ? { hostName: attach.hostName, state: attachState } : null,
    });
    void Clipboard.setStringAsync(text).then(
      () => {
        Alert.alert(
          'Log copied',
          `${book.entries().length} lines are on the clipboard. Paste them wherever the problem is being looked at.`,
        );
      },
      (error: unknown) => {
        Alert.alert('Could not copy the Log', describeError(error));
      },
    );
  }, [attach, attachState]);
}
