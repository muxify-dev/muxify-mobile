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
   * capsule draws its own text, so it has to be told. A dark label on Dracula's
   * glass is a key nobody can read.
   */
  palette: Appearance;
}

/**
 * The Dock's middle capsule: the keys a phone keyboard does not have.
 *
 * Built from React Native views over a `GlassView` rather than from SwiftUI
 * like the rest of the Dock, and that is a deliberate exception. Two of the
 * things this has to do have no SwiftUI equivalent reachable through
 * `@expo/ui`: scrolling sideways inside a capsule that is only three keys wide,
 * and drawing a key as *held* — the filled disc behind an armed ctrl. A menu
 * was tried first and is the wrong shape for this: it closes on every pick, so
 * an arrow costs a reopen each time it is pressed.
 *
 * It fills whatever width the pickers on its left and the way out on its right
 * leave, and scrolls the rest — so more keys cost nothing: they simply sit past
 * the edge.
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
  const visibleKeys = Math.max(1, Math.min(KEYS_ON_SCREEN, Math.floor((width - EDGE * 2) / KEY_MIN_WIDTH)));
  const keyWidth = width > 0 ? (width - EDGE * 2) / visibleKeys : 0;

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
                // Every key is the same width, so the label is what gives.
                // `pgup`, `pgdn` and `home` are four characters in the space
                // an arrow leaves — they fit at 15pt on an iPhone 17 Pro with
                // little to spare, and a narrower phone or a wider Dock group
                // would take that away. Shrinking the few that need it keeps
                // the row a row: a key wider than its neighbours reads as a
                // different kind of key. The phone's text size is left out of
                // it for the same reason — it would resize a fixed-width key's
                // label without resizing the key.
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={MIN_LABEL_SCALE}
                allowFontScaling={false}
                style={[
                  styles.label,
                  { width: keyWidth || undefined },
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

/**
 * The narrowest a key may be before the bar shows one fewer of them.
 *
 * Narrower than a finger wants, but a key is only as wide as the bar allows
 * and the bar only as wide as the Dock's buttons leave it — see BUTTON_WIDTH in
 * dock.tsx, which is chosen so that three keys of this width fit on the
 * narrowest phone. The labels already shrink to fit, so a four-letter label
 * still reads at this width.
 */
const KEY_MIN_WIDTH = 36;

/** The gap at each end of the row, which is the same at both by construction. */
const EDGE = 4;

/** How tall a key is, and how wide the disc behind a held modifier is. */
const KEY_HEIGHT = 44;
const DISC = 36;

/**
 * How far a label may shrink to stay on one line inside a key's fixed width.
 *
 * A floor rather than a target: the four-letter labels fit unshrunk on the
 * phones measured so far, and this is what keeps them on one line on a narrower
 * one. Much below it and a `pgdn` stops matching the arrows beside it at a
 * glance, which is the thing the fixed width exists to protect.
 */
const MIN_LABEL_SCALE = 0.7;

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
    // Centred rather than laid out by the Pressable, because the label is
    // given the key's whole width: it is what `adjustsFontSizeToFit` measures
    // against, and a label with no width of its own has nothing to shrink to.
    textAlign: 'center',
  },
  heldLabel: {
    fontWeight: '600',
  },
  dim: {
    opacity: 0.35,
  },
});
