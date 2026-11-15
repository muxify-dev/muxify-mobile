import { useEffect, useState } from 'react';

import { Button, HStack, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, foregroundColor, listRowBackground } from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';
import { hostWriteLine, type HostWrite, type HostWriteWords } from '@/domain/host-write';

/**
 * A sheet's Host Write, at the top of its form: a spinner and what runs, the
 * reason and Retry when it failed, or Check when the Host did not answer.
 * Nothing while there is nothing to report.
 */
export function HostWriteRow({
  write,
  words,
  palette,
  onRetry,
  retryLabel = 'Retry',
  onCheck,
}: {
  write: HostWrite;
  words: HostWriteWords;
  palette: Appearance;
  onRetry: () => void;
  retryLabel?: string;
  onCheck: () => void;
}) {
  const now = useSecondTick(write.kind === 'running');
  const line = hostWriteLine(write, words, now);
  if (line === null) return null;
  return (
    <Section modifiers={[listRowBackground(palette.rowSurface)]}>
      <HStack spacing={10}>
        {write.kind === 'running' ? <ProgressView /> : null}
        <Text
          modifiers={[
            foregroundColor(write.kind === 'failed' ? palette.destructive : palette.secondaryLabel),
            accessibilityLabel(line),
          ]}>
          {line}
        </Text>
      </HStack>
      {write.kind === 'failed' ? <Button label={retryLabel} onPress={onRetry} /> : null}
      {write.kind === 'unsure' ? <Button label="Check" onPress={onCheck} /> : null}
    </Section>
  );
}

/** The time now, renewed each second while `ticking`, so the elapsed seconds count up. */
function useSecondTick(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}
