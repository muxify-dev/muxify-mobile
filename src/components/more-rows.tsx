import { HStack, ProgressView, Section } from '@expo/ui/swift-ui';
import { accessibilityLabel, frame, listRowBackground, onAppear } from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';

/**
 * The row at the end of a list that has more rows than it mounts. When it
 * appears, as the user scrolls to it, the list mounts the next screenful.
 */
export function MoreRows({ onAppear: appeared, palette }: { onAppear: () => void; palette: Appearance }) {
  return (
    <Section modifiers={[listRowBackground(palette.rowSurface)]}>
      <HStack modifiers={[frame({ maxWidth: 3000 }), onAppear(appeared), accessibilityLabel('More rows')]}>
        <ProgressView />
      </HStack>
    </Section>
  );
}
