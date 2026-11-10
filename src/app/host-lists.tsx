import { Stack, useLocalSearchParams } from 'expo-router';
import { Form, Host } from '@expo/ui/swift-ui';
import { background, environment, scrollContentBackground, tint } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { HostScreenListsSection } from '@/components/host-screen-lists-section';
import { useHostLists, useSettings } from '@/settings/settings-context';

export default function HostListsScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const lists = useHostLists(hostId);
  const { updateHostLists, appearance, palette } = useSettings();
  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Host Screen lists' }} />
      <Host style={styles.fill} matchContents={false}>
        <Form modifiers={[
          environment('colorScheme', appearance),
          environment('editMode', 'active'),
          scrollContentBackground('hidden'),
          background(palette.background),
          tint(palette.controlAccent),
        ]}>
          <HostScreenListsSection lists={lists} onChange={(next) => updateHostLists(hostId, next)} palette={palette} />
        </Form>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
