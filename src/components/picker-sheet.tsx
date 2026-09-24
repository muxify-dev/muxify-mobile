import {
  BottomSheet,
  Button,
  Group,
  Host,
  List,
  ProgressView,
  Section,
  Text,
} from '@expo/ui/swift-ui';
import {
  environment,
  foregroundColor,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

export interface PickerItem {
  /** Stable identity, handed back to `onSelect`. */
  id: string;
  label: string;
  /** Whether this is where the Surface is attached right now. */
  current: boolean;
}

export interface PickerSheetProps {
  title: string;
  isPresented: boolean;
  onDismiss: () => void;
  items: PickerItem[];
  /** The list is being read from the Host, so nothing is shown yet. */
  loading: boolean;
  /** Shown in place of the list when the Host could not be asked. */
  error?: string;
  /** What to say when the Host genuinely has none. */
  emptyMessage: string;
  onSelect: (id: string) => void;
}

/**
 * The glass sheet behind every Dock picker.
 *
 * Rows are Buttons rather than List selection: a tap is a one-shot command to
 * the Host, not a piece of state the sheet owns, and a Button says so.
 *
 * The Host is zero-sized and absolutely positioned, because the sheet presents
 * itself over everything and its anchor must not take part in layout — a
 * laid-out anchor would eat a row of the Surface.
 */
export function PickerSheet({
  title,
  isPresented,
  onDismiss,
  items,
  loading,
  error,
  emptyMessage,
  onSelect,
}: PickerSheetProps) {
  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group
          modifiers={[
            // Half height, not full: the sheet is a quick pick, and covering
            // the Surface entirely hides the thing being picked for.
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('visible'),
            // The Surface is always dark, so the sheet is too — otherwise a
            // phone in light mode flashes a white panel over the terminal.
            environment('colorScheme', 'dark'),
            presentationBackground({ type: 'material', material: 'regular' }),
          ]}>
          <List>
            <Section title={title}>
              {loading ? <ProgressView /> : null}
              {error !== undefined ? (
                <Text modifiers={[foregroundColor('#ff6b6b')]}>{error}</Text>
              ) : null}
              {!loading && error === undefined && items.length === 0 ? (
                <Text>{emptyMessage}</Text>
              ) : null}
              {items.map((item) => (
                <Button
                  key={item.id}
                  label={item.label}
                  // The attached one is marked rather than hidden: knowing
                  // where you are is the point of opening the list.
                  systemImage={item.current ? 'checkmark.circle.fill' : 'terminal'}
                  onPress={() => onSelect(item.id)}
                />
              ))}
            </Section>
          </List>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
