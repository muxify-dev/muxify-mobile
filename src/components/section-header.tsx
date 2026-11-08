import { Text } from '@expo/ui/swift-ui';
import { font, foregroundColor } from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';

/** A section's title, in a grey that is actually legible on the Form's background. */
export function SectionHeader({ children, palette }: { children: string; palette: Appearance }) {
  return (
    <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundColor(palette.sectionHeader)]}>
      {children}
    </Text>
  );
}
