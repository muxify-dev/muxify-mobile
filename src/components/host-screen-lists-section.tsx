import { List, Section, Text, Toggle } from '@expo/ui/swift-ui';
import {
  deleteDisabled,
  disabled,
  font,
  foregroundColor,
  listRowBackground,
  moveDisabled,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';
import { SectionHeader } from '@/components/section-header';
import {
  hostScreenListRows,
  moveHostScreenLists,
  mustStayOn,
  switchHostScreenList,
  type HostScreenList,
  type HostScreenLists,
} from '@/settings/settings';

const NAMES: Record<HostScreenList, string> = {
  recent: 'Recent Sessions',
  sessions: 'Sessions',
  topics: 'Topics',
};

/**
 * The Settings section for the Host Screen lists: a switch for each, and a
 * drag for each that is on. The Form must be in edit mode for the drag
 * handles to show.
 */
export function HostScreenListsSection({
  lists,
  onChange,
  palette,
}: {
  lists: HostScreenLists;
  onChange: (lists: HostScreenLists) => void;
  palette: Appearance;
}) {
  return (
    <Section
      header={<SectionHeader palette={palette}>Host Screen lists</SectionHeader>}
      footer={
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
          The Host Screen shows the lists that are on, in this order. Drag a list to move it.
          Sessions or Topics stays on.
        </Text>
      }
      modifiers={[listRowBackground(palette.rowSurface)]}>
      <List.ForEach
        onMove={(sources, destination) => onChange(moveHostScreenLists(lists, sources, destination))}>
        {hostScreenListRows(lists).map((list) => {
          const on = lists.includes(list);
          return (
            <Toggle
              key={list}
              label={NAMES[list]}
              isOn={on}
              onIsOnChange={(next) => onChange(switchHostScreenList(lists, list, next))}
              modifiers={[
                tint(palette.controlAccent),
                disabled(mustStayOn(lists, list)),
                // A list that is off has no place on the Host Screen to move it to.
                moveDisabled(!on),
                deleteDisabled(),
              ]}
            />
          );
        })}
      </List.ForEach>
    </Section>
  );
}
