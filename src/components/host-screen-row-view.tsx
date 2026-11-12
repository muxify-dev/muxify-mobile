import { Button, ContextMenu, HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundColor,
  frame,
  opacity,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';

import { TAPPABLE_ROW } from '@/components/tappable-row';
import { MarkImage, TagMarks } from '@/components/topic-marks';
import type { Appearance } from '@/constants/app-theme';
import type { HostScreenRow, OpenableRow, RecentRow } from '@/domain/host-screen';
import { timeAgoFrom } from '@/lib/relative-time';
import type { AttachPhase } from '@/tmux/attach';
import { phaseLabel } from '@/tmux/attach-labels';
import { menuActions, TOPIC_ACTION_ICON, TOPIC_ACTION_LABEL, type TopicAction } from '@/topics/topic-action';
import { WAKE_LABEL, type Wake } from '@/topics/wake-topic';

export type TopicRow = Extract<HostScreenRow, { kind: 'topic' }>;
export type OpenPlaceRow = Extract<HostScreenRow, { kind: 'open-place' }>;

/** What a tap on a row does is the screen's to say; the row only draws. */
export interface RowActions {
  onOpenSession: (name: string) => void;
  onOpenTopic: (row: TopicRow) => void;
  busyTopic?: string | null;
  /** Wakes a Dormant Topic from its long-press menu. A screen that does not pass it gives a Dormant card no wake items. */
  onWake?: (row: TopicRow, wake: Wake) => void;
  /** Sends one order of the long-press menu. A screen that does not pass it gives the card no order items. */
  onTopicAction?: (row: TopicRow, action: TopicAction) => void;
  /** Starts a move of the card from its long-press menu. A screen that does not pass it gives the card no Move… item. */
  onMove?: (row: TopicRow) => void;
  /** Asks how to Settle the Topic, from its long-press menu. A screen that does not pass it gives the card no Settle… item. */
  onSettle?: (row: TopicRow) => void;
  /** Offers the Topics that can fill an Open Place. A screen that does not pass it leaves the Open Place untappable. */
  onFillPlace?: (row: OpenPlaceRow) => void;
  onToggle: (row: OpenableRow) => void;
  onRetry: () => void;
}

/**
 * How a row draws while the user moves a Topic card. The picked card says so,
 * a target is one button that says what a tap does, and any other row takes
 * nothing. In none of them does a tap open a Topic or a Session.
 */
export type MoveRole =
  | { kind: 'picked' }
  | { kind: 'target'; label: string; onPress: () => void }
  | { kind: 'none' };

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
  move,
}: {
  row: HostScreenRow;
  palette: Appearance;
  openedAt: Date;
  /** The phase of the Attach on this Session, or undefined when it is not. */
  attached?: AttachPhase;
  actions: RowActions;
  /** Set while the user moves a Topic card. */
  move?: MoveRole;
}) {
  if (move !== undefined) {
    const face = moveFace(row, palette);
    if (face !== null) return <MovingRow face={face} move={move} palette={palette} />;
  }
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
            {row.text}
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
    case 'topic': {
      const card = (
        <Button
          onPress={() => actions.onOpenTopic(row)}
          modifiers={[buttonStyle('plain'), accessibilityLabel(`Topic ${row.label}`)]}>
          <HStack
            spacing={12}
            modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW, opacity(row.dimmed ? 0.5 : 1)]}>
            {actions.busyTopic === row.id ? <ProgressView /> : <Image
              systemName={row.pinned ? 'pin.fill' : 'rectangle.stack'}
              size={20}
              color={row.pinned ? palette.controlAccent : palette.rowIcon}
            />}
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
)
      const { onWake, onTopicAction, onMove, onSettle } = actions;
      const wakes = row.seed.state === 'dormant' && onWake !== undefined;
      const orders = onTopicAction === undefined ? [] : menuActions(row);
      if (!wakes && orders.length === 0 && onMove === undefined && onSettle === undefined) return card;
      return (
        <ContextMenu>
          <ContextMenu.Items>
            {wakes ? (
              <>
                <Button
                  label={WAKE_LABEL.reopen}
                  systemImage="arrow.counterclockwise"
                  onPress={() => onWake(row, 'reopen')}
                  modifiers={[accessibilityLabel(WAKE_LABEL.reopen)]}
                />
                <Button
                  label={WAKE_LABEL['start-fresh']}
                  systemImage="sparkles"
                  onPress={() => onWake(row, 'start-fresh')}
                  modifiers={[accessibilityLabel(WAKE_LABEL['start-fresh'])]}
                />
              </>
            ) : null}
            {orders.map((action) => (
              <Button
                key={action}
                label={TOPIC_ACTION_LABEL[action]}
                systemImage={TOPIC_ACTION_ICON[action]}
                onPress={() => onTopicAction?.(row, action)}
                modifiers={[accessibilityLabel(TOPIC_ACTION_LABEL[action])]}
              />
            ))}
            {onMove === undefined ? null : (
              <Button
                label="Move…"
                systemImage="arrow.up.arrow.down"
                onPress={() => onMove(row)}
                modifiers={[accessibilityLabel('Move…')]}
              />
            )}
            {onSettle === undefined ? null : (
              <Button
                label="Settle…"
                systemImage={TOPIC_ACTION_ICON.settle}
                onPress={() => onSettle(row)}
                modifiers={[accessibilityLabel('Settle…')]}
              />
            )}
          </ContextMenu.Items>
          <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
        </ContextMenu>
      );
    }
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
    case 'open-place': {
      const { onFillPlace } = actions;
      const line = (
        <HStack
          spacing={12}
          modifiers={[frame({ maxWidth: 3000 }), ...(onFillPlace === undefined ? [accessibilityLabel('Open Place')] : [TAPPABLE_ROW])]}>
          <Image systemName="circle.dashed" size={20} color={palette.secondaryLabel} />
          <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
            Open Place
          </Text>
          <Spacer />
          {onFillPlace === undefined ? null : (
            <Image systemName="plus" size={15} color={palette.controlAccent} />
          )}
        </HStack>
      );
      if (onFillPlace === undefined) return line;
      return (
        <Button
          onPress={() => onFillPlace(row)}
          modifiers={[buttonStyle('plain'), accessibilityLabel('Open Place')]}>
          {line}
        </Button>
      );
    }
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

/** What a card shows of itself while a Topic card moves. */
interface MoveFace {
  icon: SFSymbol;
  iconColor: string;
  title: string;
  titleColor?: string;
  /** What VoiceOver calls the row when it is not a target, as it does outside a move. */
  name: string;
}

/** The face of each row a move can involve, or null for a row a move leaves as it is. */
function moveFace(row: HostScreenRow, palette: Appearance): MoveFace | null {
  switch (row.kind) {
    case 'topic':
      return {
        icon: row.pinned ? 'pin.fill' : 'rectangle.stack',
        iconColor: row.pinned ? palette.controlAccent : palette.rowIcon,
        title: row.label,
        name: `Topic ${row.label}`,
      };
    case 'locked-session':
      return {
        icon: row.pinned ? 'pin.fill' : 'terminal',
        iconColor: row.pinned ? palette.controlAccent : palette.rowIcon,
        title: row.name,
        name: `Session ${row.name}`,
      };
    case 'open-place':
      return {
        icon: 'circle.dashed',
        iconColor: palette.secondaryLabel,
        title: 'Open Place',
        titleColor: palette.secondaryLabel,
        name: 'Open Place',
      };
    case 'bench':
      return { icon: 'tray.2', iconColor: palette.rowIcon, title: 'Bench', name: 'Bench' };
    case 'unknown-card':
      return {
        icon: 'questionmark.square.dashed',
        iconColor: palette.secondaryLabel,
        title: row.text,
        titleColor: palette.secondaryLabel,
        name: row.text,
      };
    default:
      return null;
  }
}

function MovingRow({ face, move, palette }: { face: MoveFace; move: MoveRole; palette: Appearance }) {
  const picked = move.kind === 'picked';
  const line = (
    <HStack
      spacing={12}
      modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW, opacity(move.kind === 'none' ? 0.4 : 1)]}>
      <Image systemName={face.icon} size={20} color={picked ? palette.controlAccent : face.iconColor} />
      <Text
        modifiers={[
          font({ size: 17, weight: picked ? 'semibold' : 'regular' }),
          ...(picked ? [foregroundColor(palette.controlAccent)] : face.titleColor ? [foregroundColor(face.titleColor)] : []),
        ]}>
        {face.title}
      </Text>
      <Spacer />
      {picked ? (
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.controlAccent)]}>Moving</Text>
      ) : null}
      {move.kind === 'target' ? (
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundColor(palette.controlAccent)]}>
          {move.label}
        </Text>
      ) : null}
    </HStack>
  );
  if (move.kind !== 'target') return <HStack modifiers={[accessibilityLabel(face.name)]}>{line}</HStack>;
  return (
    <Button
      onPress={move.onPress}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(move.label === face.title ? move.label : `${move.label} ${face.title}`),
      ]}>
      {line}
    </Button>
  );
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