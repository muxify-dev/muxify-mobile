import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Button, HStack, Host, Image } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  frame,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';

/** One glass button of the Key Row's fixed group. */
export interface KeyRowButton {
  id: string;
  label: string;
  systemImage: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
}

export interface KeyRowProps {
  /** The middle: the Key Bar, which takes whatever width the buttons leave. */
  children: ReactNode;
  /** The fixed group at the right, left to right. */
  right: KeyRowButton[];
}

/**
 * The glass row pinned to the bottom of the Terminal Screen, riding the
 * keyboard: the Key Bar in the middle and a fixed group of buttons at the
 * right.
 *
 * Two capsules rather than one, because they are not the same kind of thing:
 * the keys a phone keyboard lacks, and the two things done to the screen
 * itself, the Panes picker and the keyboard. The Key Bar is React Native (see
 * KeyBar for why) and the buttons are SwiftUI glass, so the two paint on
 * different lines unless the Key Bar is raised; see GLASS_LIFT.
 */
export function KeyRow({ children, right }: KeyRowProps) {
  // Some iOS 26 betas ship without the underlying effect class and crash on
  // use, so probe the runtime API rather than the design-mode flag — they are
  // different checks and only this one guards the crash.
  const glassAvailable = isGlassEffectAPIAvailable();
  const insets = useSafeAreaInsets();
  const clearance = rowClearance(insets.bottom);
  const lift = useKeyboardLift();

  return (
    // Moved in one layout step, and deliberately not smoothed. Both ways of
    // smoothing it were tried and measured at 60fps against the painted
    // frames, and both cost more than they bought. An `Animated` transform
    // moves what is painted and leaves the SwiftUI groups reporting the frames
    // they were laid out at, so the row ends up 270 points from where
    // VoiceOver and every e2e press believe it is. `LayoutAnimation`, curve
    // `Types.keyboard` and all, came out non-monotonic — down, up, a stall,
    // then a jump — with the capsules out of step for most of it. One layout
    // change is one frame, and both capsules are in it.
    <View
      style={[styles.row, { paddingBottom: clearance }, { marginBottom: lift }]}
      pointerEvents="box-none">
      {/* Raised so it paints on the same line as the glass beside it, which
          sits higher than it says it does. See GLASS_LIFT. */}
      <View style={styles.flexible}>{children}</View>
      {glassAvailable ? <GlassGroup buttons={right} /> : <PlainGroup buttons={right} />}
    </View>
  );
}

/**
 * How far the keyboard has pushed the row up, in points.
 *
 * The keyboard is the only thing that moves it. This was written when the
 * terminal library's Accessory Bar was still up — an input accessory view
 * sitting over the row whenever the Surface was focused — and iOS reports
 * that bar's height as part of the keyboard frame, so one listener covered
 * both. The bar is turned off by a local patch now; the keyboard alone is
 * reason enough, and the reading is the same either way.
 */
function useKeyboardLift(): number {
  const insets = useSafeAreaInsets();
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      setInset(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Above the home indicator, not over it — measured from where the glass
  // lands rather than from the box it reports, which is why the paint offset
  // comes off here. With the keyboard up there is no indicator to clear: it is
  // behind the keyboard, and the row sits on that instead.
  return inset > 0 ? inset + BOTTOM_GAP - rowClearance(insets.bottom) : 0;
}

/** The row's resting distance from the bottom of the screen. */
function rowClearance(safeAreaBottom: number): number {
  return Math.max(BOTTOM_GAP, safeAreaBottom - GLASS_PAINT_OFFSET);
}

/**
 * How much the Key Bar is raised so the two kinds of glass line up.
 *
 * Measured on an iPhone 17 Pro by reading the painted edges out of a
 * screenshot and comparing them with the frames the accessibility tree
 * reports: a SwiftUI `Host matchContents` group paints about three points
 * *above* the box it reports, and the Key Bar, being React Native, paints
 * exactly on its own. Left alone, the two sit visibly out of line.
 */
const GLASS_LIFT = 2;

/**
 * How far above its reported box the SwiftUI glass actually paints.
 *
 * What the row's clearance from the bottom of the screen is measured against,
 * because what has to stay off the home indicator is where the glass lands
 * rather than where it claims to be.
 */
const GLASS_PAINT_OFFSET = 3;

function GlassGroup({ buttons }: { buttons: KeyRowButton[] }) {
  return (
    <Host
      matchContents
      style={styles.host}
      // A SwiftUI hosting view applies the keyboard safe area by itself, so
      // the glass group would move for the keyboard *twice*: once because
      // Muxify moved the row, and once more because SwiftUI lifted its own
      // content, on an animation of its own. The Key Bar, being React Native,
      // only ever moved once — measured at 60fps, the glass led it by about
      // three frames the whole way and came to rest a good inch higher.
      // Muxify is the only thing that should move this row.
      ignoreSafeArea="keyboard">
      <HStack
        spacing={0}
        modifiers={[
          // One piece of glass around the group, rather than one per button:
          // per-button capsules merge into a chain of blobs.
          padding({ horizontal: 4, vertical: 4 }),
          glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        ]}>
        {buttons.map((button) => (
          <Button
            key={button.id}
            onPress={button.onPress}
            modifiers={[
              frame({ width: BUTTON_WIDTH, height: 44 }),
              buttonStyle('plain'),
              // Actually disabled, not merely inert: a button that looks
              // pressable and does nothing is worse than one that says so.
              disabled(button.disabled ?? false),
              // The icon is the whole label, so the name has to be said out
              // loud somewhere: this is what the accessibility tree exposes,
              // and what every e2e suite presses by.
              accessibilityLabel(button.label),
            ]}>
            <Image systemName={button.systemImage} size={GLYPH} />
          </Button>
        ))}
      </HStack>
    </Host>
  );
}

/**
 * How wide one glass button is.
 *
 * Sized from the other end of the row: the Key Bar gets what the buttons
 * leave, and it needs three keys of at least KEY_MIN_WIDTH to read as a row.
 */
const BUTTON_WIDTH = 34;

/** The glyph's point size: the body size less two, to sit inside BUTTON_WIDTH. */
const GLYPH = 15;

/**
 * Fallback for a device whose runtime lacks the glass API. Every target device
 * for this project is iOS 26.4+, so this exists only to keep such a device
 * usable rather than transparent — a GlassView on an unsupported runtime mounts
 * and renders nothing at all.
 */
function PlainGroup({ buttons }: { buttons: KeyRowButton[] }) {
  return (
    <View style={styles.plainGroup}>
      {buttons.map((button) => (
        <Pressable
          key={button.id}
          onPress={button.onPress}
          disabled={button.disabled}
          accessibilityRole="button"
          accessibilityLabel={button.label}
          style={styles.plainButton}>
          <ThemedText type="small" style={styles.plainLabel}>
            {button.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/** The least clearance under the row, when there is no home indicator to clear. */
const BOTTOM_GAP = 8;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    // Bottom-aligned rather than centred, so that raising the Key Bar by
    // GLASS_LIFT moves *it* and nothing else.
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    // Clearance above the capsule as well as below it. A glass group is a
    // `Host matchContents`, and the glass is drawn a little larger than the
    // content it is measured from — so without this the capsule reaches up
    // over the Surface's last row and covers whatever the Pane put there.
    paddingTop: 10,
  },
  flexible: {
    flex: 1,
    // A row, because the capsule inside sizes itself along the main axis and a
    // column would read its `flex` as a height instead — which squashed it to
    // three quarters of its height.
    flexDirection: 'row',
    marginBottom: GLASS_LIFT,
  },
  host: {
    alignSelf: 'center',
  },
  plainGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: '#242838',
  },
  plainButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  plainLabel: {
    color: SurfacePalette.foreground,
  },
});
