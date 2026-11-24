import { Button, ContextMenu, HStack, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, disabled, font, foregroundColor, frame, lineLimit, listRowBackground } from '@expo/ui/swift-ui/modifiers';

import { splitGraphemes } from 'unicode-segmenter/grapheme';

import { SectionHeader } from '@/components/section-header';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import { MarkImage } from '@/components/topic-marks';
import type { Appearance } from '@/constants/app-theme';
import type { Tag } from '@/topics/environment';
import type { GoToSection, GoToText, HostGoToRow } from '@/topics/go-to-answer';
import { tagColorHex, type ColorAppearance } from '@/topics/tag-color';

function markedText(value: GoToText) {
  if (!value.marks.length) return value.text;
  const marks = new Set(value.marks);
  const runs: { marked: boolean; text: string }[] = [];
  let index = 0;
  for (const letter of splitGraphemes(value.text)) {
    const marked = marks.has(index++);
    const last = runs.at(-1);
    if (last && last.marked === marked) last.text += letter;
    else runs.push({ marked, text: letter });
  }
  return runs.map((run, i) => (
    <Text key={i} modifiers={run.marked ? [font({ weight: 'bold' })] : []}>{run.text}</Text>
  ));
}

function rowLabel({ target, title }: HostGoToRow): string {
  if ('session' in target) return `Session ${target.session.name}`;
  if ('session_path' in target) return `Folder ${target.session_path.directory}`;
  if ('topic' in target) return `Topic ${title.text}`;
  if ('tag' in target) return `Tag #${target.tag.name}`;
  return `Reopen ${title.text}`;
}

export function HostGoToList({ sections, highlighted, palette, appearance, tags, locked, onPick }: {
  sections: GoToSection[]; highlighted: number; palette: Appearance; appearance: ColorAppearance; tags: Tag[];
  locked: boolean; onPick: (row: HostGoToRow, another?: boolean) => void;
}) {
  const colors = new Map(tags.map((tag) => [`#${tag.name}`, tag.color[appearance]]));
  let index = 0;
  return sections.map((section) => (
    <Section key={section.id} header={section.title === null ? undefined : <SectionHeader palette={palette}>{section.title}</SectionHeader>}
      modifiers={[listRowBackground(palette.rowSurface)]}>
      {section.rows.map((row) => {
        const line = (
          <Button key={row.id} onPress={() => onPick(row)} modifiers={[buttonStyle('plain'), disabled(locked), accessibilityLabel(rowLabel(row))]}>
            <HStack spacing={8} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
              {row.mark ? <MarkImage mark={row.mark} palette={palette} /> : null}
              <VStack spacing={2} alignment="leading">
                <Text modifiers={[font({ size: 17 }), lineLimit(1)]}>{markedText(row.title)}</Text>
                {row.tags.length ? <HStack spacing={4}>{row.tags.map((tag) => {
                  const color = colors.get(tag.text);
                  return <Text key={tag.text} modifiers={[font({ size: 12 }), foregroundColor(color ? tagColorHex(color, appearance) : palette.secondaryLabel)]}>{markedText(tag)}</Text>;
                })}</HStack> : null}
                {row.detail.text ? <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel), lineLimit(1)]}>{markedText(row.detail)}</Text> : null}
              </VStack>
              <Spacer />
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>{row.trailing}</Text>
              {index++ === highlighted ? <Text>↩</Text> : null}
            </HStack>
          </Button>
        );
        if (!('session_path' in row.target)) return line;
        return <ContextMenu key={row.id}>
          <ContextMenu.Items><Button label="New Session here" systemImage="plus" onPress={() => onPick(row, true)} /></ContextMenu.Items>
          <ContextMenu.Trigger>{line}</ContextMenu.Trigger>
        </ContextMenu>;
      })}
    </Section>
  ));
}
