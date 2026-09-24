import { Fragment } from 'react';

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
  border,
  buttonStyle,
  clipShape,
  cornerRadius,
  environment,
  font,
  foregroundColor,
  frame,
  glassEffect,
  offset,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { Dimensions, StyleSheet } from 'react-native';

import type { Frame } from '@/tmux/pane-topology';

/** One thing that can be picked, with enough to draw a preview of it. */
export interface PreviewCard {
  /** Stable identity, handed back to `onSelect`. */
  id: string;
  /** The large label: a Session or Window name, or a Pane's directory. */
  title: string;
  /** The small one underneath: what is running, and how many Panes. */
  detail: string;
  /** Whether this is where the Surface is attached right now. */
  current: boolean;
  /** What the Pane behind this card is showing, already trimmed to fit. */
  preview: string[];
  /** Shown over a Window's preview, as tmux numbers them. */
  badge?: string;
  /** Where a Pane sits in the diagram, as fractions. Panes only. */
  frame?: Frame;
}

export interface SheetAction {
  id: string;
  label: string;
  systemImage?: SFSymbol;
}

export interface PickerSheetProps {
  title: string;
  /** The line under the title: which Session, and how many of what. */
  subtitle: string;
  isPresented: boolean;
  onDismiss: () => void;
  cards: PreviewCard[];
  /** Panes are a diagram of the Window; everything else is a grid or a list. */
  layout: 'grid' | 'panes' | 'list';
  loading: boolean;
  error?: string;
  emptyMessage: string;
  /** What to say when there is one: nothing to pick, but plenty to do. */
  onlyOneMessage?: string;
  onSelect: (id: string) => void;
  /** The bar along the bottom: New Window, or the two Splits. */
  actions?: SheetAction[];
  onAction?: (id: string) => void;
  /** The Zoom switch, shown only for Panes, and only when there are two. */
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}

/**
 * The sheet's colours.
 *
 * Named after the system roles they stand in for, and given as flat colours
 * rather than the semantic ones: the Surface is always dark, so the sheet is
 * forced dark too, and a system fill would follow the phone's appearance and
 * flash white over the terminal.
 */
const PALETTE = {
  sheet: '#15171d',
  /** Behind the Pane diagram: a well, slightly darker than the sheet. */
  well: '#11131a',
  /** A tile that is not the current one. */
  tile: '#33353c',
  /** A tile that is. */
  tileSelected: '#232f4c',
  stroke: '#3f424a',
  accent: '#5b8def',
  primary: '#eaeaea',
  secondary: '#9096a3',
  /** Behind a label sitting over a preview, so it stays readable. */
  scrim: '#0b0d11',
} as const;

const SHEET_PADDING = 16;
/** The sheet is as wide as the screen, so its content is too. */
const CONTENT_WIDTH = Dimensions.get('window').width - SHEET_PADDING * 2;

/** The gaps between the sheet's parts, top to bottom. */
const TITLE_TO_CONTEXT = 8;
const CONTEXT_TO_CONTENT = 12;
const CONTENT_TO_ACTIONS = 16;
const ACTION_BAR_HEIGHT = 44;

const GRID_GAP = 10;
const GRID_CARD_WIDTH = Math.floor((CONTENT_WIDTH - GRID_GAP) / 2);
/** Window tiles are slightly taller than they are wide, so the chip fits. */
const GRID_CARD_HEIGHT = Math.ceil(GRID_CARD_WIDTH * 1.1);
const LIST_CARD_HEIGHT = 150;

/** The Pane diagram: a 4:3 well with the tiles inset inside it. */
const BOARD_HEIGHT = Math.ceil(CONTENT_WIDTH * 0.75);
const BOARD_INSET = 6;
const TILE_GAP = 4;

/**
 * The glass sheet behind every Dock picker.
 *
 * Two shapes, because two questions. Sessions and Windows are a *grid of
 * previews*: a Window called "bash" among three others called "bash" is not a
 * choice on a phone, and what it is showing is the only thing that tells them
 * apart. Panes are a *diagram*: they are all in front of you already, so the
 * question is which part of the screen you mean, and pointing at where it sits
 * beats reading an index.
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
  subtitle,
  isPresented,
  onDismiss,
  cards,
  layout,
  loading,
  error,
  emptyMessage,
  onlyOneMessage,
  onSelect,
  actions,
  onAction,
  zoom,
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
            presentationDetents([{ fraction: 0.66 }, 'large']),
            presentationDragIndicator('hidden'),
            // The Surface is always dark, so the sheet is too — otherwise a
            // phone in light mode flashes a white panel over the terminal.
            environment('colorScheme', 'dark'),
            // A colour, not a material: a material follows the system
            // appearance, so a phone in light mode shows a white sheet over a
            // dark terminal no matter what colorScheme says.
            presentationBackground(PALETTE.sheet),
          ]}>
          <VStack spacing={0} modifiers={[padding({ all: SHEET_PADDING })]}>
            <Header title={title} onDismiss={onDismiss} />

            <HStack modifiers={[padding({ top: TITLE_TO_CONTEXT })]}>
              <Text
                modifiers={[
                  font({ size: 12, weight: 'semibold' }),
                  foregroundColor(PALETTE.secondary),
                ]}>
                {subtitle}
              </Text>
              <Spacer />
            </HStack>

            <VStack spacing={0} modifiers={[padding({ top: CONTEXT_TO_CONTENT })]}>
              {loading ? (
                <Note>Reading…</Note>
              ) : error !== undefined ? (
                <Text modifiers={[foregroundColor('#ff6b6b')]}>{error}</Text>
              ) : cards.length === 0 ? (
                <Note>{emptyMessage}</Note>
              ) : null}

              {!loading && cards.length === 1 && onlyOneMessage ? (
                <Note>{onlyOneMessage}</Note>
              ) : null}

              {cards.length > 0 && layout === 'panes' ? (
                <PaneBoard cards={cards} onSelect={onSelect} />
              ) : null}

              {cards.length > 0 && layout !== 'panes' ? (
                <ScrollView>
                  <VStack spacing={GRID_GAP}>
                    {rowsOf(cards, layout === 'grid' ? 2 : 1).map((row, index) => (
                      <HStack key={row.map((card) => card.id).join('|') || index} spacing={GRID_GAP}>
                        {row.map((card) => (
                          <PreviewButton
                            key={card.id}
                            card={card}
                            width={layout === 'grid' ? GRID_CARD_WIDTH : CONTENT_WIDTH}
                            height={layout === 'grid' ? GRID_CARD_HEIGHT : LIST_CARD_HEIGHT}
                            onSelect={onSelect}
                          />
                        ))}
                        {/* A lone card on the last row keeps its column rather
                            than stretching across both. */}
                        {row.length === 1 && layout === 'grid' ? <Spacer /> : null}
                      </HStack>
                    ))}
                  </VStack>
                </ScrollView>
              ) : null}
            </VStack>

            <Spacer />

            {actions?.length || zoom ? (
              <Footer actions={actions ?? []} onAction={onAction} zoom={zoom} />
            ) : null}
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/** A line of explanation where the content would be. */
function Note({ children }: { children: string }) {
  return (
    <HStack>
      <Text modifiers={[font({ size: 13 }), foregroundColor(PALETTE.secondary)]}>{children}</Text>
      <Spacer />
    </HStack>
  );
}

/** Close on the left, title centred over it. */
function Header({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  return (
    <ZStack>
      <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{title}</Text>
      <HStack>
        <Button
          label=""
          systemImage="xmark"
          onPress={onDismiss}
          modifiers={[
            frame({ width: 38, height: 38 }),
            buttonStyle('glass'),
            // A glyph with no label is unreadable to anything but an eye, and
            // unpressable to the e2e suite.
            accessibilityLabel(`Close ${title}`),
          ]}
        />
        <Spacer />
      </HStack>
    </ZStack>
  );
}

/**
 * The Panes of a Window, drawn where they are rather than listed.
 *
 * Absolute placement inside one well: tmux splits nest arbitrarily, and any
 * row-and-column approximation gets the interesting layouts wrong. The frames
 * arrive as fractions, so one multiplication by the well's size places them.
 * See paneTopologyFrames for why those fractions are not tmux's real ones.
 */
function PaneBoard({
  cards,
  onSelect,
}: {
  cards: PreviewCard[];
  onSelect: (id: string) => void;
}) {
  const well = {
    width: CONTENT_WIDTH - BOARD_INSET * 2,
    height: BOARD_HEIGHT - BOARD_INSET * 2,
  };

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        frame({ width: CONTENT_WIDTH, height: BOARD_HEIGHT }),
        background(PALETTE.well),
        cornerRadius(12),
        border({ color: PALETTE.stroke, width: 1 }),
        clipShape('roundedRectangle'),
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
            <PaneTile card={card} width={width} height={height} />
          </Button>
        );
      })}
    </ZStack>
  );
}

function PaneTile({
  card,
  width,
  height,
}: {
  card: PreviewCard;
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
        background(card.current ? PALETTE.tileSelected : PALETTE.tile),
        cornerRadius(radius),
        border({
          color: card.current ? PALETTE.accent : PALETTE.stroke,
          width: card.current ? 2 : 1,
        }),
        clipShape('roundedRectangle'),
      ]}>
      <Text
        modifiers={[
          font({ size: 13, weight: 'semibold' }),
          foregroundColor(card.current ? PALETTE.accent : PALETTE.primary),
        ]}>
        {card.title}
      </Text>
      <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundColor(PALETTE.secondary)]}>
        {card.detail}
      </Text>
    </VStack>
  );
}

/** A Session or Window: its preview, with a badge and a label chip over it. */
function PreviewButton({
  card,
  width,
  height,
  onSelect,
}: {
  card: PreviewCard;
  width: number;
  height: number;
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
          background(PALETTE.tile),
          cornerRadius(12),
          border({
            color: card.current ? PALETTE.accent : PALETTE.stroke,
            width: card.current ? 1.25 : 1,
          }),
          clipShape('roundedRectangle'),
        ]}>
        <PreviewText lines={card.preview} />

        {card.badge !== undefined ? (
          <Text
            modifiers={[
              font({ size: 12, weight: 'bold' }),
              frame({ width: 28, height: 28 }),
              foregroundColor(card.current ? '#ffffff' : PALETTE.primary),
              background(card.current ? PALETTE.accent : PALETTE.well),
              cornerRadius(8),
              offset({ x: 8, y: 8 }),
            ]}>
            {card.badge}
          </Text>
        ) : null}

        <VStack>
          <Spacer />
          <HStack>
            <Text
              modifiers={[
                font({ size: 11 }),
                padding({ horizontal: 8, vertical: 5 }),
                background(PALETTE.scrim),
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

/** What the Window is showing, in the smallest readable monospace. */
function PreviewText({ lines }: { lines: string[] }) {
  return (
    <VStack alignment="leading" spacing={0} modifiers={[padding({ all: 8 })]}>
      {lines.map((line, index) => (
        <HStack key={index} spacing={0}>
          <Text
            modifiers={[
              font({ size: 7, design: 'monospaced' }),
              foregroundColor(PALETTE.secondary),
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
 * offers, divided rather than separated — the same shape as the Dock, because
 * it is the same kind of thing.
 */
function Footer({
  actions,
  onAction,
  zoom,
}: {
  actions: SheetAction[];
  onAction?: (id: string) => void;
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}) {
  return (
    <HStack
      spacing={0}
      modifiers={[
        frame({ width: CONTENT_WIDTH, height: ACTION_BAR_HEIGHT }),
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
              foregroundColor(PALETTE.primary),
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
            modifiers={[padding({ horizontal: 11 }), tint(PALETTE.accent)]}
          />
        </>
      ) : null}
    </HStack>
  );
}

function rowsOf(cards: PreviewCard[], perRow: number): PreviewCard[][] {
  const rows: PreviewCard[][] = [];
  for (let index = 0; index < cards.length; index += perRow) {
    rows.push(cards.slice(index, index + perRow));
  }
  return rows;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
