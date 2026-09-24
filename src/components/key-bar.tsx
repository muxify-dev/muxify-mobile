import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Appearance } from '@/constants/app-theme';
import type { BarKey } from '@/constants/bar-keys';
import type { Modifiers } from '@/lib/modifier-keys';

export interface KeyBarProps {
  keys: BarKey[];
  /** Which modifiers are armed, so the bar can show them held down. */
  armed: Modifiers;
  /** A key that acts. Modifiers go through `onArm` instead. */
  onPress: (key: BarKey) => void;
  /** A modifier tapped: on if it was off, off if it was on. */
  onArm: (modifier: 'ctrl' | 'alt') => void;
  disabled?: boolean;
  /**
   * The chrome colours of the Theme in use.
   *
   * The rest of the Dock is SwiftUI and takes the system tint on its own; this
   * capsule draws its own text, so it has to be told. A dark label on Mocha's
   * glass is a key nobody can read.
   */
  palette: Appearance;
}

/**
 * The Dock's first capsule: the keys a phone keyboard does not have.
 *
 * Built from React Native views over a `GlassView` rather than from SwiftUI
 * like the rest of the Dock, and that is a deliberate exception. Two of the
 * things this has to do have no SwiftUI equivalent reachable through
 * `@expo/ui`: scrolling sideways inside a capsule that is only three keys wide,
 * and drawing a key as *held* — the filled disc behind an armed ctrl. A menu
 * was tried first and is the wrong shape for this: it closes on every pick, so
 * an arrow costs a reopen each time it is pressed.
 *
 * It fills whatever width the other Dock groups leave and scrolls the rest, so
 * more keys cost nothing: they simply sit past the edge.
 */
export function KeyBar({ keys, armed, onPress, onArm, disabled, palette }: KeyBarProps) {
  const glass = isGlassEffectAPIAvailable();
  const Capsule = glass ? GlassView : View;
  /**
   * How wide the capsule turned out to be, once the Dock's other groups had
   * taken theirs.
   *
   * The keys are sized from it rather than the other way round, so that
   * exactly KEYS_ON_SCREEN of them fit with the same gap at each end. A fixed
   * key width leaves a remainder, and the remainder shows as a sliver of the
   * next key on one side and nothing on the other — which reads as a row that
   * is not centred, differently on every phone.
   */
  const [width, setWidth] = useState(0);
  const keyWidth = width > 0 ? (width - EDGE * 2) / KEYS_ON_SCREEN : 0;

  return (
    <Capsule
      style={[styles.capsule, glass ? null : styles.plainCapsule]}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      {...(glass ? { glassEffectStyle: 'regular' as const, isInteractive: true } : null)}>
      <ScrollView
        horizontal
        // The bar is a row of buttons, not a scroll view with a bar down it.
        showsHorizontalScrollIndicator={false}
        // A key half off the edge is a key nobody can read, and the natural
        // resting place of a sideways scroll is on a boundary between them.
        decelerationRate="fast"
        snapToInterval={keyWidth || undefined}
        snapToAlignment="start"
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="always">
        {keys.map((each) => {
          const held = each.modifier ? armed[each.modifier] : false;
          return (
            <Pressable
              key={each.key}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={each.spoken ?? each.label}
              accessibilityState={each.modifier ? { selected: held } : undefined}
              onPress={() => (each.modifier ? onArm(each.modifier) : onPress(each))}
              style={[styles.key, { width: keyWidth }]}>
              {/* The disc is its own view rather than a background on the
                  label, so it stays a circle whatever the label's width. */}
              {held ? (
                <View
                  style={[
                    styles.held,
                    { backgroundColor: palette.controlAccent, left: (keyWidth - DISC) / 2 },
                  ]}
                />
              ) : null}
              <Text
                style={[
                  styles.label,
                  { color: held ? palette.controlAccent : palette.toolbarTint },
                  held ? styles.heldLabel : null,
                  disabled ? styles.dim : null,
                ]}>
                {each.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Capsule>
  );
}

/**
 * How many keys are on screen at rest. The rest are a sideways swipe away.
 *
 * Three, because that is what reads as a row rather than as the fragment of
 * one, and because the keys are sized to fit exactly this many — so it is also
 * what decides how wide a key is on any given phone.
 */
const KEYS_ON_SCREEN = 3;

/** The gap at each end of the row, which is the same at both by construction. */
const EDGE = 4;

/** How tall a key is, and how wide the disc behind a held modifier is. */
const KEY_HEIGHT = 44;
const DISC = 36;

const styles = StyleSheet.create({
  capsule: {
    // Takes what the other Dock groups leave rather than a width of its own:
    // there are more keys than fit on any phone, so the bar scrolls and the
    // width is simply how many are on screen.
    flex: 1,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
  },
  plainCapsule: {
    backgroundColor: '#242838',
  },
  row: {
    alignItems: 'center',
    paddingHorizontal: EDGE,
  },
  key: {
    height: KEY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A circle, not a capsule the shape of the key: a held modifier should read
  // as a key pressed down, and a tall rounded rectangle reads as a segmented
  // control instead.
  held: {
    position: 'absolute',
    width: DISC,
    height: DISC,
    top: (KEY_HEIGHT - DISC) / 2,
    borderRadius: DISC / 2,
    opacity: 0.25,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
  },
  heldLabel: {
    fontWeight: '600',
  },
  dim: {
    opacity: 0.35,
  },
});
