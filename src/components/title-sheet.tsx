import {
  BottomSheet,
  Button,
  Group,
  Host,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  cornerRadius,
  environment,
  font,
  foregroundColor,
  frame,
  lineLimit,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { tabAddress, tabLabel, type BrowserTab } from '@/browser/tabs';
import type { Appearance, SheetPalette } from '@/constants/app-theme';
import { countTitleRows, type TitleRow, type TitleWindowRow } from '@/domain/title-rows';
import type { TopicDetail } from '@/topics/topic-detail';
import { useSettings } from '@/settings/settings-context';

import { SheetHeader, SheetNote } from './sheet-chrome';
import { MarkImage } from './topic-marks';
import {
  gridContentHeight,
  HEADER_HEIGHT,
  HEADER_TO_CONTENT,
  SAFE_BOTTOM,
  SHEET_PADDING,
} from './sheet-layout';

/**
 * What a tap on a row asks for: a Session by name, or null for the attached
 * one, and one of its Windows when a Window row was tapped.
 */
export interface TitlePick {
  session: string | null;
  window: number | null;
}

export interface TitleSheetProps {
  isPresented: boolean;
  onDismiss: () => void;
  rows: TitleRow[];
  topic?: TopicDetail | null;
  onRetry?: () => void;
  /** A Topic read in flight with nothing read before it. */
  loading: boolean;
  error?: string;
  /** Opens the Sessions picker in this sheet's place. */
  onSwitch: () => void;
  onPick: (pick: TitlePick) => void;
  /** The Browser Tabs of the Window on screen that the phone can open. */
  tabs: BrowserTab[];
  onOpenTab: (tab: BrowserTab) => void;
}

/** The sheet's name, which its close button carries. */
const TITLE = 'Windows';
const ROW_HEIGHT = 44;
const SWITCH_ROW_HEIGHT = 44;
const TABS_HEADER_HEIGHT = 36;

/**
 * The sheet the header's title opens: the Windows of the attached Session, or
 * each live Session of the Topic with its Windows, and Switch… at the top for
 * every other Session of the Host. Under them, the Browser Tabs of the Window
 * on screen, when the Host has some at a Tailscale address.
 *
 * Rows rather than previews. The old Windows picker drew a capture of each
 * Window, and a row of name, program and Agent mark says more in less: which
 * Window has the editor, which one the Agent is working in. The Sessions
 * picker keeps its previews, because Sessions have no program line.
 *
 * Rows are Buttons rather than List selection, as in the pickers: a tap is a
 * one-shot command to the Host, not state the sheet owns, and a Button is the
 * one form that carries a pressable label through the SwiftUI hosting
 * boundary into the accessibility tree.
 */
export function TitleSheet({
  isPresented,
  onDismiss,
  rows,
  topic,
  onRetry,
  loading,
  error,
  onSwitch,
  onPick,
  tabs,
  onOpenTab,
}: TitleSheetProps) {
  const { appearance, palette: chrome, sheetPalette: palette } = useSettings();
  const screen = useWindowDimensions();
  const height = topic ? screen.height * 0.65 : titleSheetHeight(countTitleRows(rows), tabs.length, screen.height);

  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group
          modifiers={[
            presentationDetents([{ height }, 'large'], { selection: { height } }),
            presentationDragIndicator('hidden'),
            environment('colorScheme', appearance),
            presentationBackground(palette.sheet),
          ]}>
          <VStack
            spacing={0}
            modifiers={[padding({ all: SHEET_PADDING }), frame({ minWidth: 0, maxWidth: Infinity })]}>
            <SheetHeader title={TITLE} onDismiss={onDismiss} />

            <VStack spacing={0} alignment="leading" modifiers={[padding({ top: HEADER_TO_CONTENT })]}>
              <Button
                onPress={onSwitch}
                modifiers={[buttonStyle('plain'), accessibilityLabel('Switch…')]}>
                <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, height: SWITCH_ROW_HEIGHT })]}>
                  <Image systemName="plus" size={17} color={palette.accent} />
                  <Text modifiers={[font({ size: 17 }), foregroundColor(palette.accent)]}>Switch…</Text>
                  <Spacer />
                </HStack>
              </Button>

              {error !== undefined ? (
                <Text modifiers={[foregroundColor(chrome.destructive), padding({ vertical: 8 })]}>
                  {error}
                </Text>
              ) : null}
              {error !== undefined && onRetry ? <Button label="Retry" onPress={onRetry} modifiers={[accessibilityLabel('Retry')]} /> : null}
              {loading && rows.length === 0 ? (
                <SheetNote palette={palette}>Reading…</SheetNote>
              ) : null}
              {!loading && rows.length === 0 && error === undefined ? (
                <SheetNote palette={palette}>No Windows</SheetNote>
              ) : null}

              {topic || rows.length > 0 || tabs.length > 0 ? (
                <ScrollView>
                  <VStack spacing={0} alignment="leading">
                    {topic ? <VStack spacing={6} alignment="leading" modifiers={[padding({ vertical: 12 })]}>
                      <Text modifiers={[font({ size: 20, weight: 'semibold' }), foregroundColor(palette.primary)]}>{topic.label}</Text>
                      {topic.note ? <Text modifiers={[foregroundColor(palette.secondary), accessibilityLabel(`Note ${topic.note}`)]}>{topic.note}</Text> : null}
                      {topic.tags.length ? <Text modifiers={[foregroundColor(palette.secondary)]}>{topic.tags.map((tag) => `#${tag}`).join('  ')}</Text> : null}
                    </VStack> : null}
                    {rows.map((row) =>
                      row.kind === 'window' ? (
                        <WindowRow
                          key={row.index}
                          row={row}
                          palette={palette}
                          chrome={chrome}
                          onPress={() => onPick({ session: null, window: row.index })}
                        />
                      ) : (
                        <VStack key={row.name} spacing={0} alignment="leading">
                          <Button
                            onPress={() => onPick({ session: row.name, window: null })}
                            modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
                            <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, height: ROW_HEIGHT })]}>
                              <Image
                                systemName="terminal"
                                size={17}
                                color={row.current ? palette.accent : palette.secondary}
                              />
                              <Text
                                modifiers={[
                                  font({ size: 17, weight: 'semibold' }),
                                  foregroundColor(row.current ? palette.accent : palette.primary),
                                ]}>
                                {row.name}
                              </Text>
                              <Spacer />
                            </HStack>
                          </Button>
                          {row.windows.map((window) => (
                            <WindowRow
                              key={window.index}
                              row={window}
                              palette={palette}
                              chrome={chrome}
                              indented
                              onPress={() => onPick({ session: row.name, window: window.index })}
                            />
                          ))}
                        </VStack>
                      ),
                    )}
                    {tabs.length > 0 ? (
                      <HStack modifiers={[frame({ maxWidth: Infinity, height: TABS_HEADER_HEIGHT })]}>
                        <Text
                          modifiers={[font({ size: 13, weight: 'semibold' }), foregroundColor(palette.secondary)]}>
                          Browser tabs
                        </Text>
                        <Spacer />
                      </HStack>
                    ) : null}
                    {tabs.map((tab) => (
                      <TabRow key={tab.id} tab={tab} palette={palette} onPress={() => onOpenTab(tab)} />
                    ))}
                  </VStack>
                </ScrollView>
              ) : null}
            </VStack>

            <Spacer />
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/** Index badge, name, program, and the Agent mark; the Window on screen in the accent. */
function WindowRow({
  row,
  palette,
  chrome,
  indented,
  onPress,
}: {
  row: TitleWindowRow;
  palette: SheetPalette;
  chrome: Appearance;
  indented?: boolean;
  onPress: () => void;
}) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(row.name)]}>
      <HStack
        spacing={10}
        modifiers={[
          frame({ maxWidth: Infinity, height: ROW_HEIGHT }),
          padding({ leading: indented ? 28 : 0 }),
        ]}>
        <Text
          modifiers={[
            font({ size: 12, weight: 'bold' }),
            frame({ width: 24, height: 24 }),
            foregroundColor(row.current ? '#ffffff' : palette.primary),
            background(row.current ? palette.accent : palette.well),
            cornerRadius(6),
          ]}>
          {String(row.index)}
        </Text>
        <Text
          modifiers={[
            font({ size: 17 }),
            foregroundColor(row.current ? palette.accent : palette.primary),
          ]}>
          {row.name}
        </Text>
        {row.program === null ? null : (
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondary)]}>
            {row.program}
          </Text>
        )}
        <Spacer />
        {row.mark === null ? null : <MarkImage mark={row.mark} palette={chrome} />}
      </HStack>
    </Button>
  );
}

/** A globe, the page's title and its address; the Tab that the Browser shows in the accent. */
function TabRow({ tab, palette, onPress }: { tab: BrowserTab; palette: SheetPalette; onPress: () => void }) {
  const label = tabLabel(tab);
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(`Tab ${label}`)]}>
      <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, height: ROW_HEIGHT })]}>
        <Image systemName="globe" size={17} color={tab.active ? palette.accent : palette.secondary} />
        <Text
          modifiers={[
            font({ size: 17 }),
            lineLimit(1),
            foregroundColor(tab.active ? palette.accent : palette.primary),
          ]}>
          {label}
        </Text>
        <Text modifiers={[font({ size: 13 }), lineLimit(1), foregroundColor(palette.secondary)]}>
          {tabAddress(tab)}
        </Text>
        <Spacer />
      </HStack>
    </Button>
  );
}

/** Every row when they fit, else whole rows and half of the next. See gridContentHeight. */
function titleSheetHeight(rowCount: number, tabCount: number, windowHeight: number): number {
  const chrome =
    SHEET_PADDING * 2 +
    HEADER_HEIGHT +
    HEADER_TO_CONTENT +
    SWITCH_ROW_HEIGHT +
    (tabCount > 0 ? TABS_HEADER_HEIGHT : 0) +
    SAFE_BOTTOM;
  const budget = Math.max(0, windowHeight * 0.9 - chrome);
  const rows = gridContentHeight(
    { count: Math.max(1, rowCount + tabCount), perRow: 1, cardHeight: ROW_HEIGHT, gap: 0 },
    budget,
  );
  return chrome + rows;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
