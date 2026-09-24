import { Button, Host, Image } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, font, frame } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

/**
 * The square UIKit stretches a bar button's custom view to on iOS 26, and so
 * the size of the glass disc it draws behind one. Matching it keeps the glyph
 * centred in the disc instead of pinned to its leading edge.
 */
const DISC = 36;

/**
 * A navigation-bar glyph.
 *
 * Only the glyph: iOS 26 puts every bar button on glass itself, and a button
 * that brings its own comes out as two discs, one inside the other. SwiftUI
 * rather than a React Native view for the Symbol, because the size and weight
 * wanted here are a font, and SF Symbols are drawn as text.
 */
export function ToolbarGlyphButton({
  systemImage,
  label,
  tint,
  onPress,
}: {
  systemImage: SFSymbol;
  label: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Host matchContents>
      <Button
        onPress={onPress}
        modifiers={[buttonStyle('plain'), frame({ width: DISC, height: DISC }), accessibilityLabel(label)]}>
        {/* The Symbol as the whole label, rather than `systemImage` beside an
            empty title, whose width would push the disc out into a capsule.
            `title2` is the size UIKit gives a toolbar item's Symbol; a Button
            outside a real toolbar draws it at body size, a quarter smaller. */}
        <Image systemName={systemImage} color={tint} modifiers={[font({ textStyle: 'title2' })]} />
      </Button>
    </Host>
  );
}
