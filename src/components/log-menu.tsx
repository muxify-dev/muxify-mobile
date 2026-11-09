import type { ReactNode } from 'react';

import { Button, ContextMenu } from '@expo/ui/swift-ui';
import { accessibilityLabel } from '@expo/ui/swift-ui/modifiers';

/** A long press on its content offers to copy the Log. */
export function LogMenu({ onCopyLog, children }: { onCopyLog: () => void; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenu.Items>
        <Button
          label="Copy log"
          systemImage="doc.on.clipboard"
          onPress={onCopyLog}
          modifiers={[accessibilityLabel('Copy log')]}
        />
      </ContextMenu.Items>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
    </ContextMenu>
  );
}
