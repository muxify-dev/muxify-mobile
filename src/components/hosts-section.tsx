import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundColor,
  frame,
  lineLimit,
  listRowBackground,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';

import { LogMenu } from '@/components/log-menu';
import { SectionHeader } from '@/components/section-header';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import type { Appearance } from '@/constants/app-theme';
import { movedHostIds } from '@/domain/host-order';
import { useCopyLog } from '@/hooks/use-copy-log';
import { deviceHostStore } from '@/storage/device-store';
import type { Host } from '@/storage/records';

/**
 * The Settings section for the Hosts: where one is added, edited and deleted,
 * and where the order Home shows them in is set. The Form must be in edit mode
 * for the drag handles to show.
 *
 * Re-reads on focus because the Host form writes through the store and this
 * screen would otherwise show a Host that was just renamed under its old name.
 */
export function HostsSection({ palette }: { palette: Appearance }) {
  const router = useRouter();
  const copyLog = useCopyLog();
  const [hosts, setHosts] = useState<Host[]>([]);

  const reload = useCallback(async () => {
    setHosts((await deviceHostStore().load()).hosts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const move = (sources: number[], destination: number) => {
    const ids = movedHostIds(hosts, sources, destination);
    // Shown before it is saved, so the row does not jump back while the file
    // is written.
    setHosts(ids.flatMap((id) => hosts.find((host) => host.id === id) ?? []));
    void deviceHostStore()
      .reorderHosts(ids)
      .then(reload);
  };

  const confirmRemove = (doomed: Host[]) => {
    const [host] = doomed;
    if (!host) return;
    Alert.alert(`Delete ${host.displayName}?`, 'Its stored credential goes with it.', [
      // The list has already drawn the row gone, so a Cancel puts it back.
      { text: 'Cancel', style: 'cancel', onPress: () => void reload() },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deviceHostStore().removeHost(host.id);
            await reload();
          })();
        },
      },
    ]);
  };

  return (
    <Section
      header={
        <HStack modifiers={[frame({ maxWidth: 3000 })]}>
          <SectionHeader palette={palette}>Hosts</SectionHeader>
          <Spacer />
          <Button
            label="＋ Add"
            onPress={() => router.push('/host-form')}
            modifiers={[buttonStyle('plain'), font({ size: 15 }), accessibilityLabel('Add Host')]}
          />
        </HStack>
      }
      footer={
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
          Drag a Host to change the order on Home. A tap opens it to edit.
        </Text>
      }
      modifiers={[listRowBackground(palette.rowSurface)]}>
      <List.ForEach
        onMove={move}
        onDelete={(at) => confirmRemove(at.flatMap((index) => hosts[index] ?? []))}>
        {hosts.map((host) => (
          <HStack key={host.id}>
          <LogMenu onCopyLog={copyLog}>
            <Button
              onPress={() => router.push({ pathname: '/host-form', params: { id: host.id } })}
              modifiers={[buttonStyle('plain'), accessibilityLabel(host.displayName)]}>
              <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                <Image systemName="server.rack" size={20} color={palette.rowIcon} />
                <VStack spacing={2} alignment="leading">
                  {/* One line each, however long: a row that wraps is taller
                      than its neighbours and the list stops reading as one. */}
                  <Text
                    modifiers={[
                      font({ size: 17, weight: 'bold' }),
                      lineLimit(1),
                      truncationMode('tail'),
                    ]}>
                    {host.displayName}
                  </Text>
                  <Text
                    modifiers={[
                      font({ size: 13, design: 'monospaced' }),
                      foregroundColor(palette.secondaryLabel),
                      lineLimit(1),
                      truncationMode('tail'),
                    ]}>
                    {`${host.address}:${host.port}`}
                  </Text>
                </VStack>
                <Spacer />
              </HStack>
            </Button>
          </LogMenu>
          </HStack>
        ))}
      </List.ForEach>
    </Section>
  );
}
