import { MaskedView } from '@expo/ui/community/masked-view';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
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
import {
  REPEAT_DELAY,
  REPEAT_INTERVAL,
  stickDirection,
  type ArrowDirection,
} from '@/lib/arrow-stick';
import type { Modifier, Modifiers } from '@/lib/modifier-keys';

export interface KeyRowProps {
  /** Which modifiers are armed, so the row can show them held down. */
  armed: Modifiers;
  /** A modifier tapped: on if it was off, off if it was on. */
  onArm: (modifier: Modifier) => void;
  /** Escape, tab or an arrow, once for each repeat of a held arrow. */
  onKey: (key: NamedKey) => void;
  /** One symbol of a pair: the main one on a tap, the alternate one on a drag down. */
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
 * keyboard: the keys a phone keyboard lacks, in one capsule with three
 * sections.
 *
 * All of it is React Native over `GlassView`. Each fixed section has a sticky
 * key that must draw as *held*, and the middle scrolls sideways inside the
 * capsule; neither has a SwiftUI equivalent reachable through `@expo/ui`.
 */
export function KeyRow(props: KeyRowProps) {
  const { armed, onArm, onKey, onSymbol, keysDisabled, palette } = props;
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

  return (
    <View style={styles.row} pointerEvents="box-none">
      <Capsule>
        {LEFT_KEYS.map(fixedKey)}
        <Divider palette={palette} />
        <PairStrip disabled={keysDisabled} palette={palette} onSymbol={onSymbol} onBubble={setBubble} />
        <Divider palette={palette} />
        <ArrowStick disabled={keysDisabled} palette={palette} onKey={onKey} onBubble={setBubble} />
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
              bottom: CAPSULE_HEIGHT + 6,
              backgroundColor: palette.rowSurface,
              borderColor: palette.separator,
            },
          ]}>
          {bubble.kind === 'pair' ? (
            <PairSymbols
              pair={bubble.pair}
              progress={bubble.progress}
              height={BUBBLE_HEIGHT}
              fontSize={BUBBLE_FONT_SIZE}
              palette={palette}
            />
          ) : (
            <Text allowFontScaling={false} style={[styles.bubbleLabel, { color: palette.toolbarTint }]}>
              {bubble.symbol}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * What the bubble over a key shows, and where that key is across the row: a
 * pair key's two symbols as its touch moves them, or the arrow being sent.
 */
type Bubble =
  | { kind: 'pair'; pair: PairKey; progress: SharedValue<number>; center: number }
  | { kind: 'arrow'; symbol: string; center: number };

function Capsule({ children }: { children: ReactNode }) {
  // Some iOS 26 betas ship without the underlying effect class and crash on
  // use, so probe the runtime API rather than the design-mode flag. A
  // GlassView on such a runtime renders nothing at all, hence the plain view.
  return isGlassEffectAPIAvailable() ? (
    <GlassView style={styles.capsule} glassEffectStyle="regular">
      {children}
    </GlassView>
  ) : (
    <View style={[styles.capsule, styles.plainCapsule]}>{children}</View>
  );
}

function Divider({ palette }: { palette: Appearance }) {
  return <View style={[styles.divider, { backgroundColor: palette.secondaryLabel }]} />;
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
      style={({ pressed }) => [styles.key, disabled ? styles.dim : null, pressed && { backgroundColor: palette.rowSurface, borderRadius: KEY_HEIGHT / 2 }]}>
      {/* A circle, not a capsule the shape of the key: a held modifier should
          read as a key pressed down, and a tall rounded rectangle reads as a
          segmented control instead. */}
      {held ? <View style={[styles.held, { backgroundColor: palette.controlAccent }]} /> : null}
      {symbol ? (
        <SymbolView name={symbol} size={SYMBOL_SIZE} tintColor={color} />
      ) : (
        <Text allowFontScaling={false} style={[styles.keyLabel, { color }]}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The middle section: the pairs, scrolling sideways.
 *
 * It takes the width the fixed sections leave and sizes the pairs from it, so
 * that a whole number of them fit with the same gap at each end. A fixed pair
 * width leaves a remainder, which shows as a sliver of the next key.
 *
 * Each end fades out while there are more pairs past it. The fade is a mask
 * rather than a gradient painted over the pairs, because what is behind them
 * is glass, and no one colour matches it.
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
  const [more, setMore] = useState<ScrollEdges>({ before: false, after: false });
  const extent = useRef<ScrollExtent>({ offset: 0, viewport: 0, content: 0 });

  const measure = (change: Partial<ScrollExtent>) => {
    const { offset, viewport, content } = Object.assign(extent.current, change);
    const next = { before: offset > 1, after: offset + viewport < content - 1 };
    setMore((previous) =>
      previous.before === next.before && previous.after === next.after ? previous : next,
    );
  };

  return (
    <MaskedView
      style={styles.strip}
      maskElement={
        <View style={styles.fadeMask}>
          <View style={more.before ? styles.fadeIn : styles.fadeNone} />
          <View style={styles.opaque} />
          <View style={more.after ? styles.fadeOut : styles.fadeNone} />
        </View>
      }>
      <ScrollView
        horizontal
        style={styles.pairsScroll}
        onLayout={({ nativeEvent }) => {
          setWidth(nativeEvent.layout.width);
          measure({ viewport: nativeEvent.layout.width });
        }}
        onContentSizeChange={(content) => measure({ content })}
        onScroll={({ nativeEvent }) => measure({ offset: nativeEvent.contentOffset.x })}
        scrollEventThrottle={16}
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
    </MaskedView>
  );
}

/** Whether there is more of a scroll view past each of its ends. */
interface ScrollEdges {
  before: boolean;
  after: boolean;
}

/** Where a horizontal scroll view is, in points: what it shows of what it holds. */
interface ScrollExtent {
  offset: number;
  viewport: number;
  content: number;
}

/**
 * One pair key: the iPad keyboard's flick down.
 *
 * The alternate symbol sits small above the main one. A drag down moves the
 * alternate symbol into the main one's place, in the key and in a bubble over
 * it, and is complete at FLICK. The release types the alternate symbol if the
 * drag got there and the main one if not. A sideways drag is the scroll
 * view's: it takes the touch away and nothing is typed.
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
  /** The touch in progress: where it began, and whether its drag reached FLICK. */
  const touch = useRef<{ startY: number; flicked: boolean } | null>(null);
  /** How far the drag is to FLICK, from 0 to 1. The key and the bubble draw from it. */
  const progress = useSharedValue(0);

  const begin = ({ nativeEvent }: GestureResponderEvent) => {
    const center = nativeEvent.pageX - nativeEvent.locationX + width / 2;
    touch.current = { startY: nativeEvent.pageY, flicked: false };
    progress.value = 0;
    onBubble({ kind: 'pair', pair, progress, center });
  };
  const move = ({ nativeEvent }: GestureResponderEvent) => {
    const current = touch.current;
    if (!current) return;
    const dragged = Math.min(Math.max((nativeEvent.pageY - current.startY) / FLICK, 0), 1);
    current.flicked = dragged === 1;
    progress.value = dragged;
  };
  const end = (type: boolean) => {
    const current = touch.current;
    touch.current = null;
    onBubble(null);
    progress.value = withSpring(0, SPRING_BACK);
    if (type && current) onSymbol(current.flicked ? pair.alternate : pair.main);
  };

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={pair.spoken}
      accessibilityState={{ disabled }}
      // VoiceOver has no drag down, so the alternate symbol is an action of its own.
      accessibilityActions={[{ name: 'activate' }, { name: 'alternate', label: pair.alternate }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (!disabled) onSymbol(nativeEvent.actionName === 'alternate' ? pair.alternate : pair.main);
      }}
      onStartShouldSetResponder={() => !disabled}
      onResponderGrant={begin}
      onResponderMove={move}
      onResponderRelease={() => end(true)}
      onResponderTerminate={() => end(false)}
      style={[styles.pair, { width }, disabled ? styles.dim : null]}>
      <PairSymbols
        pair={pair}
        progress={progress}
        height={KEY_HEIGHT}
        fontSize={PAIR_FONT_SIZE}
        palette={palette}
      />
    </View>
  );
}

/**
 * A pair's two symbols in a frame `height` tall, drawn from a drag's progress.
 *
 * At 0 the alternate symbol is small and grey, its line sitting on top of the
 * main symbol's line, and the two together centred in the frame. Towards 1
 * the main symbol drops half the frame, shrinks and fades out, and the
 * alternate symbol moves down into its place, grows to full size and takes
 * the tint. Both are set at full size and scaled down, so the one that ends
 * large is drawn sharp.
 *
 * The spacing comes from the line height, not the frame: brackets and braces
 * fill almost the whole line, and a smaller spacing lays one over the other.
 */
function PairSymbols({
  pair,
  progress,
  height,
  fontSize,
  palette,
}: {
  pair: PairKey;
  progress: SharedValue<number>;
  height: number;
  fontSize: number;
  palette: Appearance;
}) {
  const lineHeight = Math.round(fontSize * 1.2);
  /** From the main symbol's centre to the alternate one's at rest. */
  const lift = (lineHeight * (1 + ALTERNATE_SCALE)) / 2;
  const rest = lift / 2;
  const { secondaryLabel, toolbarTint } = palette;
  const main = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateY: rest + (progress.value * height) / 2 },
      { scale: 1 - 0.3 * progress.value },
    ],
  }));
  const alternate = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [secondaryLabel, toolbarTint]),
    transform: [
      { translateY: rest - lift * (1 - progress.value) },
      { scale: ALTERNATE_SCALE + (1 - ALTERNATE_SCALE) * progress.value },
    ],
  }));

  return (
    // Not a touch target, so `locationX` is measured from the key.
    <View pointerEvents="none" style={styles.pairSymbols}>
      <Animated.Text
        allowFontScaling={false}
        style={[styles.pairSymbol, { fontSize, lineHeight, color: toolbarTint }, main]}>
        {pair.main}
      </Animated.Text>
      <Animated.Text allowFontScaling={false} style={[styles.pairSymbol, { fontSize, lineHeight }, alternate]}>
        {pair.alternate}
      </Animated.Text>
    </View>
  );
}

/**
 * The arrow key: one key for the four arrows, like a joystick.
 *
 * A touch sends nothing. A drag past the dead zone sends the arrow it points
 * at, with the bubble over the key showing which. Held, the arrow repeats
 * until the finger lifts, and moving the finger to another side changes the
 * arrow without lifting.
 */
function ArrowStick({
  disabled,
  palette,
  onKey,
  onBubble,
}: {
  disabled: boolean;
  palette: Appearance;
  onKey: (key: NamedKey) => void;
  onBubble: (bubble: Bubble | null) => void;
}) {
  const stick = useRef<StickState>({ phase: 'idle' });
  // A repeat must send with the modifiers armed *now*: the first arrow spends
  // them, and the `onKey` of the render it started in would send them again.
  const latestOnKey = useRef(onKey);
  useEffect(() => {
    latestOnKey.current = onKey;
  });

  const release = useCallback(() => {
    const current = stick.current;
    if (current.phase === 'sending') clearTimeout(current.timer);
    stick.current = { phase: 'idle' };
    onBubble(null);
  }, [onBubble]);

  useEffect(() => {
    if (disabled) release();
  }, [disabled, release]);
  useEffect(
    () => () => {
      const current = stick.current;
      if (current.phase === 'sending') clearTimeout(current.timer);
    },
    [],
  );

  const repeatAfter = (delay: number): ReturnType<typeof setTimeout> =>
    setTimeout(() => {
      const current = stick.current;
      if (current.phase !== 'sending') return;
      latestOnKey.current(ARROW_KEYS[current.direction]);
      stick.current = { ...current, timer: repeatAfter(REPEAT_INTERVAL) };
    }, delay);

  const begin = ({ nativeEvent }: GestureResponderEvent) => {
    stick.current = {
      phase: 'armed',
      touch: {
        startX: nativeEvent.pageX,
        startY: nativeEvent.pageY,
        center: nativeEvent.pageX - nativeEvent.locationX + KEY_WIDTH / 2,
      },
    };
  };
  const move = ({ nativeEvent }: GestureResponderEvent) => {
    const current = stick.current;
    if (current.phase === 'idle') return;
    const { touch } = current;
    const direction = stickDirection(
      nativeEvent.pageX - touch.startX,
      nativeEvent.pageY - touch.startY,
    );
    if (direction === null) return;
    if (current.phase === 'sending') {
      if (current.direction === direction) return;
      clearTimeout(current.timer);
    }
    const key = ARROW_KEYS[direction];
    latestOnKey.current(key);
    onBubble({ kind: 'arrow', symbol: key.label, center: touch.center });
    stick.current = { phase: 'sending', touch, direction, timer: repeatAfter(REPEAT_DELAY) };
  };

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel="arrows"
      accessibilityState={{ disabled }}
      // VoiceOver has no drag, so each arrow is an action of its own.
      accessibilityActions={STICK_ACTIONS}
      onAccessibilityAction={({ nativeEvent }) => {
        const action = STICK_ACTIONS.find((each) => each.name === nativeEvent.actionName);
        if (action && !disabled) onKey(ARROW_KEYS[action.name]);
      }}
      onStartShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={begin}
      onResponderMove={move}
      onResponderRelease={release}
      onResponderTerminate={release}
      style={[styles.key, disabled ? styles.dim : null]}>
      {/* Not a touch target, so `locationX` is measured from the key. */}
      <View pointerEvents="none">
        <SymbolView
          name="arrow.up.and.down.and.arrow.left.and.right"
          size={SYMBOL_SIZE}
          tintColor={palette.toolbarTint}
        />
      </View>
    </View>
  );
}

/** Where a touch on the arrow key landed, and the key's centre across the row. */
interface StickTouch {
  startX: number;
  startY: number;
  center: number;
}

/**
 * The arrow key's touch: none, one still inside the dead zone, or one sending
 * an arrow with the timer for its next repeat.
 */
type StickState =
  | { phase: 'idle' }
  | { phase: 'armed'; touch: StickTouch }
  | {
      phase: 'sending';
      touch: StickTouch;
      direction: ArrowDirection;
      timer: ReturnType<typeof setTimeout>;
    };

const STICK_ACTIONS = [
  { name: 'up', label: 'Up' },
  { name: 'down', label: 'Down' },
  { name: 'left', label: 'Left' },
  { name: 'right', label: 'Right' },
] satisfies { name: ArrowDirection; label: string }[];

/** The glass. 44 pt is the iOS touch minimum, so the capsule stays easy to hit. */
const CAPSULE_HEIGHT = 44;
/** Clearance above the capsule, so that glass does not sit on the Surface's last row. */
const ROW_CLEARANCE = 6;
export const KEY_ROW_HEIGHT = CAPSULE_HEIGHT + ROW_CLEARANCE;
/** Each key's touch frame inside the capsule. The capsule's edge still catches touches. */
const KEY_HEIGHT = 38;

/**
 * How wide a fixed key is.
 *
 * Sized from the middle: the pairs get what the fixed sections leave. Eight
 * of these, the dividers and the capsule's padding come to 266 pt, which
 * leaves three whole pairs on a 393 pt phone.
 */
const KEY_WIDTH = 30;

/** How far each end of the pairs fades out while there are more past it. */
const FADE = 32;

/** An SF Symbol on a fixed key. */
const SYMBOL_SIZE = 16;

/** The disc behind a held modifier. */
const DISC = 30;

/** The narrowest a pair may be before the strip shows one fewer of them. */
const PAIR_MIN_WIDTH = 32;

/** The gap at each end of the capsule, and of the pairs. */
const EDGE = 4;

/** How far down a touch on a pair goes before it means the alternate symbol. */
const FLICK = 14;

/** A pair's main symbol at rest, in the key. */
const PAIR_FONT_SIZE = 16;

/** How big a pair's alternate symbol is at rest, against the main one. */
const ALTERNATE_SCALE = 0.6;

/** How a pair key's symbols return to rest when the touch ends. */
const SPRING_BACK = { mass: 1, stiffness: 320, damping: 36 };

const BUBBLE_WIDTH = 44;
const BUBBLE_HEIGHT = 48;
const BUBBLE_FONT_SIZE = 24;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: ROW_CLEARANCE,
  },
  capsule: {
    flex: 1,
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
  // The scroll view takes the capsule's whole height, so a touch anywhere in
  // the middle section scrolls it.
  strip: {
    flex: 1,
    alignSelf: 'stretch',
  },
  divider: {
    width: 1,
    height: 22,
    marginHorizontal: 4,
  },
  fadeMask: {
    flex: 1,
    flexDirection: 'row',
  },
  opaque: {
    flex: 1,
    backgroundColor: 'black',
  },
  fadeNone: {
    width: FADE,
    backgroundColor: 'black',
  },
  fadeIn: {
    width: FADE,
    experimental_backgroundImage: 'linear-gradient(to right, transparent, black)',
  },
  fadeOut: {
    width: FADE,
    experimental_backgroundImage: 'linear-gradient(to right, black, transparent)',
  },
  key: {
    width: KEY_WIDTH,
    height: KEY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  held: {
    position: 'absolute',
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    opacity: 0.25,
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
  pairSymbols: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairSymbol: {
    position: 'absolute',
    fontWeight: '500',
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
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
