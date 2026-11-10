import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { currentLaunchId, deviceLog, describeApp, describeDevice, deviceLogs } from '@/diagnostics/device-log';
import { nativeReports } from '@/diagnostics/native-reports';
import { useSettings } from '@/settings/settings-context';

export default function LogsScreen() {
  const { palette } = useSettings();
  const [selected, select] = useState<{ title: string; text: string } | null>(null);
  const readLogs = () => {
    const archive = deviceLogs();
    const launches = archive.launches();
    const current = currentLaunchId();
    if (archive.unavailable()) {
      const memory = { id: current, startedAt: Number(current.split('-')[0]), app: describeApp(), device: describeDevice(),
        text: `App: ${describeApp()}\nDevice: ${describeDevice()}\nSaved logs unavailable. This is the current memory log.\n\n${deviceLog().render()}` };
      const at = launches.findIndex((launch) => launch.id === current);
      if (at === -1) launches.unshift(memory);
      else launches[at] = memory;
    }
    return { launches, current, unavailable: archive.unavailable(), native: nativeReports() };
  };
  const [snapshot, setSnapshot] = useState(readLogs);
  const { launches, current, unavailable, native } = snapshot;
  const previous = launches.find((launch) => launch.id !== current)?.id;
  const textStyle = { color: palette.toolbarTint };
  const rowStyle = [styles.row, { backgroundColor: palette.rowSurface }];
  const copy = () => {
    if (!selected) return;
    void Clipboard.setStringAsync(selected.text).then(
      () => Alert.alert('Log copied', 'The report is on the clipboard.'),
      () => Alert.alert('Could not copy log', 'Try again.'),
    );
  };

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: 'Logs' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {selected ? <>
          <Pressable accessibilityRole="button" accessibilityLabel="All logs" onPress={() => select(null)} style={rowStyle}>
            <Text style={textStyle}>All logs</Text>
          </Pressable>
          <Text style={[styles.heading, textStyle]}>{selected.title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy log" onPress={copy} style={rowStyle}>
            <Text style={textStyle}>Copy log</Text>
          </Pressable>
          <Text selectable style={[styles.report, textStyle]}>{selected.text}</Text>
        </> : <>
          <Text style={textStyle}>Logs stay on this phone until you copy them. Saved launches can include force quits and system stops. They do not confirm a crash.</Text>
          {unavailable ? <Text accessibilityRole="alert" style={textStyle}>Saved logs unavailable. Some recent events may be missing.</Text> : null}
          <Text style={[styles.heading, textStyle]}>App logs</Text>
          {launches.map((launch) => {
            const title = launch.id === current ? 'Current launch' : launch.id === previous ? 'Previous launch' : `Launch ${new Date(launch.startedAt).toLocaleString()}`;
            return <Pressable key={launch.id} accessibilityRole="button" accessibilityLabel={title} onPress={() => select({ title, text: launch.text })} style={rowStyle}>
              <Text style={textStyle}>{title}</Text>
              <Text style={textStyle}>{new Date(launch.startedAt).toLocaleString()}</Text>
              <Text style={textStyle}>{launch.app}</Text>
            </Pressable>;
          })}
          <Text accessibilityLabel="iOS crash reports" style={[styles.heading, textStyle]}>iOS crash reports</Text>
          <Text style={textStyle}>iOS supplies diagnostic reports after some crashes and hangs. Reports may arrive later. An empty list does not mean the app did not crash.</Text>
          {!native.available ? <Text style={textStyle}>iOS reports are not available in this build.</Text> : null}
          {native.error ? <Text accessibilityRole="alert" style={textStyle}>{native.error}</Text> : null}
          {native.available && native.reports.length === 0 ? <Text style={textStyle}>No iOS reports received yet.</Text> : null}
          {native.reports.map((report) => {
            const title = `iOS report ${new Date(Number(report.id.split('-')[0])).toLocaleString()}`;
            return <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={title} onPress={() => select({ title, text: report.text })} style={rowStyle}>
              <Text style={textStyle}>{title}</Text>
            </Pressable>;
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh logs" onPress={() => setSnapshot(readLogs())} style={rowStyle}>
            <Text style={textStyle}>Refresh logs</Text>
          </Pressable>
        </>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 12 },
  row: { padding: 14, borderRadius: 10, gap: 4 },
  heading: { fontSize: 20, fontWeight: '600', marginTop: 12 },
  report: { fontFamily: 'Menlo', fontSize: 12 },
});
