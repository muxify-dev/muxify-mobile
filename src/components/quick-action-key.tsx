import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';

import type { Appearance } from '@/constants/app-theme';
import type { QuickAction, QuickActionKey as QuickActionModifier } from '@/lib/quick-actions';

export interface QuickActionTile {
  id: QuickAction;
  chord: string;
  label: string;
}

const CELL_WIDTH = 100;
const CELL_HEIGHT = 46;
const GAP = 4;
const PAD = 4;
const GRID_WIDTH = CELL_WIDTH * 2 + GAP + PAD * 2;
const GRID_HEIGHT = CELL_HEIGHT * 2 + GAP + PAD * 2;
const GRID_TOP = -GRID_HEIGHT - 8;

type Touch =
  | { phase: 'waiting'; timer: ReturnType<typeof setTimeout>; x: number; y: number }
  | { phase: 'open'; left: number; top: number };

function tileAt(x: number, y: number) {
  const col = Math.floor(x / (CELL_WIDTH + GAP));
  const row = Math.floor(y / (CELL_HEIGHT + GAP));
  if (col < 0 || col > 1 || row < 0 || row > 1 ||
      x % (CELL_WIDTH + GAP) >= CELL_WIDTH || y % (CELL_HEIGHT + GAP) >= CELL_HEIGHT) return -1;
  return row * 2 + col;
}

export function QuickActionKey({
  label, modifier, tiles, disabled, held, palette, style, keyWidth, onTap, onOpen, onSelect, children,
}: {
  label: string;
  modifier: QuickActionModifier;
  tiles: readonly (QuickActionTile | null)[];
  disabled: boolean;
  held: boolean;
  palette: Pick<Appearance, 'rowSurface' | 'toolbarTint' | 'background' | 'controlAccent'>;
  style: ViewStyle;
  keyWidth: number;
  onTap: () => void;
  onOpen: () => void;
  onSelect: (id: QuickAction) => void;
  children: ReactNode;
}) {
  const touch = useRef<Touch | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  // Each modifier is one key in from the end of the row.
  const gridLeft = modifier === 'ctrl' ? -keyWidth : keyWidth * 2 - GRID_WIDTH;
  const cancel = () => {
    if (touch.current?.phase === 'waiting') clearTimeout(touch.current.timer);
    touch.current = null;
    setHighlight(null);
  };
  useLayoutEffect(() => () => {
    if (touch.current?.phase === 'waiting') clearTimeout(touch.current.timer);
    touch.current = null;
  }, []);

  const begin = ({ nativeEvent }: GestureResponderEvent) => {
    cancel();
    if (disabled) return;
    const { pageX, pageY, locationX, locationY } = nativeEvent;
    const timer = setTimeout(() => {
      if (!tiles.some(Boolean)) {
        touch.current = null;
        return;
      }
      touch.current = { phase: 'open', left: pageX - locationX + gridLeft + PAD,
        top: pageY - locationY + GRID_TOP + PAD };
      setHighlight(-1);
      onOpen();
    }, 350);
    touch.current = { phase: 'waiting', timer, x: pageX, y: pageY };
  };
  const track = ({ nativeEvent }: GestureResponderEvent, release: boolean) => {
    const current = touch.current;
    if (!current || disabled) return;
    const { pageX, pageY } = nativeEvent;
    if (current.phase === 'waiting') {
      const moved = Math.hypot(pageX - current.x, pageY - current.y) > 12;
      if (release || moved) cancel();
      if (release && !moved) onTap();
      return;
    }
    const index = tileAt(pageX - current.left, pageY - current.top);
    if (release) {
      cancel();
      const tile = tiles[index];
      if (tile) onSelect(tile.id);
    } else {
      setHighlight(tiles[index] ? index : -1);
    }
  };

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: held }}
      onAccessibilityTap={disabled ? undefined : onTap}
      accessibilityActions={[{ name: 'activate' }, ...tiles.flatMap(tile =>
        tile ? [{ name: tile.id, label: tile.label + ', ' + tile.chord }] : [])]}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (disabled) return;
        if (actionName === 'activate') onTap();
        else {
          const tile = tiles.find(item => item?.id === actionName);
          if (tile) onSelect(tile.id);
        }
      }}
      onStartShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={begin}
      onResponderMove={event => track(event, false)}
      onResponderRelease={event => track(event, true)}
      onResponderTerminate={cancel}
      style={[style, disabled && { opacity: 0.35 }, highlight !== null && { zIndex: 1 }]}>
      <View pointerEvents="none" style={styles.face}>{children}</View>
      {highlight !== null && (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.grid, { left: gridLeft, backgroundColor: palette.background }]}>
          {tiles.map((tile, index) => (
            <View key={index} style={[styles.tile, tile && {
              backgroundColor: palette.rowSurface,
              borderColor: index === highlight ? palette.controlAccent : 'transparent',
            }]}>
              {tile && <>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.chord, { color: palette.toolbarTint }]}>{tile.chord}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.label, { color: palette.toolbarTint }]}>{tile.label}</Text>
              </>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  grid: {
    position: 'absolute', top: GRID_TOP, width: GRID_WIDTH, height: GRID_HEIGHT,
    borderRadius: 12, flexDirection: 'row', flexWrap: 'wrap', padding: PAD, gap: GAP,
  },
  tile: {
    width: CELL_WIDTH, height: CELL_HEIGHT, borderWidth: 2, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2,
  },
  chord: { fontSize: 17, fontWeight: '600' },
  label: { fontSize: 12 },
});
