import { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { BottomSheet, Group, Host, HStack, ScrollView, Text, VStack } from '@expo/ui/swift-ui';
import {
  environment,
  font,
  foregroundColor,
  frame,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';

import type { FillChoices } from '@/domain/host-screen-move';
import { useSettings } from '@/settings/settings-context';

import { HostScreenRowView, type RowActions, type TopicRow } from './host-screen-row-view';
import { SheetHeader, SheetNote } from './sheet-chrome';
import { HEADER_TO_CONTENT, SHEET_PADDING } from './sheet-layout';

/**
 * The Topics that can fill an Open Place, opened by a tap on it. The cards look
 * as they do on the Host Screen, and a tap on one fills the place with it.
 */
export function FillPlaceSheet({
  choices,
  onPick,
  onDismiss,
}: {
  /** Null while the sheet is closed. */
  choices: FillChoices | null;
  onPick: (row: TopicRow) => void;
  onDismiss: () => void;
}) {
  const { appearance, palette: chrome, sheetPalette: palette } = useSettings();
  const screen = useWindowDimensions();
  const [openedAt] = useState(() => new Date());
  const height = screen.height * 0.65;
  const groups = choices === null ? [] : [
    { title: 'Guests', rows: choices.guests },
    { title: 'Bench', rows: choices.bench },
  ].filter((group) => group.rows.length > 0);
  const actions: RowActions = { onOpenTopic: onPick, onOpenSession: () => {}, onToggle: () => {}, onRetry: () => {} };

  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={choices !== null}
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
            <SheetHeader title="Fill Open Place" onDismiss={onDismiss} />
            <VStack spacing={0} alignment="leading" modifiers={[padding({ top: HEADER_TO_CONTENT })]}>
              {groups.length === 0 ? <SheetNote palette={palette}>No Guest or Benched Topics</SheetNote> : null}
              <ScrollView>
                <VStack spacing={0} alignment="leading">
                  {groups.map((group) => (
                    <VStack key={group.title} spacing={0} alignment="leading">
                      <Text
                        modifiers={[
                          font({ size: 13, weight: 'semibold' }),
                          foregroundColor(palette.secondary),
                          padding({ vertical: 8 }),
                        ]}>
                        {group.title}
                      </Text>
                      {group.rows.map((row) => (
                        <HStack key={row.id} modifiers={[frame({ minHeight: 56 })]}>
                          <HostScreenRowView row={row} palette={chrome} openedAt={openedAt} actions={actions} />
                        </HStack>
                      ))}
                    </VStack>
                  ))}
                </VStack>
              </ScrollView>
            </VStack>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
