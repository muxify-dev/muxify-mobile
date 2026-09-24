import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Button, HStack, Host } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled,
  frame,
  glassEffect,
  labelStyle,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';

export interface DockAction {
  /** Stable id, also used as the glass effect identity within the namespace. */
  id: string;
  label: string;
  systemImage: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
}

export interface DockProps {
  /** Each group renders as its own merged glass capsule. */
  groups: DockAction[][];
  /**
   * A capsule of its own, before the groups, given whatever width they leave.
   *
   * The Key Bar, in practice — which is not built from these actions because it
   * is not a row of buttons: it scrolls, and some of its keys are held down
   * rather than pressed. See KeyBar for why that is React Native rather than
   * SwiftUI like the rest of this.
   */
  leading?: ReactNode;
}

/**
 * The Liquid Glass bar pinned to the bottom of the Terminal Screen.
 *
 * Built from SwiftUI glass primitives rather than RN views, with the glass
 * applied once around the whole row: giving each button its own capsule makes
 * the Dock read as a chain of separate blobs, and it is one control.
 *
 * Several capsules rather than one, because the buttons are not all the same
 * kind of thing: the keys a phone keyboard lacks, the things the Session is
 * made of, and the way out. Grouping is what says so without a word of
 * labelling.
 *
 * It does carry modifier keys now, which ADR 0003 ruled out. That decision
 * rested on the terminal library's own Accessory Bar above the keyboard
 * carrying ctrl, esc and tab already; the bar is turned off by a local patch
 * because it covered the Dock, and with it gone the app had no escape, no tab
 * and no arrows at all. They live in `leading`. See KeyBar and BAR_KEYS.
 */
/**
 * Height the Dock must clear to stay tappable.
 *
 * The system keyboard, and nothing else. This was written when the terminal
 * library's Accessory Bar was still up — an input accessory view sitting over
 * the Dock whenever the Surface was focused — and iOS reports that bar's
 * height as part of the keyboard frame, so one listener covered both. The bar
 * is turned off by a local patch now; the keyboard alone is reason enough, and
 * the reading is the same either way.
 */
function useKeyboardInset(): number {
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

  return inset;
}

/**
 * How much the leading capsule is raised so the two kinds of glass line up.
 *
 * Measured on an iPhone 17 Pro by reading the painted edges out of a
 * screenshot and comparing them with the frames the accessibility tree
 * reports: a SwiftUI `Host matchContents` group paints about three points
 * *above* the box it reports, and the Key Bar, being React Native, paints
 * exactly on its own. Left alone, the two sit visibly out of line.
 *
 */
const GLASS_LIFT = 2;

/**
 * How far above its reported box the SwiftUI glass actually paints.
 *
 * What the Dock's clearance from the bottom of the screen is measured against,
 * because what has to stay off the home indicator is where the glass lands
 * rather than where it claims to be.
 */
const GLASS_PAINT_OFFSET = 3;

export function Dock({ groups, leading }: DockProps) {
  // Some iOS 26 betas ship without the underlying effect class and crash on
  // use, so probe the runtime API rather than the design-mode flag — they are
  // different checks and only this one guards the crash.
  const glassAvailable = isGlassEffectAPIAvailable();
  const keyboardInset = useKeyboardInset();
  const insets = useSafeAreaInsets();

  // Above the home indicator, not over it — measured from where the glass
  // lands rather than from the box it reports, which is why the lift comes off
  // again here. With the keyboard up there is no indicator to clear: it is
  // behind the keyboard, and the Dock sits on that instead.
  const bottom =
    keyboardInset > 0 ? BOTTOM_GAP : Math.max(BOTTOM_GAP, insets.bottom - GLASS_PAINT_OFFSET);

  return (
    <View
      style={[
        styles.dock,
        { paddingBottom: bottom },
        keyboardInset > 0 && { marginBottom: keyboardInset },
      ]}
      pointerEvents="box-none">
      {/* Raised so it paints on the same line as the glass beside it, which
          sits higher than it says it does. See GLASS_LIFT. */}
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      {groups.map((group, index) =>
        glassAvailable ? (
          <GlassGroup key={group[0]?.id ?? index} actions={group} />
        ) : (
          <PlainGroup key={group[0]?.id ?? index} actions={group} />
        ),
      )}
    </View>
  );
}

function GlassGroup({ actions }: { actions: DockAction[] }) {
  return (
    <Host matchContents style={styles.host}>
      <HStack
        spacing={0}
        modifiers={[
          // One piece of glass around the whole row, rather than one per
          // button. Per-button capsules merge into a chain of blobs; the Dock
          // is a single control and should read as one.
          padding({ horizontal: 6, vertical: 4 }),
          glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        ]}>
        {actions.map((action) => (
          <Button
            key={action.id}
            label={action.label}
            systemImage={action.systemImage}
            onPress={action.onPress}
            modifiers={[
              // 44pt is the smallest reliably tappable target on iOS, and also
              // as tight as the buttons can sit without the row reading as one
              // smudge.
              frame({ width: 42, height: 44 }),
              buttonStyle('plain'),
              // Icon only, but the label stays: it is what the accessibility
              // tree exposes, and what every e2e suite presses by.
              labelStyle('iconOnly'),
              // Actually disabled, not merely inert: a button that looks
              // pressable and does nothing is worse than one that says so.
              disabled(action.disabled ?? false),
            ]}
          />
        ))}
      </HStack>
    </Host>
  );
}

/**
 * Fallback for a device whose runtime lacks the glass API. Every target device
 * for this project is iOS 26.4+, so this exists only to keep such a device
 * usable rather than transparent — a GlassView on an unsupported runtime mounts
 * and renders nothing at all.
 */
function PlainGroup({ actions }: { actions: DockAction[] }) {
  return (
    <View style={styles.plainGroup}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={styles.plainButton}>
          <ThemedText type="small" style={styles.plainLabel}>
            {action.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/** The least clearance under the Dock, when there is no home indicator to clear. */
const BOTTOM_GAP = 8;

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    justifyContent: 'center',
    // Bottom-aligned rather than centred, so that raising the leading capsule
    // by GLASS_LIFT moves *it* and nothing else. Centred, the taller row it
    // made pushed the other capsules down by half as much again, and the two
    // chased each other a point at a time.
    alignItems: 'flex-end',
    // Tight, because the Key Bar gets whatever these leave and three keys is
    // the least that reads as a row rather than as a fragment of one.
    gap: 8,
    paddingHorizontal: 10,
    // Clearance above the capsule as well as below it. A glass group is a
    // `Host matchContents`, and the glass is drawn a little larger than the
    // content it is measured from — so without this the capsule reaches up
    // over the Surface's last row and covers whatever the Pane put there.
    paddingTop: 10,
  },
  leading: {
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
