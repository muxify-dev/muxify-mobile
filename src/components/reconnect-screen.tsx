import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Appearance } from '@/constants/app-theme';
import {
  failureText,
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
  onTryAgain: () => void;
  onGoHome: () => void;
}

/**
 * "Trying to reconnect": every step of a cold-start reconnect, the ones done
 * ticked and the current one turning.
 *
 * Drawn over the Terminal Screen rather than pushed as its own, because the
 * Attach reaches its attached phase only once the Surface below has reported
 * its grid. Go Home is there at every step, the Header's Back under another name.
 * A failed step stays, with its reason and Try again: a reconnect never tries
 * again by itself.
 */
export function ReconnectScreen({
  hostName,
  session,
  progress,
  palette,
  onTryAgain,
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
        <>
          <Failure text={failureText(progress, { hostName, session })} palette={palette} />
          <ScreenButton label="Try again" palette={palette} onPress={onTryAgain} />
        </>
      ) : null}
      <ScreenButton label="Go Home" palette={palette} onPress={onGoHome} />
    </View>
  );
}

function Failure({
  text,
  palette,
}: {
  text: { title: string; reason: string | null };
  palette: Appearance;
}) {
  return (
    <View style={styles.failure} testID="reconnect-failure">
      <Text style={[styles.failureTitle, { color: palette.destructive }]}>{text.title}</Text>
      {text.reason ? (
        <Text style={[styles.failureReason, { color: palette.secondaryLabel }]}>{text.reason}</Text>
      ) : null}
    </View>
  );
}

function ScreenButton({
  label,
  palette,
  onPress,
}: {
  label: string;
  palette: Appearance;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.rowSurface, opacity: pressed ? 0.6 : 1 },
      ]}>
      <Text style={[styles.buttonText, { color: palette.controlAccent }]}>{label}</Text>
    </Pressable>
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
  steps: { marginTop: 32, marginBottom: 24, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepMark: { width: 24, alignItems: 'center' },
  stepText: { fontSize: 17 },
  failure: { gap: 6 },
  failureTitle: { fontSize: 17, fontWeight: '600' },
  failureReason: { fontSize: 15 },
  button: {
    marginTop: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: { fontSize: 17, fontWeight: '600' },
});
