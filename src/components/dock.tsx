import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Button, HStack, Host, Image, Overlay, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  cornerRadius,
  disabled,
  font,
  foregroundColor,
  frame,
  glassEffect,
  offset,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import type { Appearance } from '@/constants/app-theme';
import { SurfacePalette } from '@/constants/theme';

export interface DockAction {
  /** Stable id, also used as the glass effect identity within the namespace. */
  id: string;
  label: string;
  systemImage: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  /**
   * Whether what this button opens is open now; drawn in the accent, the way
   * the Key Bar shows a held modifier. For a toggle whose glyph has no natural
   * opposite — a keyboard can point down, a pencil cannot.
   */
  active?: boolean;
  /**
   * How many things are behind this button, badged on its icon.
   *
   * Only shown above one, because one is the case the badge would be answering
   * a question nobody asked: a Session with a single Window, or a Window with
   * a single Pane, is what every Session looks like until somebody splits it.
   * A number there would read as a count worth watching rather than as the
   * "there is more here than you can see" that it is.
   */
  count?: number;
}

/**
 * One of the Dock's capsules: either a row of buttons, or something else.
 *
 * The Key Bar is the something else, and it is not built from actions because
 * it is not a row of buttons: it scrolls, and some of its keys are held down
 * rather than pressed. See KeyBar for why that is React Native rather than
 * SwiftUI like the rest of this. Given whatever width the button rows leave.
 */
export type DockCapsule =
  | { id: string; actions: DockAction[] }
  | { id: string; content: ReactNode };

export interface DockProps {
  /** The capsules, left to right. Each renders as its own merged glass capsule. */
  capsules: DockCapsule[];
  /**
   * The chrome colours of the Theme in use, for the parts that do not take the
   * system tint on their own — the count badges.
   */
  palette: Appearance;
}

/**
 * The Liquid Glass bar pinned to the bottom of the Terminal Screen.
 *
 * Built from SwiftUI glass primitives rather than RN views, with the glass
 * applied once around the whole row: giving each button its own capsule makes
 * the Dock read as a chain of separate blobs, and it is one control.
 *
 * Several capsules rather than one, because the buttons are not all the same
 * kind of thing: the things the Session is made of, the keys a phone keyboard
 * lacks, and the way out. Grouping is what says so without a word of labelling.
 *
 * In that order, left to right, and the order is the point: the pickers are
 * what a hand reaches for most, the keys are the widest thing here and want the
 * middle, and the way out sits furthest from both — a Home that ends up under a
 * thumb aiming for an arrow is a Session left by accident.
 *
 * It does carry modifier keys now, which ADR 0003 ruled out. That decision
 * rested on the terminal library's own Accessory Bar above the keyboard
 * carrying ctrl, esc and tab already; the bar is turned off by a local patch
 * because it covered the Dock, and with it gone the app had no escape, no tab
 * and no arrows at all. See KeyBar and BAR_KEYS.
 */
/**
 * How far the keyboard has pushed the Dock up, in points.
 *
 * The keyboard is the only thing that moves it. This was written when the
 * terminal library's Accessory Bar was still up — an input accessory view
 * sitting over the Dock whenever the Surface was focused — and iOS reports
 * that bar's height as part of the keyboard frame, so one listener covered
 * both. The bar is turned off by a local patch now; the keyboard alone is
 * reason enough, and the reading is the same either way.
 */
function useDockLift(): number {
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
  // behind the keyboard, and the Dock sits on that instead.
  return inset > 0 ? inset + BOTTOM_GAP - dockClearance(insets.bottom) : 0;
}

/** The Dock's resting distance from the bottom of the screen. */
function dockClearance(safeAreaBottom: number): number {
  return Math.max(BOTTOM_GAP, safeAreaBottom - GLASS_PAINT_OFFSET);
}

/**
 * How much the flexible capsule is raised so the two kinds of glass line up.
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

export function Dock({ capsules, palette }: DockProps) {
  // Some iOS 26 betas ship without the underlying effect class and crash on
  // use, so probe the runtime API rather than the design-mode flag — they are
  // different checks and only this one guards the crash.
  const glassAvailable = isGlassEffectAPIAvailable();
  const insets = useSafeAreaInsets();
  const clearance = dockClearance(insets.bottom);
  const lift = useDockLift();

  return (
    // Moved in one layout step, and deliberately not smoothed. Both ways of
    // smoothing it were tried and measured at 60fps against the painted
    // frames, and both cost more than they bought. An `Animated` transform
    // moves what is painted and leaves the SwiftUI groups reporting the frames
    // they were laid out at, so the Dock ends up 270 points from where
    // VoiceOver and every e2e press believe it is. `LayoutAnimation`, curve
    // `Types.keyboard` and all, came out non-monotonic — down, up, a stall,
    // then a jump — with the capsules out of step for most of it. One layout
    // change is one frame, and all three capsules are in it.
    <View
      style={[styles.dock, { paddingBottom: clearance }, { marginBottom: lift }]}
      pointerEvents="box-none">
      {capsules.map((capsule) =>
        'content' in capsule ? (
          // Raised so it paints on the same line as the glass beside it, which
          // sits higher than it says it does. See GLASS_LIFT.
          <View key={capsule.id} style={styles.flexible}>
            {capsule.content}
          </View>
        ) : glassAvailable ? (
          <GlassGroup key={capsule.id} actions={capsule.actions} palette={palette} />
        ) : (
          <PlainGroup key={capsule.id} actions={capsule.actions} palette={palette} />
        ),
      )}
    </View>
  );
}

function GlassGroup({ actions, palette }: { actions: DockAction[]; palette: Appearance }) {
  return (
    <Host
      matchContents
      style={styles.host}
      // The reason the Dock used to arrive in pieces. A SwiftUI hosting view
      // applies the keyboard safe area by itself, so every glass group moved
      // for the keyboard *twice*: once because Muxify moved the Dock, and once
      // more because SwiftUI lifted its own content, on an animation of its
      // own. The Key Bar, being React Native, only ever moved once — measured
      // at 60fps, the two glass capsules led it by about three frames the
      // whole way and came to rest a good inch higher. Muxify is the only
      // thing that should move this bar.
      ignoreSafeArea="keyboard">
      <HStack
        spacing={0}
        modifiers={[
          // One piece of glass around the whole row, rather than one per
          // button. Per-button capsules merge into a chain of blobs; the Dock
          // is a single control and should read as one.
          padding({ horizontal: 4, vertical: 4 }),
          glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        ]}>
        {actions.map((action) => (
          <Button
            key={action.id}
            onPress={action.onPress}
            modifiers={[
              // Full tap height, but narrower than the 44pt iOS asks for: six
              // of these sit either side of the Key Bar, and at 42 wide they
              // left it room for two keys on a 402pt phone. At this width three
              // fit there, and on a 375pt phone too. See BUTTON_WIDTH.
              frame({ width: BUTTON_WIDTH, height: 44 }),
              buttonStyle('plain'),
              // Actually disabled, not merely inert: a button that looks
              // pressable and does nothing is worse than one that says so.
              disabled(action.disabled ?? false),
              // The icon is the whole label now, so the name has to be said
              // out loud somewhere: this is what the accessibility tree
              // exposes, and what every e2e suite presses by. It used to come
              // free from `Button(label, systemImage:)` under an iconOnly
              // label style — but a badge has to sit *on* the icon, and a
              // Label's icon is not something a modifier can reach inside.
              accessibilityLabel(action.label),
            ]}>
            <DockIcon action={action} palette={palette} />
          </Button>
        ))}
      </HStack>
    </Host>
  );
}

/**
 * A Dock button's icon, badged with how many things are behind it.
 *
 * The badge is the icon's overlay rather than the button's, which is what keeps
 * it from eating taps: a SwiftUI view laid over a Button answers the hit test
 * before the Button does, so a badge on the outside would have made its own
 * corner of a 42-point target dead. Inside the label it is just more label.
 */
function DockIcon({ action, palette }: { action: DockAction; palette: Appearance }) {
  const count = action.count ?? 0;
  const glyph = (
    <Image
      systemName={action.systemImage}
      size={GLYPH}
      color={action.active ? palette.controlAccent : undefined}
    />
  );
  if (count <= 1) return glyph;

  return (
    <Overlay alignment="topTrailing">
      {glyph}
      <Overlay.Content>
        <Text
          modifiers={[
            font({ size: 10, weight: 'bold' }),
            // A fixed disc rather than a capsule that grows with its number:
            // the three of these sit side by side and a badge a digit wider
            // than its neighbour reads as a different kind of thing. Two
            // digits is as far as this has to go — nobody has a hundred Panes
            // in a Window, and a Session list that long is a different problem.
            frame({ width: BADGE, height: BADGE }),
            foregroundColor('#ffffff'),
            background(palette.controlAccent),
            cornerRadius(BADGE / 2),
            // Out past the corner of the glyph, so it sits beside the icon
            // rather than on top of what the icon is trying to say.
            offset({ x: 5, y: -5 }),
          ]}>
          {String(count)}
        </Text>
      </Overlay.Content>
    </Overlay>
  );
}

/** How wide a count badge is, and — being a disc — how tall. */
const BADGE = 16;

/**
 * How wide one glass button is.
 *
 * Sized from the other end of the Dock: the Key Bar gets what the six buttons
 * leave, and it needs three keys of at least KEY_MIN_WIDTH to read as a row.
 * On a 375pt phone that is 20 of Dock padding, 16 of gaps, two capsules of
 * three buttons plus 8 of padding each, and 119 left over — three keys of 37.
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
function PlainGroup({ actions, palette }: { actions: DockAction[]; palette: Appearance }) {
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
          <ThemedText type="small" style={[styles.plainLabel, action.active && { color: palette.controlAccent }]}>
            {action.label}
          </ThemedText>
          {(action.count ?? 0) > 1 ? (
            <View style={[styles.plainBadge, { backgroundColor: palette.controlAccent }]}>
              <RNText style={styles.plainBadgeText}>{String(action.count)}</RNText>
            </View>
          ) : null}
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
    // Bottom-aligned rather than centred, so that raising the flexible capsule
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  plainLabel: {
    color: SurfacePalette.foreground,
  },
  plainBadge: {
    minWidth: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  plainBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
});
