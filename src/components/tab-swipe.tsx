import { requireNativeView } from 'expo';
import { swipeTick } from 'expo-libghostty';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { isPastCommit, swipeOf } from '@/lib/pan-axis';
import { neighbourTab, tabSwipeOffset } from '@/lib/tab-swipe';
import { BACK_EDGE } from '@/navigation/back-swipe';

type TabSwipeEvent = {
  phase: 'began' | 'changed' | 'ended' | 'cancelled';
  /** How far the finger is from where the drag began, in points, signed as it moved. */
  translation: number;
  /** How fast it is going sideways, in points a second. */
  velocity: number;
};

type NativeProps = ViewProps & {
  enabled: boolean;
  backEdge: number;
  onTabSwipe(event: NativeSyntheticEvent<TabSwipeEvent>): void;
};

const NativeTabSwipe: ComponentType<NativeProps> = requireNativeView('TabSwipe');

// The Pane Swipe's: see use-pane-swipe.ts.
const SLIDE = { duration: 180, easing: Easing.out(Easing.cubic) };
const SPRING_BACK = { mass: 1, stiffness: 320, damping: 36 };

/**
 * A screen's tabs side by side, and a swipe between them that starts on
 * `header` or on the screen's bar at the bottom.
 *
 * The rows keep their own swipe actions, and a drag right on them goes back.
 * The tabs are one strip that follows the finger. Past the commit point the
 * phone ticks and `header` gets the tab the swipe goes to, so a segmented
 * control there changes with the tick. A tap that changes `tab` slides the
 * strip too. Only `tab` is in the accessibility tree.
 */
export function TabSwipe<T extends string>({
  tabs,
  tab,
  enabled,
  onSwitch,
  header,
  renderTab,
}: {
  tabs: readonly T[];
  tab: T;
  /** Whether a swipe may change the tab now. */
  enabled: boolean;
  onSwitch: (next: T) => void;
  /** What sits above the strip and does not move, given the tab to show as chosen. A swipe on it changes the tab. */
  header: (shown: T) => ReactNode;
  renderTab: (each: T) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  /**
   * The tab a drag past the commit point would go to, or null short of it.
   * The ref is what the gesture reads, so one crossing ticks once; the state
   * is what the header shows.
   */
  const toward = useRef<T | null>(null);
  const [shownToward, setShownToward] = useState<T | null>(null);
  const aim = (next: T | null) => {
    toward.current = next;
    setShownToward(next);
  };
  const index = Math.max(0, tabs.indexOf(tab));

  // Only a change of tab between the same tabs slides. A new width, or tabs
  // that came or went with a read of the Host, put the strip in place.
  const tabsKey = tabs.join(' ');
  const placed = useRef({ width, tabsKey });
  useEffect(() => {
    const place = -index * width;
    const same = placed.current.width === width && placed.current.tabsKey === tabsKey;
    x.set(same ? withTiming(place, SLIDE) : place);
    placed.current = { width, tabsKey };
  }, [x, index, width, tabsKey]);

  const settle = (next: T | null) => {
    aim(null);
    if (next === null) {
      x.set(withSpring(-index * width, SPRING_BACK));
      return;
    }
    x.set(withTiming(-tabs.indexOf(next) * width, SLIDE));
    onSwitch(next);
  };

  const onTabSwipe = ({ nativeEvent: { phase, translation, velocity } }: NativeSyntheticEvent<TabSwipeEvent>) => {
    if (width <= 0) return;
    const next = neighbourTab(tabs, tab, translation < 0 ? 'left' : 'right');
    switch (phase) {
      case 'began':
      case 'changed': {
        x.set(-index * width + tabSwipeOffset(translation, width, next !== null));
        const past = next !== null && isPastCommit(translation, width) ? next : null;
        if (past !== toward.current) {
          swipeTick();
          aim(past);
        }
        break;
      }
      case 'ended': {
        const direction = swipeOf(translation, width, velocity);
        settle(direction === null ? null : neighbourTab(tabs, tab, direction));
        break;
      }
      case 'cancelled':
        settle(null);
        break;
    }
  };

  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View style={styles.fill}>
      <NativeTabSwipe enabled={enabled && tabs.length > 1} backEdge={BACK_EDGE} onTabSwipe={onTabSwipe}>
        {header(shownToward ?? tab)}
      </NativeTabSwipe>
      <View style={styles.window} onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
        <Animated.View style={[styles.strip, { width: width * tabs.length }, strip]}>
          {tabs.map((each) => (
            <View
              key={each}
              style={{ width }}
              accessibilityElementsHidden={each !== tab}
              importantForAccessibility={each === tab ? 'auto' : 'no-hide-descendants'}>
              {renderTab(each)}
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  window: { flex: 1, overflow: 'hidden' },
  strip: { flex: 1, flexDirection: 'row' },
});
