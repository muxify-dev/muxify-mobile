import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';
import { bytesToBase64, utf8ToBytes } from '@/lib/base64';

/** CSI introducer (ESC + '['), built from a char code so the source carries
 * no invisible control bytes. */
const CSI = String.fromCharCode(27) + '[';

/** The Surface's cell grid. Travels as a unit everywhere it is used. */
type Grid = { cols: number; rows: number };

/**
 * Canned output standing in for a Shell Channel until ticket 04 wires SSH.
 *
 * Exercises what the Surface has to get right: text, the full ANSI colour
 * range, absolute cursor positioning, and multi-byte UTF-8. All of it goes
 * through `write()` as raw bytes — the path tickets 04 and 05 must use — rather
 * than through `writeText()`, so the byte path is what actually gets proven.
 */
function demoOutput({ cols, rows }: Grid): string {
  const rule = '-'.repeat(Math.max(0, Math.min(cols, 40) - 2));

  const swatch = (offset: number) =>
    Array.from({ length: 8 }, (_, i) => `${CSI}${offset + i}m  ${CSI}0m`).join('');

  return [
    `${CSI}2J${CSI}H`, // clear screen, cursor home
    `${CSI}1;36m+${rule}+${CSI}0m\r\n`,
    `${CSI}1;36m|${CSI}0m ${CSI}1mmuxify${CSI}0m -- Surface smoke test\r\n`,
    `${CSI}1;36m+${rule}+${CSI}0m\r\n\r\n`,
    `  grid    ${CSI}33m${cols}${CSI}0m x ${CSI}33m${rows}${CSI}0m cells\r\n\r\n`,
    `  normal  ${swatch(40)}\r\n`,
    `  bright  ${swatch(100)}\r\n\r\n`,
    `  ${CSI}1mbold${CSI}0m ${CSI}2mdim${CSI}0m ${CSI}3mitalic${CSI}0m ${CSI}4munderline${CSI}0m ${CSI}7mreverse${CSI}0m\r\n\r\n`,
    `  utf-8   ünïcödé ✓ 日本語 ✓ ▁▃▅▇█\r\n\r\n`,
    `${CSI}16;3H${CSI}32m*${CSI}0m cursor addressed to row 16, col 3\r\n`,
  ].join('');
}

export default function TerminalScreen() {
  const surface = useRef<TerminalViewRef>(null);
  const [grid, setGrid] = useState<Grid | null>(null);

  const handleResize = useCallback(({ nativeEvent }: { nativeEvent: Grid }) => {
    const next: Grid = { cols: nativeEvent.cols, rows: nativeEvent.rows };
    setGrid(next);

    // Redraw on every resize, not just the first. The first event is a
    // pre-layout measurement and reports a grid the Surface never settles at,
    // so drawing once would leave stale dimensions on screen. Ticket 05 must
    // size the remote terminal from the latest event for the same reason.
    surface.current?.write(bytesToBase64(utf8ToBytes(demoOutput(next))));
  }, []);

  const handleInput = useCallback(({ nativeEvent }: { nativeEvent: { data: string } }) => {
    // Ticket 04 forwards these bytes to the Shell Channel. Echo locally for now
    // so the keyboard and the library's Accessory Bar are demonstrably wired.
    // `data` is base64; the sibling `text` field must not be used.
    surface.current?.write(nativeEvent.data);
  }, []);

  return (
    <View style={styles.container}>
      <TerminalView
        ref={surface}
        style={styles.surface}
        fontSize={13}
        theme={{
          background: SurfacePalette.background,
          foreground: SurfacePalette.foreground,
          cursorColor: SurfacePalette.cursor,
        }}
        onResize={handleResize}
        onInput={handleInput}
      />
      {/* Only rendered once the Surface has reported a grid, so its presence is
          the e2e signal that layout and `onResize` completed. The value is
          device-specific; tests should select on the id, not the text. */}
      {grid ? (
        <ThemedText type="code" style={styles.status} testID="surface-grid">
          {grid.cols}x{grid.rows}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SurfacePalette.background,
  },
  surface: {
    flex: 1,
  },
  status: {
    position: 'absolute',
    top: 8,
    right: 12,
    color: SurfacePalette.dim,
  },
});
