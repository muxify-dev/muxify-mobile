import { Button, ContextMenu, HStack, Image, ProgressView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  font,
  foregroundColor,
  frame,
  lineLimit,
  listRowBackground,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';

import { TAPPABLE_ROW } from '@/components/tappable-row';
import type { Appearance } from '@/constants/app-theme';
import type { GoToRow } from '@/domain/go-to';
import type { PathsReading } from '@/hooks/use-go-to-paths';
import { timeAgoFrom } from '@/lib/relative-time';

export type FolderRow = Extract<GoToRow, { kind: 'path' | 'typed' }>;

export function goToRowKey(row: GoToRow): string {
  switch (row.kind) {
    case 'session':
      return `session:${row.name}`;
    case 'path':
      return `path:${row.path.directory}`;
    case 'typed':
      return 'typed';
  }
}

/**
 * The rows of a Go to list, as Sections of the Form around them. One row is
 * highlighted: Return picks it, and the List Keys move it.
 */
export function GoToList({
  rows,
  highlighted,
  reading,
  palette,
  now,
  locked,
  onPick,
  folderMenu,
}: {
  rows: readonly GoToRow[];
  /** The index of the row that Return picks. */
  highlighted: number;
  reading: PathsReading;
  palette: Appearance;
  /** The time that "2 hr ago" counts from. */
  now: Date;
  /** While a pick runs, no row takes a tap. */
  locked: boolean;
  onPick: (row: GoToRow) => void;
  /** The one item of a folder row's long-press menu. A list that does not pass it gives the folder rows no menu. */
  folderMenu?: { label: string; icon: SFSymbol; onPress: (row: FolderRow) => void };
}) {
  const secondaryText = [font({ size: 15 }), foregroundColor(palette.secondaryLabel)];
  return (
    <>
      {reading.kind === 'failed' ? (
        <Section modifiers={[listRowBackground(palette.rowSurface)]}>
          <Text modifiers={[font({ size: 15 }), foregroundColor(palette.destructive)]}>{reading.error}</Text>
        </Section>
      ) : null}
      <Section modifiers={[listRowBackground(palette.rowSurface)]}>
        {rows.map((row, index) => {
          const face = rowFace(row, now);
          const line = (
            <Button
              key={goToRowKey(row)}
              onPress={() => onPick(row)}
              modifiers={[buttonStyle('plain'), disabled(locked), accessibilityLabel(face.name)]}>
              <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                <Image systemName={face.icon} size={20} color={palette.rowIcon} />
                <VStack spacing={2} alignment="leading">
                  <Text modifiers={[font({ size: 17 }), lineLimit(1)]}>{face.title}</Text>
                  {face.about === '' ? null : (
                    <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel), lineLimit(1)]}>
                      {face.about}
                    </Text>
                  )}
                </VStack>
                <Spacer />
                {index === highlighted ? (
                  <Text modifiers={secondaryText}>↩</Text>
                ) : null}
              </HStack>
            </Button>
          );
          if (row.kind === 'session' || folderMenu === undefined) return line;
          return (
            <ContextMenu key={goToRowKey(row)}>
              <ContextMenu.Items>
                <Button
                  label={folderMenu.label}
                  systemImage={folderMenu.icon}
                  onPress={() => folderMenu.onPress(row)}
                  modifiers={[accessibilityLabel(folderMenu.label)]}
                />
              </ContextMenu.Items>
              <ContextMenu.Trigger>{line}</ContextMenu.Trigger>
            </ContextMenu>
          );
        })}
        {/* After the rows, so no row moves when it comes or goes. Not a Button: no tap and no highlight. */}
        {reading.kind === 'reading' ? (
          <HStack spacing={10}>
            <ProgressView />
            <Text modifiers={secondaryText}>Reading folders…</Text>
          </HStack>
        ) : reading.kind === 'waiting' ? (
          <Text modifiers={secondaryText}>
            The Host sent a new list. It shows when you type.
          </Text>
        ) : rows.length === 0 ? (
          <Text modifiers={secondaryText}>Nothing matches.</Text>
        ) : null}
      </Section>
    </>
  );
}

interface RowFace {
  icon: SFSymbol;
  title: string;
  about: string;
  /** What VoiceOver calls the row. */
  name: string;
}

function rowFace(row: GoToRow, now: Date): RowFace {
  switch (row.kind) {
    case 'session':
      return {
        icon: 'terminal.fill',
        title: row.name,
        about: row.topicLabel === null ? 'running' : `running · ${row.topicLabel}`,
        name: `Session ${row.name}`,
      };
    case 'path': {
      const { path } = row;
      const visited = path.lastVisit === null ? undefined : timeAgoFrom(path.lastVisit, now);
      const about = path.kind === 'worktree'
        ? ['worktree', path.worktree?.branch]
        : [path.directory, visited];
      return {
        icon: path.kind === 'worktree' ? 'arrow.triangle.branch' : 'folder',
        title: path.label,
        about: about.filter((part) => part != null).join(' · '),
        name: `Folder ${path.directory}`,
      };
    }
    case 'typed':
      return { icon: 'folder.badge.plus', title: `Use ${row.directory}`, about: '', name: `Folder ${row.directory}` };
  }
}
