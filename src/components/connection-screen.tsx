import { Button, GlassEffectContainer, Host, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, controlSize, environment } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Appearance } from '@/constants/app-theme';
import { actionLabel, type Cover, type CoverAction, type Failure, type Place, type StepMark } from '@/domain/cover';
import { reconnectStepLabel } from '@/domain/reconnect';

interface ConnectionScreenProps {
  cover: Extract<Cover, { kind: 'connection-screen' }>;
  /** The Session and Host it is for, or null when there is no Host to name. */
  place: Place | null;
  palette: Appearance;
  appearance: 'light' | 'dark';
  onAction: (action: CoverAction) => void;
}

/**
 * The Cover while nothing has been painted: a first connect, a cold-start
 * reconnect, a failure before the first paint, and a Host that is not saved.
 *
 * Every step, the ones done ticked and the current one turning. Drawn over the
 * Terminal Screen rather than pushed as its own, because the Attach reaches
 * its attached phase only once a Surface below has reported its grid. Go to
 * Host is there at every step. A failure stays, with its reason and the
 * actions for it: nothing here tries again by itself.
 */
export function ConnectionScreen({ cover, place, palette, appearance, onAction }: ConnectionScreenProps) {
  const { failure } = cover;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.screen,
        { backgroundColor: palette.background, paddingTop: 48 },
      ]}
      testID="connection-screen">
      <Text style={[styles.title, { color: palette.toolbarTint }]}>{cover.title}</Text>
      {place ? (
        <Text style={[styles.subtitle, { color: palette.secondaryLabel }]}>
          {place.session} on {place.hostName}
        </Text>
      ) : null}

      {cover.steps ? (
        <View style={styles.steps}>
          {cover.steps.map((mark) => (
            <StepRow key={mark.step} mark={mark} palette={palette} />
          ))}
        </View>
      ) : null}

      {failure ? <FailureText failure={failure} palette={palette} /> : null}
      <Host matchContents={{ vertical: true }} colorScheme={appearance} seedColor={palette.controlAccent} style={styles.buttons}>
        <GlassEffectContainer spacing={16} modifiers={[environment('colorScheme', appearance)]}>
          <VStack spacing={16}>
            {cover.actions.map((action, index) => (
              <Button
                key={action}
                label={actionLabel(action)}
                onPress={() => onAction(action)}
                modifiers={[
                  buttonStyle(failure && index === 0 ? 'glassProminent' : 'glass'),
                  controlSize('large'),
                  accessibilityLabel(actionLabel(action)),
                ]}
              />
            ))}
          </VStack>
        </GlassEffectContainer>
      </Host>
    </View>
  );
}

function FailureText({ failure, palette }: { failure: Failure; palette: Appearance }) {
  return (
    <View style={styles.failure} testID="connection-failure">
      <Text style={[styles.failureTitle, { color: palette.destructive }]}>{failure.title}</Text>
      {failure.reason ? (
        <Text style={[styles.failureReason, { color: palette.secondaryLabel }]}>{failure.reason}</Text>
      ) : null}
    </View>
  );
}

function StepRow({ mark, palette }: { mark: StepMark; palette: Appearance }) {
  const label = reconnectStepLabel(mark.step);
  const { state } = mark;
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
  steps: { marginTop: 32, marginBottom: 8, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepMark: { width: 24, alignItems: 'center' },
  stepText: { fontSize: 17 },
  failure: { gap: 6, marginTop: 24 },
  failureTitle: { fontSize: 17, fontWeight: '600' },
  failureReason: { fontSize: 15 },
  buttons: { marginTop: 16, alignSelf: 'stretch' },
});
