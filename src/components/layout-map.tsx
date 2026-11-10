import { Pressable, StyleSheet, View } from 'react-native';

import type { SheetPalette } from '@/constants/app-theme';
import { paneTopologyFrames } from '@/tmux/pane-topology';
import type { Pane } from '@/tmux/tmux-client';

/** What the map claims beyond its own edges, to reach 44pt. */
const MAP_SLOP = { top: 8, bottom: 4, left: 8, right: 10 };

/**
 * The Layout map: the Window's Layout in the top right of the Surface, with
 * the active Pane in the accent colour.
 *
 * With Zoom on, one Pane fills the Window and nothing else says that there
 * are more, or which one this is. The map says both, and it moves with a
 * swipe. A tap opens the Panes picker. The tiles are the Panes picker's own
 * diagram, so the two agree on where a Pane sits.
 */
export function LayoutMap({
  panes,
  palette,
  onPress,
}: {
  panes: Pane[];
  palette: SheetPalette;
  onPress: () => void;
}) {
  const frames = paneTopologyFrames(panes);
  const active = panes.find((pane) => pane.active);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={MAP_SLOP}
      accessibilityRole="button"
      accessibilityLabel={
        active ? `Layout map, Pane ${active.index} of ${panes.length}` : 'Layout map'
      }
      style={styles.map}
      testID="layout-map">
      <View
        pointerEvents="none"
        style={[styles.ground, { backgroundColor: palette.sheet, borderColor: palette.stroke }]}
      />
      <View pointerEvents="none" style={styles.board}>
        {panes.map((pane) => {
          const frame = frames.get(pane.index);
          if (!frame) return null;
          return (
            <View
              key={pane.id}
              style={[
                styles.cell,
                {
                  left: `${frame.x * 100}%`,
                  top: `${frame.y * 100}%`,
                  width: `${frame.width * 100}%`,
                  height: `${frame.height * 100}%`,
                },
              ]}>
              <View
                style={[
                  styles.tile,
                  { backgroundColor: pane.active ? palette.accent : palette.tile },
                ]}
              />
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 54,
    height: 40,
  },
  // Not quite opaque, so the output under the map still shows that it is there.
  ground: {
    ...StyleSheet.absoluteFill,
    borderRadius: 7,
    borderWidth: 1,
    opacity: 0.82,
  },
  board: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    right: 3,
  },
  cell: {
    position: 'absolute',
    padding: 0.75,
  },
  tile: {
    flex: 1,
    borderRadius: 2,
  },
});
