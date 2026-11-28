import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import type { PaneSwipe } from '@/hooks/use-pane-swipe';
import { createVelocityTracker } from '@/lib/inertia';
import {
  DEFAULT_GRIP_ACTIONS, fanItems, type GripActionRuns, type GripActionTitles,
} from '@/lib/grip-actions';
import { panAxis, swipeOf } from '@/lib/pan-axis';
import {
  endGrip, GRIP_BUTTON, GRIP_HOLD_MS, gripCentre, gripShown, holdGrip, lightsSlot, moveGrip, returnToFan, WIDE_DRAWER_SCREEN,
  type ActionSlot, type GripTouch, type Point,
} from '@/navigation/grip';
import { useSettings } from '@/settings/settings-context';

import { GripFan } from './grip-fan';

const say = speakingAs(deviceLog(), 'screen');

/**
 * The Grip: a round Liquid Glass button at the right edge, in the middle of a
 * phone and three quarters down an iPad. A phone on its side has none. A
 * still hold opens the Fan, and a finger that lights a slot of it and lifts
 * runs that Grip action. The slot straight up hands the finger to the Edge
 * Drawer. See navigation/grip.ts.
 *
 * At rest it is a two-tone hairline ring and no glass, so the content under it
 * shows as it is, on the terminal and on a white page. From the touch the glass
 * comes in and the button fills with the accent colour, full when the Fan
 * opens, and then it glows while the Fan is open. With no glass API it is the
 * ring and the fill.
 *
 * Its square of 44 points sits over the Surface or the page and takes the
 * touches that land in it. A sideways drag that starts there is still the Pane
 * Swipe when the screen passes `swipe`, as on an inactive Pane's layer.
 */
export function EdgeGrip({
  enabled,
  actions,
  titles,
  onDestinations,
  onHeldMove,
  onHeldLift,
  onOpen,
  onFanChange,
  swipe,
}: {
  enabled: boolean;
  /** What this screen runs for each Grip action: undefined for one it cannot, which the Fan draws dimmed. */
  actions: GripActionRuns;
  titles?: GripActionTitles;
  /** The finger lit Destinations at this point on screen: the Edge Drawer opens under it. */
  onDestinations: (at: Point) => void;
  /** A move of the finger the drawer holds. 'fan' when it went down past the drawer, which closed: the Fan opens again. */
  onHeldMove: (to: Point) => 'drawer' | 'fan';
  onHeldLift: (to: Point) => void;
  /** VoiceOver's activate: the drawer opens with no finger held, at the button's centre. */
  onOpen: (at: Point) => void;
  /** The Fan opened or closed, so the screen can hold input while it is open. */
  onFanChange?: (open: boolean) => void;
  /** The Terminal Screen's Pane Swipe, with the width a Pane slides across. */
  swipe?: { swipe: PaneSwipe; width: number };
}) {
  const { appearance, palette, settings } = useSettings();
  const { width: screenWidth, height: screen } = useWindowDimensions();
  /** Where the screen's area is, which the button is placed in. */
  const [area, setArea] = useState<{ top: number; bottom: number } | null>(null);
  const areaView = useRef<View>(null);
  const touch = useRef<GripTouch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sideways = useRef(createVelocityTracker());
  /** While the Fan is open: the slot the finger lights. */
  const [fan, setFan] = useState<{ lit: ActionSlot | null } | null>(null);
  /** While a finger is on the button, which brings the glass in. */
  const [touching, setTouching] = useState(false);
  /** How full of colour the button is: 0 at rest, 1 when the Fan opens. */
  const tint = useSharedValue(0);
  /** The glow round the button while the Fan is open. */
  const glow = useSharedValue(0);
  const tinted = useAnimatedStyle(() => ({
    opacity: tint.get() * 0.95,
    transform: [{ scale: tint.get() }],
  }));
  const glowing = useAnimatedStyle(() => ({
    opacity: glow.get(),
    transform: [{ scale: 1 + glow.get() * 0.35 }],
  }));

  const items = fanItems(settings.gripActions ?? DEFAULT_GRIP_ACTIONS, actions, titles);
  const fanOpen = fan !== null;
  useEffect(() => {
    onFanChange?.(fanOpen);
  }, [fanOpen, onFanChange]);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const clearTint = () => {
    cancelAnimation(tint);
    tint.set(withTiming(0, { duration: 150 }));
    glow.set(withTiming(0, { duration: 150 }));
  };
  /** The button back at rest, the Fan closed. */
  const rest = () => {
    stopTimer();
    setTouching(false);
    setFan(null);
    clearTint();
  };
  useEffect(() => stopTimer, []);
  /** The Fan open round the button, from the hold or from a finger back from the drawer. */
  const openFan = () => {
    setTouching(true);
    setFan({ lit: null });
    cancelAnimation(tint);
    tint.set(withTiming(1, { duration: 120 }));
    glow.set(withTiming(1, { duration: 120 }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    say('the Fan opened');
  };
  // A Grip turned off mid-touch, as by a Selection or a sheet, lets the touch go and closes the Fan.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setTouching(false);
      setFan(null);
    }
  }
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

  const run = (slot: ActionSlot) => {
    const item = items[slot];
    if (!item || item.id === 'destinations') return;
    say(`the Fan ran ${item.id}`);
    actions[item.id]?.();
  };
  const runnable = (slot: ActionSlot) => {
    const item = items[slot];
    return item !== null && !item.dimmed;
  };

  const end = (event: GestureResponderEvent, lifted: boolean) => {
    rest();
    const was = touch.current;
    touch.current = null;
    if (!was) return;
    const to = pointOf(event);
    const result = endGrip(was, lifted, runnable);
    switch (result.kind) {
      case 'run':
        run(result.slot);
        return;
      case 'held':
        // A touch the system took is a lift where it opened: the drawer closes with no pick.
        onHeldLift(lifted ? to : result.at);
        return;
      case 'drag': {
        if (!swipe) return;
        const { dx, dy } = dragOf(result.from, to);
        const direction =
          lifted && panAxis(dx, dy) === 'horizontal' ? swipeOf(dx, swipe.width, sideways.current.velocity(Date.now())) : null;
        if (direction) swipe.swipe.swipe(direction);
        else swipe.swipe.cancel();
        return;
      }
      case 'nothing':
        return;
    }
  };

  if (!gripShown({ width: screenWidth, height: screen })) return null;
  const centre = area ? gripCentre(area, screen, screenWidth >= WIDE_DRAWER_SCREEN) : null;
  const top = area && centre !== null ? centre - area.top - GRIP_BUTTON.target / 2 : null;
  const buttonCentre = centre === null ? null : { x: screenWidth - GRIP_BUTTON.inset, y: centre };
  const voiceOverActions = items.flatMap((item) =>
    item && item.id !== 'destinations' && !item.dimmed ? [{ name: item.id, label: item.title }] : []);
  return (
    <View
      ref={areaView}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={() => areaView.current?.measureInWindow((_, y, __, height) => setArea({ top: y, bottom: y + height }))}
    >
      {fan && area && centre !== null ? (
        <>
          {/* The finger that opened the Fan is the Grip's. A second touch is not for what is under the Fan. */}
          <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} />
          <GripFan top={centre - area.top} items={items} lit={fan.lit} />
        </>
      ) : null}
      {top === null || buttonCentre === null ? null : (
        <View
          style={[styles.target, { top, opacity: enabled ? 1 : 0.4 }]}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Grip actions"
          accessibilityHint="Opens the Edge Drawer. The actions rotor has the other Grip actions."
          accessibilityState={{ disabled: !enabled }}
          accessibilityActions={enabled ? voiceOverActions : undefined}
          onAccessibilityAction={({ nativeEvent }) => {
            const item = items.find((each) => each?.id === nativeEvent.actionName);
            if (item && item.id !== 'destinations' && !item.dimmed) actions[item.id]?.();
          }}
          onAccessibilityTap={enabled ? () => onOpen(buttonCentre) : undefined}
          onStartShouldSetResponder={() => enabled}
          // The finger is the Fan's, and then the drawer's: a scroll under it must not take it.
          onResponderTerminationRequest={() => touch.current?.phase !== 'fan' && touch.current?.phase !== 'held'}
          onResponderGrant={(event) => {
            const from = pointOf(event);
            touch.current = { phase: 'waiting', from };
            sideways.current.clear();
            sideways.current.add(from.x, Date.now());
            setTouching(true);
            tint.set(withTiming(1, { duration: GRIP_HOLD_MS }));
            timer.current = setTimeout(() => {
              timer.current = null;
              if (touch.current?.phase !== 'waiting') return;
              touch.current = holdGrip(touch.current, buttonCentre);
              openFan();
            }, GRIP_HOLD_MS);
          }}
          onResponderMove={(event) => {
            const was = touch.current;
            if (!was) return;
            const to = pointOf(event);
            if (was.phase === 'held') {
              if (onHeldMove(to) === 'fan') {
                touch.current = returnToFan(was);
                openFan();
              }
              return;
            }
            if (was.phase === 'fan') {
              const next = moveGrip(was, to);
              touch.current = next;
              if (lightsSlot(was, next)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              if (next.phase === 'held') {
                // The finger leaves the Fan for the drawer: the button is at rest again.
                rest();
                onDestinations(next.at);
              } else if (next.phase === 'fan' && next.lit !== was.lit) {
                setFan({ lit: next.lit });
              }
              return;
            }
            sideways.current.add(to.x, Date.now());
            const next = moveGrip(was, to);
            touch.current = next;
            if (next.phase !== 'dragging') return;
            if (was.phase === 'waiting') rest();
            const { dx, dy } = dragOf(next.from, to);
            if (swipe && panAxis(dx, dy) === 'horizontal') swipe.swipe.drag(dx, swipe.width, true);
          }}
          onResponderRelease={(event) => end(event, true)}
          onResponderTerminate={(event) => end(event, false)}
        >
          <View pointerEvents="none" style={styles.button}>
            <Animated.View
              style={[
                styles.circle,
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
              <GlassView
                style={styles.circle}
                glassEffectStyle={{ style: touching ? 'clear' : 'none', animate: true }}
                colorScheme={appearance}
              />
            ) : null}
            <Animated.View style={[styles.circle, { backgroundColor: palette.controlAccent }, tinted]} />
            <View style={[styles.circle, styles.darkRing]} />
            <View style={[styles.circle, styles.lightRing]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  target: {
    position: 'absolute',
    right: 0,
    width: GRIP_BUTTON.target,
    height: GRIP_BUTTON.target,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { width: GRIP_BUTTON.drawn, height: GRIP_BUTTON.drawn },
  circle: {
    ...StyleSheet.absoluteFill,
    borderRadius: GRIP_BUTTON.drawn / 2,
    overflow: 'hidden',
  },
  glow: {
    overflow: 'visible',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  // Two hairlines, a light one inside a dark one, so the ring shows on the dark terminal and on a white page.
  darkRing: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.28)',
  },
  lightRing: {
    margin: 1,
    borderRadius: GRIP_BUTTON.drawn / 2 - 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.7)',
  },
});
