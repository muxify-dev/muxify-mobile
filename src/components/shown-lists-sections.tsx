import { Button, HStack, Image, List, Section, Spacer, Text } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  deleteDisabled,
  font,
  foregroundColor,
  listRowBackground,
} from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';
import { SectionHeader } from '@/components/section-header';
import { TAPPABLE_ROW } from '@/components/tappable-row';

/** Sized and spaced to line up with SwiftUI's own delete control in the row above. */
const ICON_SIZE = 22;
const ICON_SPACING = 14;

/**
 * Two Settings sections for one kind of list, as iOS edits a set of lists in
 * Control Center: the shown lists in their order, each with a delete control
 * and a drag handle, then the hidden ones, each with a plus that adds it at
 * the end. The Form must be in edit mode for the controls to show.
 */
export function ShownListsSections<L extends string>({
  title,
  id,
  shown,
  hidden,
  names,
  mustStay,
  onShow,
  onHide,
  onMove,
  footer,
  palette,
}: {
  title: string;
  /** Prefix of each row's accessibility identifier. */
  id: string;
  shown: readonly L[];
  hidden: readonly L[];
  names: Record<L, string>;
  mustStay: (list: L) => boolean;
  onShow: (list: L) => void;
  onHide: (list: L) => void;
  onMove: (sources: number[], destination: number) => void;
  footer: string;
  palette: Appearance;
}) {
  const footerText = (
    <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>{footer}</Text>
  );
  return (
    <>
      <Section
        header={<SectionHeader palette={palette}>{`${title}: shown`}</SectionHeader>}
        footer={hidden.length === 0 ? footerText : undefined}
        modifiers={[listRowBackground(palette.rowSurface)]}>
        <List.ForEach
          onDelete={(indices) => {
            const list = shown[indices[0]];
            if (list !== undefined) onHide(list);
          }}
          onMove={onMove}>
          {shown.map((list) =>
            mustStay(list) ? (
              // SwiftUI drops the delete control of a row it may not delete, so
              // a gray one in its place says the list cannot go.
              <HStack
                key={list}
                spacing={ICON_SPACING}
                modifiers={[
                  deleteDisabled(),
                  accessibilityIdentifier(`${id}-shown-${list}`),
                  accessibilityLabel(`${names[list]}, must stay shown`),
                ]}>
                <Image systemName="minus.circle.fill" size={ICON_SIZE} color={palette.secondaryLabel} />
                <Text modifiers={[foregroundColor(palette.toolbarTint)]}>{names[list]}</Text>
              </HStack>
            ) : (
              <Text
                key={list}
                modifiers={[foregroundColor(palette.toolbarTint), accessibilityIdentifier(`${id}-shown-${list}`)]}>
                {names[list]}
              </Text>
            ),
          )}
        </List.ForEach>
      </Section>
      {hidden.length > 0 ? (
        <Section
          header={<SectionHeader palette={palette}>{`${title}: hidden`}</SectionHeader>}
          footer={footerText}
          modifiers={[listRowBackground(palette.rowSurface)]}>
          {hidden.map((list) => (
            <Button
              key={list}
              onPress={() => onShow(list)}
              modifiers={[
                buttonStyle('plain'),
                accessibilityIdentifier(`${id}-hidden-${list}`),
                accessibilityLabel(`Show ${names[list]}`),
              ]}>
              <HStack spacing={ICON_SPACING} modifiers={[TAPPABLE_ROW]}>
                <Image systemName="plus.circle.fill" size={ICON_SIZE} color={palette.insert} />
                <Text modifiers={[foregroundColor(palette.toolbarTint)]}>{names[list]}</Text>
                <Spacer />
              </HStack>
            </Button>
          ))}
        </Section>
      ) : null}
    </>
  );
}
