import { useMemo } from 'react';
import { Alert } from 'react-native';

import {
  endAlert,
  sendTmuxOrder,
  TMUX_ORDER_LABEL,
  tmuxOrderTarget,
  type TmuxOrder,
} from '@/topics/tmux-order';

import { useHostWrites } from './use-host-write';
import { alertCardWrite } from './use-card-writes';

/**
 * The Session and Window Actions a row or a picker sends, and Mark All as
 * Read, as Host Writes the way a Topic card sends its orders: one write at a
 * time for each Session or Window, and an alert for a failed or unsure end.
 * Nothing is read after the write: the Host Server pushes the Listing and the
 * Topic that show the result, which is also the check of an unsure write.
 */
export function useTmuxWrites(hostId: string, send: typeof sendTmuxOrder = sendTmuxOrder) {
  const writes = useHostWrites(hostId);
  return useMemo(() => {
    const order = async (order: TmuxOrder) => {
      const end = await writes.sendAndReport(tmuxOrderTarget(order), async ({ host, step, refuse, unsure }) => {
        const write = await send(host, order, () => step('sending'));
        if (write.kind === 'failed') refuse(write.error);
        if (write.kind === 'unknown') unsure(write.message);
      });
      if (end === undefined) return;
      alertCardWrite(TMUX_ORDER_LABEL[order.kind], end);
    };
    /** Kill Session and Close Window: a confirm alert first, and the order only on its destructive button. */
    const confirm = (end: Extract<TmuxOrder, { kind: 'kill-session' | 'close-window' }>, name: string) => {
      const alert = endAlert(end.kind, name);
      Alert.alert(alert.title, alert.message, [
        { text: alert.confirm, style: 'destructive', onPress: () => void order(end) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    };
    return { order, confirm, writing: (target: string) => writes.state(target).kind === 'running' };
  }, [writes, send]);
}
