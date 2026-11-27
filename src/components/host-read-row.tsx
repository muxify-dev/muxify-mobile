import { Button, HStack, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import type { ReactNode } from 'react';
import { accessibilityLabel, disabled, foregroundColor, listRowBackground } from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';
import type { HostReadHandle } from '@/hooks/use-host-read';

export const TRYING_AGAIN = 'Trying again…';

/**
 * A Host Read, above what it reads: a spinner and what runs, the reason with
 * Try again, or both while Try again runs. Nothing while there is nothing to
 * report. It shows in the render of the tap, so the user sees at once that
 * the phone heard it.
 */
export function HostReadRow({
  read,
  doing,
  palette,
  header,
  hostProblemShown = false,
}: {
  read: Pick<HostReadHandle<unknown, unknown>, 'isPending' | 'error' | 'retry'>;
  /** What runs, such as "Reading Go to". */
  doing: string;
  palette: Appearance;
  header?: ReactNode;
  /** The screen shows the Host Problem in its own place, with its own Try again, so this row does not. */
  hostProblemShown?: boolean;
}) {
  const error = read.error;
  const reason = error === null || (error.hostProblem && hostProblemShown) ? null : error.reason;
  if (!read.isPending && reason === null) return null;
  const secondary = [foregroundColor(palette.secondaryLabel)];
  return (
    <Section header={header} modifiers={[listRowBackground(palette.rowSurface)]}>
      {read.isPending ? (
        <HStack spacing={10}>
          <ProgressView />
          <Text modifiers={[...secondary, accessibilityLabel(reason === null ? doing : 'Trying again')]}>
            {reason === null ? `${doing}…` : TRYING_AGAIN}
          </Text>
        </HStack>
      ) : null}
      {reason === null ? null : (
        <>
          <Text modifiers={[foregroundColor(palette.destructive)]}>{reason}</Text>
          <Button
            label="Try again"
            onPress={read.retry}
            modifiers={[disabled(read.isPending), accessibilityLabel(read.isPending ? 'Try again, in progress' : 'Try again')]}
          />
        </>
      )}
    </Section>
  );
}
