import { Fragment, useState } from 'react';

import {
  BottomSheet,
  Button,
  Divider,
  Group,
  Host,
  HStack,
  ScrollView,
  Spacer,
  Text,
  Toggle,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  clipShape,
  controlSize,
  cornerRadius,
  environment,
  fixedSize,
  font,
  foregroundColor,
  frame,
  glassEffect,
  layoutPriority,
  offset,
  onGeometryChange,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  strokeBorder,
  tint,
  toggleStyle,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { HostScreenRowView, rowKey, type TopicRow } from '@/components/host-screen-row-view';
import type { Appearance, SheetPalette } from '@/constants/app-theme';
import type { HostScreenSection } from '@/domain/host-screen';
import { useSettings } from '@/settings/settings-context';
import type { Frame } from '@/tmux/pane-topology';
import { SheetHeader, SheetNote } from './sheet-chrome';
import {
  ACTION_BAR_HEIGHT,
  CONTENT_TO_ACTIONS,
  GRID_GAP,
  HEADER_TO_CONTENT,
  SHEET_PADDING,
  sheetHeight,
  sheetMetrics,
  type Size,
} from './sheet-layout';

/** One thing that can be picked, with enough to draw a preview of it. */
export interface PreviewCard {
  /** Stable identity, handed back to `onSelect`. */
  id: string;
  /** The large label: a Session name, or a Pane's directory. */
  title: string;
  /** The small one underneath: what is running, and how many Windows or Panes. */
  detail: string;
  /** Whether this is where the Surface is attached right now. */
  current: boolean;
  /** What the Pane behind this card is showing, already trimmed to fit. */
  preview: string[];
  /** Where a Pane sits in the diagram, as fractions. Panes only. */
  frame?: Frame;
}

export interface SheetAction {
  id: string;
  label: string;
  systemImage?: SFSymbol;
}

/** The Host's Topics under the Sessions: the rows of the Host Screen's Topics list. */
export interface SheetTopics {
  sections: HostScreenSection[];
  /** The chrome colours the Host Screen draws the same rows in. */
  palette: Appearance;
  onOpenTopic: (row: TopicRow) => void;
  onRetry: () => void;
}

export interface PickerSheetProps {
  title: string;
  isPresented: boolean;
  onDismiss: () => void;
  cards: PreviewCard[];
  /** Panes are a diagram of the Window; Sessions are a list of previews. */
  layout: 'panes' | 'list';
  loading: boolean;
  error?: string;
  emptyMessage: string;
  onSelect: (id: string) => void;
  /** The bar along the bottom: the two Splits. */
  actions?: SheetAction[];
  onAction?: (id: string) => void;
  /** The Zoom switch, shown only for Panes, and only when there are two. */
  zoom?: { on: boolean; onChange: (on: boolean) => void };
  /** Sessions only: the Host's Topics, under the cards. */
  topics?: SheetTopics;
}

/** One Topic row and one section header, as the sheet's height counts them. */
const TOPIC_ROW_HEIGHT = 56;
const TOPIC_HEADER_HEIGHT = 32;

function topicsHeight(sections: HostScreenSection[]): number {
  return sections.reduce(
    (height, section) => height + TOPIC_HEADER_HEIGHT + section.rows.length * TOPIC_ROW_HEIGHT,
    0,
  );
}

/** The Pane diagram: a 4:3 well with the tiles inset inside it. */
const BOARD_INSET = 6;
const TILE_GAP = 4;

/** Corner radii, shared by whatever draws the shape and whatever outlines it. */
const BOARD_RADIUS = 12;
const CARD_RADIUS = 12;

/**
 * The glass sheet behind the Sessions and Panes pickers.
 *
 * Two shapes, because two questions. Sessions are a *list of previews*: a
 * Session called "0" among others is not a choice on a phone, and what it is
 * showing is the only thing that tells them apart. Panes are a *diagram*: they
 * are all in front of you already, so the question is which part of the screen
 * you mean, and pointing at where it sits beats reading an index.
 *
 * The diagram deliberately does not show Pane contents. Four tiles of
 * six-point terminal text is a picture of a wall; the directory and the command
 * are what distinguish one Pane from the next, and they fit.
 *
 * Rows are Buttons rather than List selection: a tap is a one-shot command to
 * the Host, not state the sheet owns. It is also the only form that carries a
 * pressable label through the SwiftUI hosting boundary into the accessibility
 * tree, which is what makes the picker testable at all.
 *
 * The Host is zero-sized and absolutely positioned, because the sheet presents
 * itself over everything and its anchor must not take part in layout — a
 * laid-out anchor would eat a row of the Surface.
 */
export function PickerSheet({
  title,
  isPresented,
  onDismiss,
  cards,
  layout,
  loading,
  error,
  emptyMessage,
  onSelect,
  actions,
  onAction,
  zoom,
  topics,
}: PickerSheetProps) {
  // The live setting, not the one the Session was opened with: the Theme
  // decides whether the app is light or dark, and CONTEXT.md is explicit that
  // the chrome follows it immediately even though the Surface waits for the
  // next Attach.
  const { appearance, sheetPalette: palette } = useSettings();
  // The sheet's width is known only once it is laid out, so the window stands
  // in until then. The measurement that follows fits everything to the sheet.
  const screen = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const metrics = sheetMetrics(measuredWidth ?? screen.width, screen.height);
  const sections = topics?.sections ?? [];
  const height = sheetHeight(metrics, layout, cards.length, topicsHeight(sections));
  // Only a Recent Session row shows a time, and no such row is drawn here.
  const [openedAt] = useState(() => new Date());

  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group
          modifiers={[
            presentationDetents(
              layout === 'panes'
                ? [{ height }]
                : // A list that had to be cut can be dragged open; one that fits
                  // has nothing to drag to.
                  [{ height }, 'large'],
              // The height changes once the sheet has measured itself, and the
              // detent it opened at goes with it. Without a selection that
              // follows, SwiftUI is left holding a detent it no longer offers,
              // and the sheet does not open.
              { selection: { height } },
            ),
            presentationDragIndicator('hidden'),
            // The Theme's appearance, not the phone's: Solarized is a light
            // terminal and a dark sheet over it reads as two apps stitched
            // together — which is the same reason the Host Screen follows it.
            environment('colorScheme', appearance),
            // A colour, not a material: a material follows the *system*
            // appearance, so a phone in light mode would show a white sheet
            // over a Dracula terminal no matter what colorScheme says.
            presentationBackground(palette.sheet),
          ]}>
          <VStack
            spacing={0}
            modifiers={[
              padding({ all: SHEET_PADDING }),
              // As wide as the sheet whatever the content asks for, so the
              // measurement is the sheet's width and not its content's.
              frame({ minWidth: 0, maxWidth: Infinity }),
              onGeometryChange(({ width }) => {
                if (width > 0 && width !== measuredWidth) setMeasuredWidth(width);
              }),
            ]}>
            <SheetHeader title={title} onDismiss={onDismiss} />

            <VStack spacing={0} modifiers={[padding({ top: HEADER_TO_CONTENT })]}>
              {loading ? (
                <SheetNote palette={palette}>Reading…</SheetNote>
              ) : error !== undefined ? (
                <Text modifiers={[foregroundColor('#ff6b6b')]}>{error}</Text>
              ) : cards.length === 0 ? (
                <SheetNote palette={palette}>{emptyMessage}</SheetNote>
              ) : null}

              {cards.length > 0 && layout === 'panes' ? (
                <PaneBoard
                  cards={cards}
                  board={metrics.board}
                  palette={palette}
                  onSelect={onSelect}
                />
              ) : null}

              {cards.length > 0 && layout === 'list' ? (
                <ScrollView>
                  <VStack spacing={GRID_GAP}>
                    {cards.map((card) => (
                      <PreviewButton
                        key={card.id}
                        card={card}
                        palette={palette}
                        size={metrics.listCard}
                        onSelect={onSelect}
                      />
                    ))}
                    {topics
                      ? sections.map((section) => (
                          <VStack key={section.id} spacing={0} alignment="leading">
                            <HStack modifiers={[frame({ height: TOPIC_HEADER_HEIGHT })]}>
                              <Text
                                modifiers={[
                                  font({ size: 13, weight: 'semibold' }),
                                  foregroundColor(palette.secondary),
                                ]}>
                                {section.title ?? ''}
                              </Text>
                              <Spacer />
                            </HStack>
                            {section.rows.map((row, index) => (
                              <HStack
                                key={rowKey(row, index)}
                                modifiers={[frame({ minHeight: TOPIC_ROW_HEIGHT })]}>
                                <HostScreenRowView
                                  row={row}
                                  palette={topics.palette}
                                  openedAt={openedAt}
                                  actions={{
                                    onOpenTopic: topics.onOpenTopic,
                                    onRetry: topics.onRetry,
                                    // No Session row and no row that opens in
                                    // place is among these: see topicSections.
                                    onOpenSession: () => {},
                                    onToggle: () => {},
                                  }}
                                />
                              </HStack>
                            ))}
                          </VStack>
                        ))
                      : null}
                  </VStack>
                </ScrollView>
              ) : null}
            </VStack>

            <Spacer />

            {actions?.length || zoom ? (
              <Footer
                actions={actions ?? []}
                palette={palette}
                onAction={onAction}
                zoom={zoom}
              />
            ) : null}
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/**
 * A rounded outline that actually follows the corner.
 *
 * `border` is SwiftUI's `.border()`, which strokes a **rectangle** — so on a
 * rounded tile the clip cuts the stroke off at each corner and leaves the
 * outline looking chewed. `strokeBorder` takes the shape, and draws inside it
 * rather than astride the edge, so a 2pt selected outline is 2pt of tile rather
 * than 1pt of tile and 1pt of whatever is behind it.
 */
function outline(color: string, lineWidth: number, cornerRadius: number) {
  return strokeBorder({
    content: color,
    style: { lineWidth },
    shape: 'roundedRectangle',
    cornerRadius,
  });
}

/**
 * The Panes of a Window, drawn where they are rather than listed.
 *
 * Absolute placement inside one well: tmux splits nest arbitrarily, and any
 * row-and-column approximation gets the interesting layouts wrong. The frames
 * arrive as fractions, so one multiplication by the well's size places them.
 * The fractions are tmux's own proportions, held off a floor so the smallest
 * Pane stays a tile and not a line — see paneTopologyFrames.
 */
function PaneBoard({
  cards,
  board,
  palette,
  onSelect,
}: {
  cards: PreviewCard[];
  board: Size;
  palette: SheetPalette;
  onSelect: (id: string) => void;
}) {
  const well = {
    width: board.width - BOARD_INSET * 2,
    height: board.height - BOARD_INSET * 2,
  };

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        // `alignment` on the stack settles the children against each other;
        // the frame needs its own, or SwiftUI centres the whole stack inside
        // it and every offset below is measured from the wrong corner.
        frame({ width: board.width, height: board.height, alignment: 'topLeading' }),
        background(palette.well),
        clipShape('roundedRectangle', BOARD_RADIUS),
        outline(palette.stroke, 1, BOARD_RADIUS),
      ]}>
      {cards.map((card) => {
        const box = card.frame ?? { x: 0, y: 0, width: 1, height: 1 };
        // Half the gap on every side of every tile, so the space between two
        // of them is one whole gap and the space to the edge is half of one.
        const width = box.width * well.width - TILE_GAP;
        const height = box.height * well.height - TILE_GAP;
        return (
          <Button
            key={card.id}
            onPress={() => onSelect(card.id)}
            modifiers={[
              frame({ width, height }),
              offset({
                x: BOARD_INSET + box.x * well.width + TILE_GAP / 2,
                y: BOARD_INSET + box.y * well.height + TILE_GAP / 2,
              }),
              buttonStyle('plain'),
              // A Button given children draws no label of its own, so the name
              // has to be restated for anything reading the screen.
              accessibilityLabel(card.title),
            ]}>
            <PaneTile card={card} palette={palette} width={width} height={height} />
          </Button>
        );
      })}
    </ZStack>
  );
}

function PaneTile({
  card,
  palette,
  width,
  height,
}: {
  card: PreviewCard;
  palette: SheetPalette;
  width: number;
  height: number;
}) {
  // A small tile with a large radius is a lozenge, so the corner follows the
  // tile rather than being set once for all of them.
  const radius = Math.max(1, Math.min(6, Math.min(width, height) * 0.18));

  return (
    <VStack
      spacing={2}
      modifiers={[
        frame({ width, height }),
        background(card.current ? palette.tileSelected : palette.tile),
        clipShape('roundedRectangle', radius),
        outline(card.current ? palette.accent : palette.stroke, card.current ? 2 : 1, radius),
      ]}>
      <Text
        modifiers={[
          font({ size: 13, weight: 'semibold' }),
          foregroundColor(card.current ? palette.accent : palette.primary),
        ]}>
        {card.title}
      </Text>
      <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundColor(palette.secondary)]}>
        {card.detail}
      </Text>
    </VStack>
  );
}

/** A Session: its preview, with a label chip over it. */
function PreviewButton({
  card,
  palette,
  size: { width, height },
  onSelect,
}: {
  card: PreviewCard;
  palette: SheetPalette;
  size: Size;
  onSelect: (id: string) => void;
}) {
  return (
    <Button
      key={card.id}
      onPress={() => onSelect(card.id)}
      modifiers={[buttonStyle('plain'), frame({ width, height }), accessibilityLabel(card.title)]}>
      <ZStack
        alignment="topLeading"
        modifiers={[
          frame({ width, height }),
          background(palette.tile),
          clipShape('roundedRectangle', CARD_RADIUS),
          outline(
            card.current ? palette.accent : palette.stroke,
            card.current ? 1.25 : 1,
            CARD_RADIUS,
          ),
        ]}>
        <PreviewText lines={card.preview} palette={palette} />

        <VStack>
          <Spacer />
          <HStack>
            <Text
              modifiers={[
                font({ size: 11 }),
                padding({ horizontal: 8, vertical: 5 }),
                background(palette.scrim),
                cornerRadius(7),
                offset({ x: 8, y: -8 }),
              ]}>
              {card.detail}
            </Text>
            <Spacer />
          </HStack>
        </VStack>
      </ZStack>
    </Button>
  );
}

/** What the Session is showing, in the smallest readable monospace. */
function PreviewText({ lines, palette }: { lines: string[]; palette: SheetPalette }) {
  return (
    <VStack alignment="leading" spacing={0} modifiers={[padding({ all: 8 })]}>
      {lines.map((line, index) => (
        <HStack key={index} spacing={0}>
          <Text
            modifiers={[
              font({ size: 7, design: 'monospaced' }),
              foregroundColor(palette.secondary),
            ]}>
            {line === '' ? ' ' : line}
          </Text>
          <Spacer />
        </HStack>
      ))}
      <Spacer />
    </VStack>
  );
}

/**
 * The bar along the bottom: one piece of glass holding every command the sheet
 * offers, divided rather than separated — the same shape as the Key Row,
 * because it is the same kind of thing.
 */
function Footer({
  actions,
  palette,
  onAction,
  zoom,
}: {
  actions: SheetAction[];
  palette: SheetPalette;
  onAction?: (id: string) => void;
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}) {
  return (
    <HStack
      spacing={0}
      modifiers={[
        frame({ maxWidth: Infinity, minHeight: ACTION_BAR_HEIGHT, maxHeight: ACTION_BAR_HEIGHT }),
        // Glass before padding, so the capsule is the bar rather than the bar
        // plus the gap above it.
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        padding({ top: CONTENT_TO_ACTIONS }),
      ]}>
      {actions.map((action, index) => (
        <Fragment key={action.id}>
          {index > 0 ? <Divider modifiers={[frame({ height: 24 })]} /> : null}
          <Spacer />
          <Button
            label={action.label}
            systemImage={action.systemImage}
            onPress={() => onAction?.(action.id)}
            modifiers={[
              buttonStyle('plain'),
              font({ size: 14, weight: 'semibold' }),
              foregroundColor(palette.primary),
            ]}
          />
          <Spacer />
        </Fragment>
      ))}
      {zoom ? (
        <>
          {actions.length > 0 ? <Divider modifiers={[frame({ height: 24 })]} /> : null}
          <Toggle
            label="Zoom"
            isOn={zoom.on}
            onIsOnChange={zoom.onChange}
            modifiers={[
              toggleStyle('switch'),
              controlSize('small'),
              // Otherwise the switch takes an equal share of the bar and the
              // two Splits are squeezed into the corner.
              fixedSize({ horizontal: true, vertical: false }),
              layoutPriority(1),
              padding({ horizontal: 11 }),
              tint(palette.accent),
            ]}
          />
        </>
      ) : null}
    </HStack>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
