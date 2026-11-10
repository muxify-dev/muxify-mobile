import { Stack, useLocalSearchParams } from 'expo-router';
import { Form, Host } from '@expo/ui/swift-ui';
import { background, environment, scrollContentBackground, tint } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { ChooserListsSection } from '@/components/chooser-lists-section';
import { HostScreenListsSection } from '@/components/host-screen-lists-section';
import { useChooserLists, useHostLists, useSettings } from '@/settings/settings-context';

export default function HostListsScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const chooserLists = useChooserLists(hostId);
  const lists = useHostLists(hostId);
  const { updateHostLists, updateChooserLists, appearance, palette } = useSettings();
  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Panels and chooser' }} />
      <Host style={styles.fill} matchContents={false}>
        <Form modifiers={[
          environment('colorScheme', appearance),
          environment('editMode', 'active'),
          scrollContentBackground('hidden'),
          background(palette.background),
          tint(palette.controlAccent),
        ]}>
          <ChooserListsSection lists={chooserLists} onChange={(next) => updateChooserLists(hostId, next)} palette={palette} />
          <HostScreenListsSection lists={lists} onChange={(next) => updateHostLists(hostId, next)} palette={palette} />
        </Form>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
