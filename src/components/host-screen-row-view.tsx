import { Button, HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundColor,
  frame,
  opacity,
} from '@expo/ui/swift-ui/modifiers';

import { TAPPABLE_ROW } from '@/components/tappable-row';
import { MarkImage, TagMarks } from '@/components/topic-marks';
import type { Appearance } from '@/constants/app-theme';
import type { HostScreenRow, OpenableRow, RecentRow } from '@/domain/host-screen';
import { timeAgoFrom } from '@/lib/relative-time';
import type { AttachPhase } from '@/tmux/attach';
import { phaseLabel } from '@/tmux/attach-labels';

export type TopicRow = Extract<HostScreenRow, { kind: 'topic' }>;

/** What a tap on a row does is the screen's to say; the row only draws. */
export interface RowActions {
  onOpenSession: (name: string) => void;
  onOpenTopic: (row: TopicRow) => void;
  onToggle: (row: OpenableRow) => void;
  onRetry: () => void;
}

/** A key for a row among its siblings, unique within one section. */
export function rowKey(row: HostScreenRow, index: number): string {
  switch (row.kind) {
    case 'recent':
    case 'available':
      return row.name;
    case 'topic':
    case 'open-place':
      return row.id;
    case 'locked-session':
      return `locked:${row.name}`;
    case 'unknown-card':
      return `card:${index}`;
    default:
      return row.kind;
  }
}

/**
 * One row of the Host Screen, drawn the same wherever a Host Screen row shows:
 * on the Host Screen itself and in a Host's section of Home.
 */
export function HostScreenRowView({
  row,
  palette,
  openedAt,
  attached,
  actions,
}: {
  row: HostScreenRow;
  palette: Appearance;
  openedAt: Date;
  /** The phase of the Attach on this Session, or undefined when it is not. */
  attached?: AttachPhase;
  actions: RowActions;
}) {
  switch (row.kind) {
    case 'recent':
      return (
        <RecentSessionRow
          row={row}
          palette={palette}
          openedAt={openedAt}
          attached={attached}
          onPress={() => actions.onOpenSession(row.name)}
        />
      );
    case 'available':
      return (
        <Button
          onPress={() => actions.onOpenSession(row.name)}
          modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
            <Image systemName="terminal" size={20} color={palette.rowIcon} />
            <Text modifiers={[font({ size: 17 })]}>{row.name}</Text>
            <Spacer />
            <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
          </HStack>
        </Button>
      );
    case 'checking':
      return (
        <HStack spacing={10} modifiers={[frame({ maxWidth: 3000 })]}>
          <ProgressView />
          <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
            {`Checking ${row.of}…`}
          </Text>
          <Spacer />
        </HStack>
      );
    case 'refused':
      return (
        <VStack
          spacing={8}
          alignment="leading"
          modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
          <HStack spacing={8}>
            <Image systemName="exclamationmark.triangle" size={15} color={palette.destructive} />
            <Text modifiers={[font({ size: 15 }), foregroundColor(palette.destructive)]}>
              {row.message}
            </Text>
            <Spacer />
          </HStack>
          <Button
            label="Retry"
            onPress={actions.onRetry}
            modifiers={[buttonStyle('plain'), font({ size: 15 }), accessibilityLabel('Retry')]}
          />
        </VStack>
      );
    case 'note':
      return (
        <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
          {row.text}
        </Text>
      );
    case 'topic':
      return (
        <Button
          onPress={() => actions.onOpenTopic(row)}
          modifiers={[buttonStyle('plain'), accessibilityLabel(`Topic ${row.label}`)]}>
          <HStack
            spacing={12}
            modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW, opacity(row.dimmed ? 0.5 : 1)]}>
            <Image
              systemName={row.pinned ? 'pin.fill' : 'rectangle.stack'}
              size={20}
              color={row.pinned ? palette.controlAccent : palette.rowIcon}
            />
            <VStack spacing={2} alignment="leading">
              <Text modifiers={[font({ size: 17 })]}>{row.label}</Text>
              {row.note === null ? null : (
                <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                  {row.note}
                </Text>
              )}
              {row.dimmed ? (
                <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                  No live Sessions
                </Text>
              ) : null}
            </VStack>
            <Spacer />
            {row.tags.length === 0 ? null : <TagMarks tags={row.tags} palette={palette} />}
            {row.mark === null ? null : <MarkImage mark={row.mark} palette={palette} />}
            <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
          </HStack>
        </Button>
      );
    case 'locked-session':
      return (
        <Button
          onPress={() => actions.onOpenSession(row.name)}
          modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
            <Image
              systemName={row.pinned ? 'pin.fill' : 'terminal'}
              size={20}
              color={row.pinned ? palette.controlAccent : palette.rowIcon}
            />
            <Text modifiers={[font({ size: 17 })]}>{row.name}</Text>
            <Spacer />
            {row.mark === null ? null : <MarkImage mark={row.mark} palette={palette} />}
            <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
          </HStack>
        </Button>
      );
    case 'open-place':
      return (
        <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), accessibilityLabel('Open Place')]}>
          <Image systemName="circle.dashed" size={20} color={palette.secondaryLabel} />
          <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
            Open Place
          </Text>
          <Spacer />
        </HStack>
      );
    case 'bench':
      return (
        <Button
          onPress={() => actions.onToggle('bench')}
          modifiers={[buttonStyle('plain'), accessibilityLabel('Bench')]}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
            <Image systemName="tray.2" size={20} color={palette.rowIcon} />
            <Text modifiers={[font({ size: 17 })]}>Bench</Text>
            <Spacer />
            <Image
              systemName={row.opened ? 'chevron.up' : 'chevron.down'}
              size={13}
              color={palette.secondaryLabel}
            />
          </HStack>
        </Button>
      );
    case 'unknown-card':
      return (
        <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
          {row.text}
        </Text>
      );
    case 'no-topic':
      return (
        <Button
          onPress={() => actions.onToggle('no-topic')}
          modifiers={[buttonStyle('plain'), accessibilityLabel('No Topic')]}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
            <Image systemName="tray" size={20} color={palette.rowIcon} />
            <Text modifiers={[font({ size: 17 })]}>No Topic</Text>
            <Spacer />
            <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
              {String(row.count)}
            </Text>
            <Image
              systemName={row.opened ? 'chevron.up' : 'chevron.down'}
              size={13}
              color={palette.secondaryLabel}
            />
          </HStack>
        </Button>
      );
  }
}

/**
 * A remembered Session: what it is called, when you last opened it, who is on it.
 *
 * The one that is attached says so where the "Opened 2 hr ago" line would be.
 * The way to end it is a swipe away, with Forget, rather than in the row:
 * nothing here starts or stops a Connection, and the row itself is navigation.
 */
function RecentSessionRow({
  row,
  palette,
  openedAt,
  attached,
  onPress,
}: {
  row: RecentRow;
  palette: Appearance;
  openedAt: Date;
  /** The phase of the Attach on this Session, or undefined when it is not. */
  attached?: AttachPhase;
  onPress: () => void;
}) {
  const opened = timeAgoFrom(row.lastOpenedAt, openedAt);
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
      <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
        <Image
          systemName="terminal"
          size={20}
          color={attached ? palette.controlAccent : palette.rowIcon}
        />
        <VStack spacing={2} alignment="leading">
          <Text modifiers={[font({ size: 17 })]}>{row.name}</Text>
          {attached ? (
            <Text modifiers={[font({ size: 13 }), foregroundColor(palette.controlAccent)]}>
              {phaseLabel(attached)}
            </Text>
          ) : opened === undefined ? null : (
            <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
              {`Opened ${opened}`}
            </Text>
          )}
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
      </HStack>
    </Button>
  );
}