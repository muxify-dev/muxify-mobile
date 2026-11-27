import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import type { FanItem } from '@/lib/grip-actions';
import { FAN_SLOT_SIZE, FAN_SLOTS, fanSlotCentre, GRIP_BUTTON, type ActionSlot, type FanSlot } from '@/navigation/grip';
import { useSettings } from '@/settings/settings-context';

const ORIGIN = { x: 0, y: 0 };
const LABEL_BOX_WIDTH = 200;

/**
 * The Fan: the Grip's four slots, as clear-glass circles round the button.
 * The caller puts it `top` points down the area its parent fills, and the
 * slots go out from the button's centre. It takes no touch: the finger that
 * opened it stays with the Grip, which lights a slot by direction (see
 * navigation/grip.ts), so `lit` says which one is.
 *
 * The slots start at the button and grow out to their places. Their glass
 * stays at full opacity: glass under a parent whose opacity is 0 is not drawn.
 */
export function GripFan({ top, items, lit }: { top: number; items: readonly (FanItem | null)[]; lit: ActionSlot | null }) {
  const opening = useSharedValue(0);
  useEffect(() => {
    opening.set(withTiming(1, { duration: 140 }));
  }, [opening]);

  return (
    <View pointerEvents="none" style={[styles.anchor, { top, right: GRIP_BUTTON.inset }]}>
      {FAN_SLOTS.map((slot) => {
        const item = items[slot];
        return item ? <FanSlotView key={slot} slot={slot} item={item} lit={lit === slot} opening={opening} /> : null;
      })}
    </View>
  );
}

function FanSlotView({ slot, item, lit, opening }: {
  slot: FanSlot;
  item: FanItem;
  lit: boolean;
  opening: SharedValue<number>;
}) {
  const { appearance, palette } = useSettings();
  const place = fanSlotCentre(ORIGIN, slot);
  const growing = useAnimatedStyle(() => {
    const progress = opening.get();
    return {
      transform: [
        { translateX: place.x * (progress - 1) },
        { translateY: place.y * (progress - 1) },
        { scale: 0.5 + 0.5 * progress },
      ],
    };
  });
  const lights = lit && !item.dimmed;

  return (
    <Animated.View style={[styles.slot, { left: place.x - FAN_SLOT_SIZE / 2, top: place.y - FAN_SLOT_SIZE / 2 }, growing]}>
      <View style={[styles.circle, { opacity: item.dimmed ? 0.45 : 1 }, lit && styles.lit]}>
        {isGlassEffectAPIAvailable() ? (
          <GlassView style={styles.fill} glassEffectStyle="clear" colorScheme={appearance} />
        ) : (
          <View style={styles.fill} />
        )}
        {/* A dark film under the symbol, so it reads on a white page as well as on the terminal. */}
        <View style={[styles.fill, styles.film]} />
        {lights ? <View style={[styles.fill, { backgroundColor: palette.controlAccent }]} /> : null}
        <View style={[styles.fill, styles.rim]} />
        <View style={styles.symbol}>
          <SymbolView name={item.symbol} size={19} tintColor="#ffffff" />
        </View>
      </View>
      {lit ? (
        <View style={styles.labelBox}>
          <View style={[styles.label, item.dimmed && styles.dimmedLabel]}>
            <Text numberOfLines={1} style={styles.labelText}>{item.title}</Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // No size: its origin is the button's centre, which each slot is placed from.
  anchor: { position: 'absolute', width: 0, height: 0 },
  slot: { position: 'absolute', width: FAN_SLOT_SIZE, height: FAN_SLOT_SIZE },
  circle: {
    width: FAN_SLOT_SIZE,
    height: FAN_SLOT_SIZE,
    borderRadius: FAN_SLOT_SIZE / 2,
    overflow: 'hidden',
  },
  lit: { transform: [{ scale: 1.14 }] },
  fill: { ...StyleSheet.absoluteFill },
  film: { backgroundColor: 'rgba(0, 0, 0, 0.32)' },
  rim: {
    borderRadius: FAN_SLOT_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  symbol: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // To the left of the slot, which the thumb at the right edge does not cover. The box is wide
  // and the pill shrinks to its text: an absolute child of the slot would be as narrow as the slot.
  labelBox: {
    position: 'absolute',
    left: -LABEL_BOX_WIDTH - 10,
    top: (FAN_SLOT_SIZE - 28) / 2,
    width: LABEL_BOX_WIDTH,
    alignItems: 'flex-end',
  },
  label: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 20, 22, 0.82)',
  },
  dimmedLabel: { opacity: 0.6 },
  labelText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
