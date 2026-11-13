import { Stack, useLocalSearchParams } from 'expo-router';
import { Form, Host, Section, Text } from '@expo/ui/swift-ui';
import { background, environment, font, foregroundColor, scrollContentBackground, tint } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ShownListsSections } from '@/components/shown-lists-sections';
import {
  CHOOSER_LIST_NAMES,
  HOST_SCREEN_LIST_NAMES,
  hiddenChooserLists,
  hiddenHostScreenLists,
  moveChooserLists,
  moveHostScreenLists,
  mustStayOn,
  switchChooserList,
  switchHostScreenList,
} from '@/settings/settings';
import { useChooserLists, useHostLists, useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';

export default function HostListsScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const chooserLists = useChooserLists(hostId);
  const lists = useHostLists(hostId);
  const { updateHostLists, updateChooserLists, appearance, palette } = useSettings();
  const [hostName, setHostName] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void deviceHostStore().load().then((records) => {
      if (current) setHostName(records.hosts.find((host) => host.id === hostId)?.displayName ?? null);
    });
    return () => {
      current = false;
    };
  }, [hostId]);
  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: hostName === null ? 'Lists' : `${hostName} lists` }} />
      <Host style={styles.fill} matchContents={false}>
        <Form modifiers={[
          environment('colorScheme', appearance),
          environment('editMode', 'active'),
          scrollContentBackground('hidden'),
          background(palette.background),
          tint(palette.controlAccent),
        ]}>
          <Section
            header={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                {`These settings are for ${hostName ?? 'this Host'} only. Each Host keeps its own.`}
              </Text>
            }>
            {null}
          </Section>
          <ShownListsSections
            title="Host Screen"
            id="host-screen"
            shown={lists}
            hidden={hiddenHostScreenLists(lists)}
            names={HOST_SCREEN_LIST_NAMES}
            mustStay={(list) => mustStayOn(lists, list)}
            onShow={(list) => updateHostLists(hostId, switchHostScreenList(lists, list, true))}
            onHide={(list) => updateHostLists(hostId, switchHostScreenList(lists, list, false))}
            onMove={(sources, destination) => updateHostLists(hostId, moveHostScreenLists(lists, sources, destination))}
            footer={
              `The ${hostName ?? 'Host'} screen shows these lists from top to bottom. A Session shows in one list only. ` +
              'A Session in a Topic shows under its Topic. A Session in Recent Sessions does not show again in Sessions. ' +
              'Keep Sessions or Topics shown, so that you can reach every Session.'
            }
            palette={palette}
          />
          <ShownListsSections
            title="Title chooser"
            id="chooser"
            shown={chooserLists}
            hidden={hiddenChooserLists(chooserLists)}
            names={CHOOSER_LIST_NAMES}
            mustStay={() => chooserLists.length === 1}
            onShow={(list) => updateChooserLists(hostId, switchChooserList(chooserLists, list, true))}
            onHide={(list) => updateChooserLists(hostId, switchChooserList(chooserLists, list, false))}
            onMove={(sources, destination) => updateChooserLists(hostId, moveChooserLists(chooserLists, sources, destination))}
            footer={
              'A tap on the Session name at the top of the Terminal opens the title chooser. ' +
              'Each list here is a tab in it. The first tab opens first. Keep one list shown.'
            }
            palette={palette}
          />
        </Form>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
