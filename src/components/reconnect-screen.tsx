import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Appearance } from '@/constants/app-theme';
import {
  RECONNECT_STEPS,
  reconnectStepLabel,
  type ReconnectProgress,
  type ReconnectStep,
} from '@/domain/reconnect';

interface ReconnectScreenProps {
  hostName: string;
  session: string;
  progress: Exclude<ReconnectProgress, { kind: 'attached' }>;
  palette: Appearance;
  onGoHome: () => void;
}

/**
 * "Trying to reconnect": every step of a cold-start reconnect, the ones done
 * ticked and the current one turning.
 *
 * Drawn over the Terminal Screen rather than pushed as its own, because the
 * Attach reaches its attached phase only once the Surface below has reported
 * its grid. Go Home is there at every step, the Dock's Home under another name.
 */
export function ReconnectScreen({
  hostName,
  session,
  progress,
  palette,
  onGoHome,
}: ReconnectScreenProps) {
  const insets = useSafeAreaInsets();
  const current = RECONNECT_STEPS.indexOf(progress.step);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.screen,
        { backgroundColor: palette.background, paddingTop: insets.top + 48 },
      ]}
      testID="reconnect-screen">
      <Text style={[styles.title, { color: palette.toolbarTint }]}>Trying to reconnect</Text>
      <Text style={[styles.subtitle, { color: palette.secondaryLabel }]}>
        {session} on {hostName}
      </Text>

      <View style={styles.steps}>
        {RECONNECT_STEPS.map((step, at) => (
          <StepRow
            key={step}
            step={step}
            state={at < current ? 'done' : at > current ? 'waiting' : progress.kind}
            palette={palette}
          />
        ))}
      </View>

      {progress.kind === 'failed' ? (
        <Text style={[styles.failure, { color: palette.destructive }]} testID="reconnect-failure">
          Could not reconnect.
        </Text>
      ) : null}

      <Pressable
        onPress={onGoHome}
        accessibilityRole="button"
        accessibilityLabel="Go Home"
        style={({ pressed }) => [
          styles.goHome,
          { backgroundColor: palette.rowSurface, opacity: pressed ? 0.6 : 1 },
        ]}>
        <Text style={[styles.goHomeText, { color: palette.controlAccent }]}>Go Home</Text>
      </Pressable>
    </View>
  );
}

function StepRow({
  step,
  state,
  palette,
}: {
  step: ReconnectStep;
  state: 'done' | 'at' | 'failed' | 'waiting';
  palette: Appearance;
}) {
  const label = reconnectStepLabel(step);
  return (
    <View
      style={styles.step}
      accessible
      accessibilityLabel={`${label}, ${STATE_WORDS[state]}`}>
      <View style={styles.stepMark}>
        {state === 'at' ? (
          <ActivityIndicator color={palette.secondaryLabel} />
        ) : state === 'waiting' ? null : (
          <SymbolView
            name={state === 'done' ? 'checkmark' : 'xmark'}
            size={16}
            tintColor={state === 'done' ? palette.controlAccent : palette.destructive}
          />
        )}
      </View>
      <Text
        style={[
          styles.stepText,
          { color: state === 'waiting' ? palette.secondaryLabel : palette.toolbarTint },
        ]}>
        {label}
      </Text>
    </View>
  );
}

const STATE_WORDS = { done: 'done', at: 'in progress', failed: 'failed', waiting: 'waiting' };

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 32 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, marginTop: 6 },
  steps: { marginTop: 32, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepMark: { width: 24, alignItems: 'center' },
  stepText: { fontSize: 17 },
  failure: { fontSize: 15, marginTop: 24 },
  goHome: {
    marginTop: 40,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  goHomeText: { fontSize: 17, fontWeight: '600' },
});
