import { Button, Form, Host, List, Picker, Section, Text } from '@expo/ui/swift-ui';
import {
  background, environment, listRowBackground, pickerStyle, scrollContentBackground, tag, tint,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { SectionHeader } from '@/components/section-header';
import {
  DEFAULT_QUICK_ACTIONS, QUICK_ACTION_CATALOG, quickActionLabel, quickActionSlots,
  type QuickAction, type QuickActionKey,
} from '@/lib/quick-actions';
import { moved } from '@/settings/settings';
import { useSettings } from '@/settings/settings-context';

const POSITIONS = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];

export default function QuickActionsScreen() {
  const { settings, update, appearance, palette } = useSettings();
  const [key, setKey] = useState<QuickActionKey>('ctrl');
  const menus = settings.quickActions ?? DEFAULT_QUICK_ACTIONS;
  const slots = menus[key];
  const save = (items: readonly (QuickAction | null)[]) =>
    update({ quickActions: { ...menus, [key]: quickActionSlots(key, items) } });
  const row = [listRowBackground(palette.rowSurface)];

  return (
    <Host style={styles.fill} matchContents={false}>
      <Form modifiers={[
        environment('colorScheme', appearance),
        environment('editMode', 'active'),
        scrollContentBackground('hidden'),
        background(palette.background),
        tint(palette.controlAccent),
      ]}>
        <Section modifiers={row}>
          <Picker label="Key" selection={key} onSelectionChange={(value) => {
            if (value === 'ctrl' || value === 'cmd') setKey(value);
          }} modifiers={[pickerStyle('segmented')]}>
            <Text modifiers={[tag('ctrl')]}>Control</Text>
            <Text modifiers={[tag('cmd')]}>Command</Text>
          </Picker>
        </Section>
        <Section
          header={<SectionHeader palette={palette}>Grid positions</SectionHeader>}
          footer={<Text>Drag a handle to reorder the actions. An empty position stays empty in the grid.</Text>}
          modifiers={row}>
          <List.ForEach onMove={(sources, destination) => save(moved(slots, sources, destination))}>
            {slots.map((action, index) => {
              const choices = QUICK_ACTION_CATALOG[key].filter((item) => item === action || !slots.includes(item));
              return (
                <Picker
                  key={action ?? `empty-${index}`}
                  label={POSITIONS[index]}
                  selection={action ?? 'empty'}
                  onSelectionChange={(value) => {
                    const selected = choices.find((item) => item === value);
                    if (selected || value === 'empty') {
                      save(slots.map((other, at) => at === index ? selected ?? null : other));
                    }
                  }}
                  modifiers={[pickerStyle('menu')]}>
                  <Text modifiers={[tag('empty')]}>Empty</Text>
                  {choices.map((item) => {
                    const { title, chord } = quickActionLabel(item, settings.keyboardShortcuts);
                    return <Text key={item} modifiers={[tag(item)]}>{`${title} · ${chord}`}</Text>;
                  })}
                </Picker>
              );
            })}
          </List.ForEach>
        </Section>
        <Section modifiers={row}>
          <Button label="Restore defaults" onPress={() => save(DEFAULT_QUICK_ACTIONS[key])} />
        </Section>
      </Form>
    </Host>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
