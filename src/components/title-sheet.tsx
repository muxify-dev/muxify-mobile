import { useEffect, useState } from 'react';

import {
  BottomSheet,
  Button,
  Group,
  Host,
  HStack,
  Image,
  Picker,
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
  pickerStyle,
  tag,
  onGeometryChange,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { tabAddress, tabLabel, type BrowserTab } from '@/browser/tabs';
import type { Appearance, SheetPalette } from '@/constants/app-theme';
import type { TitleRow, TitleWindowRow } from '@/domain/title-rows';
import { HostScreenRowView, rowKey, type TopicRow } from './host-screen-row-view';
import type { HostScreenSection } from '@/domain/host-screen';
import { SessionPreviews, type PreviewCard } from './picker-sheet';
import { TAPPABLE_ROW } from './tappable-row';
import type { TopicDetail } from '@/topics/topic-detail';
import { CHOOSER_LIST_NAMES, type ChooserList, type ChooserLists } from '@/settings/settings';
import { useSettings } from '@/settings/settings-context';

import { SheetHeader, SheetNote } from './sheet-chrome';
import { MarkImage } from './topic-marks';
import { HEADER_TO_CONTENT, SHEET_PADDING } from './sheet-layout';

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
  lists: ChooserLists;
  onDismiss: () => void;
  rows: TitleRow[];
  topic?: TopicDetail | null;
  onRetry?: () => void;
  /** A Topic read in flight with nothing read before it. */
  loading: boolean;
  error?: string;
  sessions: { cards: PreviewCard[]; loading: boolean; onSelect: (id: string) => void };
  topics?: SheetTopics;
  onPick: (pick: TitlePick) => void;
  /** The Browser Tabs of the Window on screen that the phone can open. */
  tabs: BrowserTab[];
  onOpenTab: (tab: BrowserTab) => void;
}

export interface SheetTopics {
  sections: HostScreenSection[];
  palette: Appearance;
  onOpenTopic: (row: TopicRow) => void;
  onRetry: () => void;
}

const ROW_HEIGHT = 44;
const TABS_HEADER_HEIGHT = 36;

export function TitleSheet({
  isPresented,
  lists,
  onDismiss,
  rows,
  topic,
  onRetry,
  loading,
  error,
  sessions,
  topics,
  onPick,
  tabs,
  onOpenTab,
}: TitleSheetProps) {
  const { appearance, palette: chrome, sheetPalette: palette } = useSettings();
  const screen = useWindowDimensions();
  const [selected, setSelectedTab] = useState<ChooserList>(lists[0]);
  const selectedTab = isPresented && lists.includes(selected) ? selected : lists[0];
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [openedAt] = useState(() => new Date());
  useEffect(() => { setSelectedTab(lists[0]); }, [isPresented, lists]);
  const height = screen.height * 0.65;

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
            modifiers={[
              padding({ all: SHEET_PADDING }),
              frame({ minWidth: 0, maxWidth: Infinity }),
              onGeometryChange(({ width }) => { if (width > 0) setMeasuredWidth(width); }),
            ]}>
            <SheetHeader title="Choose" onDismiss={onDismiss} />

            <VStack spacing={0} alignment="leading" modifiers={[padding({ top: HEADER_TO_CONTENT })]}>
              {lists.length > 1 ? <Picker
                selection={selectedTab}
                onSelectionChange={setSelectedTab}
                modifiers={[pickerStyle('segmented'), accessibilityLabel('Terminal chooser'), padding({ bottom: 12 })]}>
                {lists.map((list) => <Text key={list} modifiers={[tag(list)]}>{CHOOSER_LIST_NAMES[list]}</Text>)}
              </Picker> : null}

              {error !== undefined ? (
                <Text modifiers={[foregroundColor(chrome.destructive), padding({ vertical: 8 })]}>
                  {error}
                </Text>
              ) : null}
              {error !== undefined && onRetry ? <Button label="Retry" onPress={onRetry} modifiers={[accessibilityLabel('Retry')]} /> : null}
              {selectedTab === 'sessions' && <>
                {sessions.loading && sessions.cards.length === 0 ? <SheetNote palette={palette}>Reading…</SheetNote> : null}
                {!sessions.loading && sessions.cards.length === 0 ? <SheetNote palette={palette}>No Sessions</SheetNote> : null}
                <ScrollView>
                  <SessionPreviews cards={sessions.cards} width={measuredWidth ?? screen.width} onSelect={sessions.onSelect} />
                </ScrollView>
              </>}
              {selectedTab === 'topics' && <ScrollView>
                <VStack spacing={0} alignment="leading">
                  {topics && topics.sections.length === 0 ? <SheetNote palette={palette}>No Topics</SheetNote> : null}
                  {topics?.sections.map((section) => <VStack key={section.id} spacing={0} alignment="leading">
                    {section.title ? <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundColor(palette.secondary), padding({ vertical: 8 })]}>{section.title}</Text> : null}
                    {section.rows.map((row, index) => <HStack key={rowKey(row, index)} modifiers={[frame({ minHeight: 56 })]}>
                      <HostScreenRowView row={row} palette={topics.palette} openedAt={openedAt} actions={{
                        onOpenTopic: topics.onOpenTopic,
                        onRetry: topics.onRetry,
                        onOpenSession: () => {},
                        onToggle: () => {},
                      }} />
                    </HStack>)}
                  </VStack>)}
                </VStack>
              </ScrollView>}
              {selectedTab === 'windows' && <>
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
                              <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, height: ROW_HEIGHT }), TAPPABLE_ROW]}>
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
              </>}
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
          TAPPABLE_ROW,
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
      <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, height: ROW_HEIGHT }), TAPPABLE_ROW]}>
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

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
