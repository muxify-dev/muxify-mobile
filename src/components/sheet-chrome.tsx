import { Button, HStack, Spacer, Text, ZStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  font,
  foregroundColor,
  frame,
  labelStyle,
} from '@expo/ui/swift-ui/modifiers';

import type { SheetPalette } from '@/constants/app-theme';

import { HEADER_HEIGHT } from './sheet-layout';

/**
 * Close on the left, title centred over it. The top of every sheet.
 *
 * `role="close"` rather than an xmark of our own. The glyph used to sit off
 * centre, and the reason is in the Button's own contract: `systemImage` is
 * "only used when `label` is provided", so `label=""` was still a label — an
 * empty title laid out beside the icon, pushing it off the middle of its own
 * button. The close role draws the system's circular xmark, centred, with no
 * title slot to be empty.
 *
 * The accessibility label is still set by hand: the role draws a glyph, and a
 * glyph is unreadable to anything but an eye and unpressable to the e2e suite.
 */
export function SheetHeader({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  return (
    <ZStack>
      <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{title}</Text>
      <HStack modifiers={[frame({ height: HEADER_HEIGHT })]}>
        <Button
          role="close"
          onPress={onDismiss}
          modifiers={[
            labelStyle('iconOnly'),
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            frame({ width: 34, height: 34 }),
            accessibilityLabel(`Close ${title}`),
          ]}
        />
        <Spacer />
      </HStack>
    </ZStack>
  );
}

/** A line of explanation where a sheet's content would be. */
export function SheetNote({ children, palette }: { children: string; palette: SheetPalette }) {
  return (
    <HStack>
      <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondary)]}>{children}</Text>
      <Spacer />
    </HStack>
  );
}
