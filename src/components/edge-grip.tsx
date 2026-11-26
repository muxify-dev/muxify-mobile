import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { PaneSwipe } from '@/hooks/use-pane-swipe';
import { createVelocityTracker } from '@/lib/inertia';
import { panAxis, swipeOf } from '@/lib/pan-axis';
import { GRIP_BAND, GRIP_HOLD_MS, GRIP_LINE, gripCentre, gripShown, moveGrip, WIDE_DRAWER_SCREEN, type GripTouch, type Point } from '@/navigation/grip';
import { useSettings } from '@/settings/settings-context';

/**
 * The Grip: a small Liquid Glass line at the right edge, in the middle of a
 * phone and three quarters down an iPad. A phone on its side has none. A still hold opens the Edge
 * Drawer and leaves the finger down for the drawer; see navigation/grip.ts.
 * From the touch the line fills with the accent colour, full when the
 * drawer opens, and then it glows while the finger is held.
 *
 * Its band sits over the Surface or the page and takes the touches that
 * land in it. A sideways drag that starts there is still the Pane Swipe when
 * the screen passes `swipe`, as on an inactive Pane's layer.
 */
export function EdgeGrip({
  enabled,
  onHold,
  onHeldMove,
  onHeldLift,
  onOpen,
  swipe,
}: {
  enabled: boolean;
  /** The hold ended with the finger still down, at this point on screen. */
  onHold: (at: Point) => void;
  onHeldMove: (to: Point) => void;
  onHeldLift: (to: Point) => void;
  /** VoiceOver's activate: the drawer opens with no finger held, at the Grip's centre. */
  onOpen: (at: Point) => void;
  /** The Terminal Screen's Pane Swipe, with the width a Pane slides across. */
  swipe?: { swipe: PaneSwipe; width: number };
}) {
  const { appearance, palette } = useSettings();
  const { width: screenWidth, height: screen } = useWindowDimensions();
  /** Where the screen's area is, which the band is placed in. */
  const [area, setArea] = useState<{ top: number; bottom: number } | null>(null);
  const areaView = useRef<View>(null);
  const touch = useRef<GripTouch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sideways = useRef(createVelocityTracker());
  /** How full of colour the glass is: 0 at rest, 1 when the drawer opens. */
  const tint = useSharedValue(0);
  /** The glow round the button while the drawer is open under the finger. */
  const glow = useSharedValue(0);
  const tinted = useAnimatedStyle(() => ({
    opacity: tint.get() * 0.95,
    transform: [{ scaleY: tint.get() }],
  }));
  const glowing = useAnimatedStyle(() => ({
    opacity: glow.get(),
    transform: [{ scaleX: 1 + glow.get() * 0.5 }],
  }));

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const clearTint = () => {
    cancelAnimation(tint);
    tint.set(withTiming(0, { duration: 150 }));
    glow.set(withTiming(0, { duration: 150 }));
  };
  useEffect(() => stopTimer, []);
  // A Grip turned off mid-touch, as by a Selection, lets the touch go.
  useEffect(() => {
    if (enabled) return;
    stopTimer();
    touch.current = null;
    cancelAnimation(tint);
    tint.set(0);
    glow.set(0);
  }, [enabled, tint, glow]);

  const pointOf = ({ nativeEvent }: GestureResponderEvent): Point => ({
    x: nativeEvent.pageX,
    y: nativeEvent.pageY,
  });
  const dragOf = (from: Point, to: Point) => ({
    dx: to.x - from.x,
    dy: to.y - from.y,
  });

  const end = (event: GestureResponderEvent, lifted: boolean) => {
    stopTimer();
    clearTint();
    const was = touch.current;
    touch.current = null;
    if (!was) return;
    const to = pointOf(event);
    if (was.phase === 'held') {
      // A touch the system took is a lift where it opened: the drawer closes with no pick.
      onHeldLift(lifted ? to : was.at);
      return;
    }
    if (was.phase !== 'dragging' || !swipe) return;
    const { dx, dy } = dragOf(was.from, to);
    const direction =
      lifted && panAxis(dx, dy) === 'horizontal' ? swipeOf(dx, swipe.width, sideways.current.velocity(Date.now())) : null;
    if (direction) swipe.swipe.swipe(direction);
    else swipe.swipe.cancel();
  };

  if (!gripShown({ width: screenWidth, height: screen })) return null;
  const centre = area ? gripCentre(area, screen, screenWidth >= WIDE_DRAWER_SCREEN) : null;
  const top = area && centre !== null ? centre - area.top - GRIP_BAND.height / 2 : null;
  return (
    <View
      ref={areaView}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={() => areaView.current?.measureInWindow((_, y, __, height) => setArea({ top: y, bottom: y + height }))}
    >
      {top === null ? null : (
        <View
          style={[styles.band, { top, opacity: enabled ? 1 : 0.4 }]}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Destinations"
          accessibilityHint="Lists the Panes, Windows, Sessions and Tabs you can go to"
          accessibilityState={{ disabled: !enabled }}
          onAccessibilityTap={enabled && centre !== null ? () => onOpen({ x: screenWidth, y: centre }) : undefined}
          onStartShouldSetResponder={() => enabled}
          // The finger is the drawer's once it opens: a scroll under it must not take it.
          onResponderTerminationRequest={() => touch.current?.phase !== 'held'}
          onResponderGrant={(event) => {
            const from = pointOf(event);
            touch.current = { phase: 'waiting', from };
            sideways.current.clear();
            sideways.current.add(from.x, Date.now());
            tint.set(withTiming(1, { duration: GRIP_HOLD_MS }));
            timer.current = setTimeout(() => {
              timer.current = null;
              if (touch.current?.phase !== 'waiting') return;
              touch.current = { phase: 'held', at: touch.current.from };
              glow.set(withTiming(1, { duration: 120 }));
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              onHold(touch.current.at);
            }, GRIP_HOLD_MS);
          }}
          onResponderMove={(event) => {
            const was = touch.current;
            if (!was) return;
            const to = pointOf(event);
            if (was.phase === 'held') {
              onHeldMove(to);
              return;
            }
            sideways.current.add(to.x, Date.now());
            const next = moveGrip(was, to);
            touch.current = next;
            if (next.phase !== 'dragging') return;
            if (was.phase === 'waiting') {
              stopTimer();
              clearTint();
            }
            const { dx, dy } = dragOf(next.from, to);
            if (swipe && panAxis(dx, dy) === 'horizontal') swipe.swipe.drag(dx, swipe.width, true);
          }}
          onResponderRelease={(event) => end(event, true)}
          onResponderTerminate={(event) => end(event, false)}
        >
          <View pointerEvents="none" style={styles.line}>
            <Animated.View
              style={[
                styles.glass,
                styles.glow,
                {
                  backgroundColor: palette.controlAccent,
                  shadowColor: palette.controlAccent,
                },
                glowing,
              ]}
            />
            {/* Not interactive glass: its own touch handling could take the touch from the hold. */}
            {isGlassEffectAPIAvailable() ? (
              <GlassView style={styles.glass} glassEffectStyle="clear" colorScheme={appearance} />
            ) : (
              <View style={[styles.glass, styles.clear]} />
            )}
            <Animated.View style={[styles.glass, { backgroundColor: palette.controlAccent }, tinted]} />
            <View style={[styles.glass, styles.rim]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    right: 0,
    width: GRIP_BAND.width,
    height: GRIP_BAND.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { width: GRIP_LINE.width, height: GRIP_LINE.height },
  glass: {
    ...StyleSheet.absoluteFill,
    borderRadius: GRIP_LINE.width / 2,
    overflow: 'hidden',
  },
  glow: {
    overflow: 'visible',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  // With no glass: a faint fill, so the line is still there to find.
  clear: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  // A thin light edge, as glass catches the light, so it shows on any page.
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
});
