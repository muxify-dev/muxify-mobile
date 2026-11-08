import { HStack, Image } from '@expo/ui/swift-ui';
import { accessibilityLabel } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import type { Appearance } from '@/constants/app-theme';
import type { TagMark } from '@/domain/host-screen';
import type { Mark } from '@/topics/environment';

/** One SF Symbol for the one mark a card, Session or Window has, in the colour that says how urgent it is. */
export function MarkImage({ mark, palette }: { mark: Mark; palette: Appearance }) {
  const { symbol, color } = MARKS[mark](palette);
  return <Image systemName={symbol} size={17} color={color} />;
}

/** A Topic's Tags as small squares in the Tag colours, as the Mac's Tag Marks are. */
export function TagMarks({ tags, palette }: { tags: TagMark[]; palette: Appearance }) {
  return (
    <HStack spacing={3} modifiers={[accessibilityLabel(tags.map((tag) => `#${tag.name}`).join(' '))]}>
      {tags.map((tag) => (
        <Image
          key={tag.name}
          systemName={tag.color === null ? 'square.dashed' : 'square.fill'}
          size={11}
          color={tag.color ?? palette.secondaryLabel}
        />
      ))}
    </HStack>
  );
}

const MARKS: Record<Mark, (palette: Appearance) => { symbol: SFSymbol; color: string }> = {
  blocked: (palette) => ({ symbol: 'hand.raised.fill', color: palette.destructive }),
  failed: (palette) => ({ symbol: 'xmark.octagon.fill', color: palette.destructive }),
  unread: (palette) => ({ symbol: 'circle.fill', color: palette.controlAccent }),
  done: (palette) => ({ symbol: 'checkmark.circle.fill', color: palette.secondaryLabel }),
  working: (palette) => ({ symbol: 'arrow.triangle.2.circlepath', color: palette.secondaryLabel }),
};
