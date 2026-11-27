import { Button, Form, Host, LabeledContent, List, Picker, Section, Text } from '@expo/ui/swift-ui';
import {
  background, environment, listRowBackground, pickerStyle, scrollContentBackground, tag, tint,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import { SectionHeader } from '@/components/section-header';
import {
  DEFAULT_GRIP_ACTIONS, DESTINATIONS_ACTION, GRIP_ACTION_IDS, GRIP_ACTIONS, gripActionSlots, type GripActionId,
} from '@/lib/grip-actions';
import { moved } from '@/settings/settings';
import { useSettings } from '@/settings/settings-context';

const POSITIONS = ["11 o'clock", "10 o'clock", "9 o'clock"];

/** Chooses the three Grip actions of the Fan beside Destinations, as Quick Actions chooses a Key Row's. */
export default function GripActionsScreen() {
  const { settings, update, appearance, palette } = useSettings();
  const slots = settings.gripActions ?? DEFAULT_GRIP_ACTIONS;
  const save = (items: readonly (GripActionId | null)[]) => update({ gripActions: gripActionSlots(items) });
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
        <Section
          header={<SectionHeader palette={palette}>Fan slots</SectionHeader>}
          footer={
            <Text>
              Hold the button at the right edge, slide to a slot and lift to run its action. Straight up is
              always Destinations. Drag a handle to reorder the others. An empty slot stays empty.
            </Text>
          }
          modifiers={row}>
          <LabeledContent label="12 o'clock">
            <Text>{DESTINATIONS_ACTION.title}</Text>
          </LabeledContent>
          <List.ForEach onMove={(sources, destination) => save(moved(slots, sources, destination))}>
            {slots.map((action, index) => {
              const choices = GRIP_ACTION_IDS.filter((item) => item === action || !slots.includes(item));
              return (
                <Picker
                  key={action ?? `empty-${index}`}
                  label={POSITIONS[index]}
                  selection={action ?? 'empty'}
                  onSelectionChange={(value) => {
                    const selected = choices.find((item) => item === value);
                    if (selected || value === 'empty') {
                      save(slots.map((other, at) => (at === index ? selected ?? null : other)));
                    }
                  }}
                  modifiers={[pickerStyle('menu')]}>
                  <Text modifiers={[tag('empty')]}>Empty</Text>
                  {choices.map((item) => (
                    <Text key={item} modifiers={[tag(item)]}>{GRIP_ACTIONS[item].title}</Text>
                  ))}
                </Picker>
              );
            })}
          </List.ForEach>
        </Section>
        <Section modifiers={row}>
          <Button label="Restore defaults" onPress={() => save(DEFAULT_GRIP_ACTIONS)} />
        </Section>
      </Form>
    </Host>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
