import { List, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, deleteDisabled, disabled, font, foregroundColor, listRowBackground, moveDisabled, tint } from '@expo/ui/swift-ui/modifiers';
import type { Appearance } from '@/constants/app-theme';
import { SectionHeader } from './section-header';
import { CHOOSER_LIST_NAMES, chooserListRows, moveChooserLists, switchChooserList, type ChooserLists } from '@/settings/settings';

export function ChooserListsSection({ lists, onChange, palette }: {
  lists: ChooserLists;
  onChange: (lists: ChooserLists) => void;
  palette: Appearance;
}) {
  return <Section
    header={<SectionHeader palette={palette}>Title chooser</SectionHeader>}
    footer={<Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
      Choose what opens when you tap the Terminal title. Drag lists to set their order.
      The first list opens first. Keep at least one list on. Sessions includes previews.
    </Text>}
    modifiers={[listRowBackground(palette.rowSurface)]}>
    <List.ForEach onMove={(sources, destination) => onChange(moveChooserLists(lists, sources, destination))}>
      {chooserListRows(lists).map((list) => <Toggle
        key={list}
        label={CHOOSER_LIST_NAMES[list]}
        isOn={lists.includes(list)}
        onIsOnChange={(on) => onChange(switchChooserList(lists, list, on))}
        modifiers={[
          accessibilityLabel(`Chooser ${CHOOSER_LIST_NAMES[list]}`),
          tint(palette.controlAccent),
          disabled(lists.length === 1 && lists.includes(list)),
          moveDisabled(!lists.includes(list)),
          deleteDisabled(),
        ]}
      />)}
    </List.ForEach>
  </Section>;
}
