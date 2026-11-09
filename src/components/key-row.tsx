import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import type { Appearance } from '@/constants/app-theme';
import {
  ARROW_KEYS,
  COMMAND_KEY,
  LEFT_KEYS,
  PAIR_KEYS,
  type ModifierKey,
  type NamedKey,
  type PairKey,
} from '@/constants/row-keys';
import type { Modifier, Modifiers } from '@/lib/modifier-keys';

export interface KeyRowProps {
  /** Which modifiers are armed, so the row can show them held down. */
  armed: Modifiers;
  /** A modifier tapped: on if it was off, off if it was on. */
  onArm: (modifier: Modifier) => void;
  /** Escape, tab or an arrow. */
  onKey: (key: NamedKey) => void;
  /** One symbol of a pair: the top one on a tap, the bottom one on a drag down. */
  onSymbol: (symbol: string) => void;
  onPanes: () => void;
  onKeyboard: () => void;
  /** Which way the Keyboard button points. */
  keyboardVisible: boolean;
  /** Not connected, or the Composer has the keyboard: no key can reach a Pane. */
  keysDisabled: boolean;
  panesDisabled: boolean;
  /** The chrome colours of the Theme in use: the row draws its own labels. */
  palette: Appearance;
}

/**
 * The glass row pinned to the bottom of the Terminal Screen, riding the
 * keyboard: the keys a phone keyboard lacks, in three capsules.
 *
 * All of it is React Native over `GlassView`. Each group has a sticky key
 * that must draw as *held*, and the middle scrolls sideways inside a capsule;
 * neither has a SwiftUI equivalent reachable through `@expo/ui`. One kind of
 * view also means the three capsules paint where they report, on one line.
 */
export function KeyRow(props: KeyRowProps) {
  const { armed, onArm, onKey, onSymbol, keysDisabled, palette } = props;
  const insets = useSafeAreaInsets();
  const clearance = rowClearance(insets.bottom);
  const lift = useKeyboardLift();
  const [bubble, setBubble] = useState<Bubble | null>(null);

  const fixedKey = (each: ModifierKey | NamedKey) =>
    each.kind === 'modifier' ? (
      <FixedKey
        key={each.spoken}
        label={each.spoken}
        held={armed[each.modifier]}
        disabled={keysDisabled}
        palette={palette}
        onPress={() => onArm(each.modifier)}>
        {each.label}
      </FixedKey>
    ) : (
      <FixedKey
        key={each.spoken}
        label={each.spoken}
        disabled={keysDisabled}
        palette={palette}
        onPress={() => onKey(each)}>
        {each.label}
      </FixedKey>
    );

  const arrow = (each: NamedKey, style: ViewStyle) => (
    <Pressable
      disabled={keysDisabled}
      accessibilityRole="button"
      accessibilityLabel={each.spoken}
      onPress={() => onKey(each)}
      style={[styles.arrow, style]}>
      <Text
        allowFontScaling={false}
        style={[styles.arrowLabel, { color: palette.toolbarTint }, keysDisabled ? styles.dim : null]}>
        {each.label}
      </Text>
    </Pressable>
  );

  return (
    // Moved in one layout step, and deliberately not smoothed. Both ways of
    // smoothing it were tried and measured at 60fps against the painted
    // frames, and both cost more than they bought: an `Animated` transform
    // moves what is painted and not the frames VoiceOver and every e2e press
    // go by, and `LayoutAnimation` came out non-monotonic.
    <View
      style={[styles.row, { paddingBottom: clearance }, { marginBottom: lift }]}
      pointerEvents="box-none">
      <Capsule>{LEFT_KEYS.map(fixedKey)}</Capsule>
      <PairStrip disabled={keysDisabled} palette={palette} onSymbol={onSymbol} onBubble={setBubble} />
      <Capsule>
        <View style={styles.arrows}>
          {arrow(ARROW_KEYS.up, styles.arrowUp)}
          <View style={styles.arrowsBottom}>
            {arrow(ARROW_KEYS.left, styles.arrowBelow)}
            {arrow(ARROW_KEYS.down, styles.arrowBelow)}
            {arrow(ARROW_KEYS.right, styles.arrowBelow)}
          </View>
        </View>
        <FixedKey
          label="Panes"
          disabled={props.panesDisabled}
          palette={palette}
          onPress={props.onPanes}
          symbol="square.grid.2x2"
        />
        {fixedKey(COMMAND_KEY)}
        <FixedKey
          label="Keyboard"
          palette={palette}
          onPress={props.onKeyboard}
          symbol={props.keyboardVisible ? 'keyboard.chevron.compact.down' : 'keyboard'}
        />
      </Capsule>
      {bubble ? (
        <View
          pointerEvents="none"
          style={[
            styles.bubble,
            {
              left: bubble.center - BUBBLE_WIDTH / 2,
              bottom: clearance + CAPSULE_HEIGHT + 6,
              backgroundColor: palette.rowSurface,
              borderColor: palette.separator,
            },
          ]}>
          <Text allowFontScaling={false} style={[styles.bubbleLabel, { color: palette.toolbarTint }]}>
            {bubble.symbol}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The symbol a pair key will type on release, and where its key is across the row. */
interface Bubble {
  symbol: string;
  center: number;
}

function Capsule({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  // Some iOS 26 betas ship without the underlying effect class and crash on
  // use, so probe the runtime API rather than the design-mode flag. A
  // GlassView on such a runtime renders nothing at all, hence the plain view.
  return isGlassEffectAPIAvailable() ? (
    <GlassView style={[styles.capsule, style]} glassEffectStyle="regular" isInteractive>
      {children}
    </GlassView>
  ) : (
    <View style={[styles.capsule, styles.plainCapsule, style]}>{children}</View>
  );
}

function FixedKey({
  label,
  held = false,
  disabled = false,
  palette,
  onPress,
  symbol,
  children,
}: {
  /** What the accessibility tree says, and what every e2e suite presses by. */
  label: string;
  held?: boolean;
  disabled?: boolean;
  palette: Appearance;
  onPress: () => void;
  symbol?: SFSymbol;
  children?: string;
}) {
  const color = held ? palette.controlAccent : palette.toolbarTint;
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: held, disabled }}
      onPress={onPress}
      style={[styles.key, disabled ? styles.dim : null]}>
      {/* A circle, not a capsule the shape of the key: a held modifier should
          read as a key pressed down, and a tall rounded rectangle reads as a
          segmented control instead. */}
      {held ? <View style={[styles.held, { backgroundColor: palette.controlAccent }]} /> : null}
      {symbol ? (
        <SymbolView name={symbol} size={18} tintColor={color} />
      ) : (
        <Text allowFontScaling={false} style={[styles.keyLabel, { color }]}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The middle capsule: the pairs, scrolling sideways.
 *
 * It takes the width the fixed groups leave and sizes the pairs from it, so
 * that a whole number of them fit with the same gap at each end. A fixed pair
 * width leaves a remainder, which shows as a sliver of the next key.
 */
function PairStrip({
  disabled,
  palette,
  onSymbol,
  onBubble,
}: {
  disabled: boolean;
  palette: Appearance;
  onSymbol: (symbol: string) => void;
  onBubble: (bubble: Bubble | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const visible = Math.max(1, Math.floor((width - EDGE * 2) / PAIR_MIN_WIDTH));
  const pairWidth = width > 0 ? (width - EDGE * 2) / visible : 0;

  return (
    <Capsule style={styles.strip}>
      <ScrollView
        horizontal
        style={styles.pairsScroll}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
        showsHorizontalScrollIndicator={false}
        // A key half off the edge is a key nobody can read, and the natural
        // resting place of a sideways scroll is on a boundary between them.
        decelerationRate="fast"
        snapToInterval={pairWidth || undefined}
        snapToAlignment="start"
        contentContainerStyle={styles.pairs}
        keyboardShouldPersistTaps="always">
        {PAIR_KEYS.map((pair) => (
          <PairKeyView
            key={pair.spoken}
            pair={pair}
            width={pairWidth}
            disabled={disabled}
            palette={palette}
            onSymbol={onSymbol}
            onBubble={onBubble}
          />
        ))}
      </ScrollView>
    </Capsule>
  );
}

/**
 * One pair key: the iPad keyboard's flick down.
 *
 * A touch shows the top symbol in a bubble over the key, a drag down past
 * FLICK flips the bubble to the bottom symbol, and the release types what the
 * bubble shows. A sideways drag is the scroll view's: it takes the touch away
 * and nothing is typed.
 */
function PairKeyView({
  pair,
  width,
  disabled,
  palette,
  onSymbol,
  onBubble,
}: {
  pair: PairKey;
  width: number;
  disabled: boolean;
  palette: Appearance;
  onSymbol: (symbol: string) => void;
  onBubble: (bubble: Bubble | null) => void;
}) {
  /** The touch in progress: where it began, the key's centre, what it will type. */
  const touch = useRef<{ startY: number; center: number; symbol: string } | null>(null);

  const show = (symbol: string, center: number) => onBubble({ symbol, center });
  const begin = ({ nativeEvent }: GestureResponderEvent) => {
    const center = nativeEvent.pageX - nativeEvent.locationX + width / 2;
    touch.current = { startY: nativeEvent.pageY, center, symbol: pair.top };
    show(pair.top, center);
  };
  const move = ({ nativeEvent }: GestureResponderEvent) => {
    const current = touch.current;
    if (!current) return;
    const symbol = nativeEvent.pageY - current.startY >= FLICK ? pair.bottom : pair.top;
    if (symbol === current.symbol) return;
    current.symbol = symbol;
    show(symbol, current.center);
  };
  const end = (type: boolean) => {
    const current = touch.current;
    touch.current = null;
    onBubble(null);
    if (type && current) onSymbol(current.symbol);
  };

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={pair.spoken}
      accessibilityState={{ disabled }}
      // VoiceOver has no drag down, so the bottom symbol is an action of its own.
      accessibilityActions={[{ name: 'activate' }, { name: 'bottom', label: pair.bottom }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (!disabled) onSymbol(nativeEvent.actionName === 'bottom' ? pair.bottom : pair.top);
      }}
      onStartShouldSetResponder={() => !disabled}
      onResponderGrant={begin}
      onResponderMove={move}
      onResponderRelease={() => end(true)}
      onResponderTerminate={() => end(false)}
      style={[styles.pair, { width }, disabled ? styles.dim : null]}>
      {/* Not a touch target, so `locationX` is measured from the key. */}
      <View pointerEvents="none" style={styles.pairLabels}>
        <Text allowFontScaling={false} style={[styles.pairTop, { color: palette.toolbarTint }]}>
          {pair.top}
        </Text>
        <Text allowFontScaling={false} style={[styles.pairBottom, { color: palette.secondaryLabel }]}>
          {pair.bottom}
        </Text>
      </View>
    </View>
  );
}

/**
 * How far the keyboard has pushed the row up, in points.
 *
 * The keyboard is the only thing that moves it. iOS reports an input
 * accessory view's height as part of the keyboard frame, so one listener
 * covers a keyboard with or without one.
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

  // Above the home indicator, not over it. With the keyboard up there is no
  // indicator to clear: it is behind the keyboard, and the row sits on that
  // instead.
  return inset > 0 ? inset + BOTTOM_GAP - rowClearance(insets.bottom) : 0;
}

/** The row's resting distance from the bottom of the screen. */
function rowClearance(safeAreaBottom: number): number {
  return Math.max(BOTTOM_GAP, safeAreaBottom);
}

/** The least clearance under the row, when there is no home indicator to clear. */
const BOTTOM_GAP = 8;

const CAPSULE_HEIGHT = 52;
const KEY_HEIGHT = 44;

/**
 * How wide a fixed key is.
 *
 * Sized from the middle: the pairs get what the fixed groups leave, and two
 * whole pairs must fit on a 393 pt phone. Eight and a half of these, with the
 * capsules' padding, come to 271 pt.
 */
const KEY_WIDTH = 30;

/** All four arrows, in the width of one and a half keys. */
const ARROWS_WIDTH = KEY_WIDTH * 1.5;

/** The disc behind a held modifier. */
const DISC = 30;

/** The narrowest a pair may be before the strip shows one fewer of them. */
const PAIR_MIN_WIDTH = 32;

/** The gap at each end of a capsule. */
const EDGE = 4;

/** How far down a touch on a pair goes before it means the bottom symbol. */
const FLICK = 14;

const BUBBLE_WIDTH = 44;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 8,
    // Clearance above the capsules, so that glass does not sit on the
    // Surface's last row.
    paddingTop: 10,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CAPSULE_HEIGHT,
    borderRadius: CAPSULE_HEIGHT / 2,
    paddingHorizontal: EDGE,
    overflow: 'hidden',
  },
  plainCapsule: {
    backgroundColor: '#242838',
  },
  strip: {
    flex: 1,
    paddingHorizontal: 0,
    // The scroll view takes the capsule's whole height, so a touch anywhere
    // in the capsule scrolls it.
    alignItems: 'stretch',
  },
  key: {
    width: KEY_WIDTH,
    height: KEY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    fontSize: 17,
    fontWeight: '500',
  },
  held: {
    position: 'absolute',
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    opacity: 0.25,
  },
  arrows: {
    width: ARROWS_WIDTH,
    height: KEY_HEIGHT,
  },
  arrowsBottom: {
    flexDirection: 'row',
  },
  arrow: {
    height: KEY_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Up has the top half to itself, so its target is the cluster's whole width.
  arrowUp: {
    width: ARROWS_WIDTH,
  },
  arrowBelow: {
    width: ARROWS_WIDTH / 3,
  },
  arrowLabel: {
    fontSize: 10,
  },
  pairsScroll: {
    flex: 1,
  },
  pairs: {
    alignItems: 'center',
    paddingHorizontal: EDGE,
  },
  pair: {
    height: KEY_HEIGHT,
    justifyContent: 'center',
  },
  pairLabels: {
    alignItems: 'center',
  },
  pairTop: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '600',
  },
  pairBottom: {
    fontSize: 12,
    lineHeight: 15,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_WIDTH,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleLabel: {
    fontSize: 24,
    fontWeight: '500',
  },
  dim: {
    opacity: 0.35,
  },
});
