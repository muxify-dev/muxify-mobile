import { useRef } from 'react';
import { StyleSheet } from 'react-native';

import {
  BottomSheet, Button, DisclosureGroup, Form, Group, Host, Section, Toggle, VStack,
} from '@expo/ui/swift-ui';
import {
  background, disabled, environment, listRowBackground, padding, presentationBackground, presentationDetents,
  presentationDragIndicator, scrollContentBackground, tint,
} from '@expo/ui/swift-ui/modifiers';

import { optionGroups, type OptionsEntry } from '@/lib/options-table';
import { useSettings } from '@/settings/settings-context';

import type { OptionsItem } from './terminal-header';
import { SheetHeader } from './sheet-chrome';
import { SHEET_PADDING } from './sheet-layout';

/**
 * The Options table as a sheet, for the Grip's Options action. The header's ⋯
 * is a native bar button menu, which iOS gives no way to open from code, so
 * the Grip shows the same table here: the same groups and submenus, from the
 * same `items`, so the two cannot drift.
 *
 * A pick closes the sheet, and the entry runs once the sheet is fully gone,
 * so an Alert or the keyboard that it raises does not fight the dismissal.
 */
export function OptionsSheet({ isPresented, items, onClose }: {
  isPresented: boolean;
  items: readonly OptionsItem[];
  onClose: () => void;
}) {
  const { appearance, palette: chrome, sheetPalette: palette } = useSettings();
  const picked = useRef<(() => void) | null>(null);
  const pick = (run: () => void) => {
    picked.current = run;
    onClose();
  };
  const row = [listRowBackground(palette.tile)];

  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose();
        }}
        onDismiss={() => {
          const run = picked.current;
          picked.current = null;
          run?.();
        }}>
        <Group
          modifiers={[
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('hidden'),
            environment('colorScheme', appearance),
            presentationBackground(palette.sheet),
          ]}>
          <VStack spacing={0} modifiers={[padding({ all: SHEET_PADDING })]}>
            <SheetHeader title="Options" onDismiss={onClose} />
            <Form modifiers={[scrollContentBackground('hidden'), background(palette.sheet), tint(chrome.controlAccent)]}>
              {optionGroups(items).map((group) => (
                <Section key={group.id} modifiers={row}>
                  {group.items.map((item) => <OptionRow key={item.id} item={item} pick={pick} />)}
                </Section>
              ))}
            </Form>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function OptionRow({ item, pick }: { item: OptionsEntry; pick: (run: () => void) => void }) {
  switch (item.kind) {
    case 'action':
      return (
        <Button
          label={item.label}
          systemImage={item.systemImage}
          role={item.destructive ? 'destructive' : undefined}
          onPress={() => pick(item.run)}
          modifiers={[disabled(item.disabled ?? false)]}
        />
      );
    case 'toggle':
      return (
        <Toggle
          label={item.label}
          systemImage={item.systemImage}
          isOn={item.isOn}
          onIsOnChange={(on) => pick(() => item.set(on))}
        />
      );
    case 'menu':
      return (
        <DisclosureGroup label={item.label}>
          {item.items.flatMap((inner) => inner.kind === 'divider' ? [] : [<OptionRow key={inner.id} item={inner} pick={pick} />])}
        </DisclosureGroup>
      );
  }
}

const styles = StyleSheet.create({ host: { position: 'absolute', width: 0, height: 0 } });
