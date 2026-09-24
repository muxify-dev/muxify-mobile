import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Appearance } from '@/constants/app-theme';

export interface BannerAction {
  id: string;
  label: string;
  onPress: () => void;
  /** The one action the Banner is really asking for; drawn in the accent. */
  prominent?: boolean;
  testID?: string;
}

export interface BannerProps {
  title: string;
  body?: string;
  /**
   * What leads the text. A spinner while something is being waited on, a
   * symbol when the Banner is reporting something that has already happened.
   */
  leading: { busy: true } | { symbol: SFSymbol };
  /** Neutral for something in progress; warning for something that went wrong. */
  tone: 'neutral' | 'warning';
  actions?: BannerAction[];
  /** The Theme's appearance, not the phone's: the glass is drawn to match it. */
  appearance: 'light' | 'dark';
  palette: Appearance;
  accessibilityLabel: string;
  testID?: string;
}

/**
 * A Banner: the Terminal Screen's one kind of notice.
 *
 * A Liquid Glass card under the status bar, the way iOS delivers a notification
 * over whatever is on screen, rather than a dark bar along the bottom that was
 * neither the system's nor the terminal's. It is drawn in the Theme's
 * appearance — the glass is told which one, since on its own it would follow
 * the phone's setting and a light phone would put a white card over a Mocha
 * terminal — and its text in the Theme's chrome colours. See appearanceFor.
 *
 * With a single action the action sits at the trailing edge, where iOS puts the
 * one thing a banner asks of you; with more than one they get a row of their
 * own under the text, because two verbs side by side at the edge are a coin
 * toss for a thumb.
 */
export function Banner({
  title,
  body,
  leading,
  tone,
  actions = [],
  appearance,
  palette,
  accessibilityLabel,
  testID,
}: BannerProps) {
  const toneColor = tone === 'warning' ? palette.destructive : palette.secondaryLabel;
  const trailing = actions.length === 1 ? actions[0] : null;
  const below = actions.length > 1 ? actions : [];

  const content = (
    <>
      <View style={styles.row}>
        <View style={styles.leading}>
          {'busy' in leading ? (
            <ActivityIndicator size="small" color={toneColor} />
          ) : (
            <SymbolView name={leading.symbol} size={20} tintColor={toneColor} />
          )}
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.toolbarTint }]} numberOfLines={2}>
            {title}
          </Text>
          {body ? (
            <Text style={[styles.body, { color: palette.secondaryLabel }]} numberOfLines={3}>
              {body}
            </Text>
          ) : null}
        </View>
        {trailing ? <ActionButton action={trailing} palette={palette} /> : null}
      </View>
      {below.length > 0 ? (
        <View style={styles.actions}>
          {below.map((action) => (
            <ActionButton key={action.id} action={action} palette={palette} />
          ))}
        </View>
      ) : null}
    </>
  );

  // The shadow is the outer view's, not the glass's: the glass clips to its
  // corners, and a shadow inside a clipped view is a shadow nobody sees.
  // Without one the card has no edge at all over a light terminal — Latte's
  // background and frosted glass over it come out the same near-white.
  return (
    <View style={styles.shadow}>
      {isGlassEffectAPIAvailable() ? (
        <GlassView
          style={styles.card}
          glassEffectStyle="regular"
          colorScheme={appearance}
          accessibilityLabel={accessibilityLabel}
          testID={testID}>
          {content}
        </GlassView>
      ) : (
        <View
          style={[
            styles.card,
            styles.plain,
            { backgroundColor: palette.rowSurface, borderColor: palette.separator },
          ]}
          accessibilityLabel={accessibilityLabel}
          testID={testID}>
          {content}
        </View>
      )}
    </View>
  );
}

function ActionButton({ action, palette }: { action: BannerAction; palette: Appearance }) {
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      hitSlop={8}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Text
        style={[
          styles.actionLabel,
          {
            color: action.prominent === false ? palette.secondaryLabel : palette.controlAccent,
          },
        ]}
        testID={action.testID}>
        {action.label}
      </Text>
    </Pressable>
  );
}

/**
 * Keeps a Banner on screen long enough to leave the way it came.
 *
 * Whatever is inside slides down from under the status bar when `shown` turns
 * true and lifts back out when it turns false. On the way out it keeps showing
 * what it was last given, because by then the parent has nothing loud to say —
 * that is why it is going — and a card that changed its words as it left would
 * be announcing the very thing it was there to wait for.
 */
export function Presence({ shown, children }: { shown: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(shown);
  const [held, setHeld] = useState<ReactNode>(children);
  const progress = useRef(new Animated.Value(shown ? 1 : 0)).current;

  useEffect(() => {
    if (shown) setHeld(children);
  }, [shown, children]);

  useEffect(() => {
    if (shown) {
      setMounted(true);
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        damping: 20,
        stiffness: 220,
        mass: 0.9,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [shown, progress]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={shown ? 'box-none' : 'none'}
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-28, 0],
            }),
          },
        ],
      }}>
      {shown ? children : held}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: 22,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
  },
  card: {
    // The system's notification card: generous corners, and inset from the
    // sides the same distance as the Dock is from the bottom.
    borderRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  plain: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leading: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
    // Lined up with the text, past the leading glyph.
    paddingLeft: 36,
  },
  action: {
    paddingVertical: 4,
  },
  actionLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.5,
  },
});
