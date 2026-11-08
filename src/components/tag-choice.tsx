import { Button, HStack, Image, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  controlSize,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import type { Tag } from '@/topics/environment';
import { tagColorHex, type ColorAppearance } from '@/topics/tag-color';

/** A Tag that a Topic can have: filled in its Tag colour when chosen, outlined when not. */
export function TagChoice({
  tag,
  chosen,
  appearance,
  fallbackColor,
  onPress,
}: {
  tag: Tag;
  chosen: boolean;
  appearance: ColorAppearance;
  /** For a Tag with no colour the phone can read. */
  fallbackColor: string;
  onPress: () => void;
}) {
  const color = tag.color[appearance];
  return (
    <Button
      label={`#${tag.name}`}
      onPress={onPress}
      modifiers={[
        buttonStyle(chosen ? 'borderedProminent' : 'bordered'),
        controlSize('small'),
        tint(color === null ? fallbackColor : tagColorHex(color, appearance)),
        accessibilityLabel(`Tag #${tag.name}`),
        accessibilityValue(chosen ? 'chosen' : 'not chosen'),
      ]}
    />
  );
}

/**
 * A Tag that the Topic has and the Config no longer defines. It is dashed, as
 * on the Mac, and a tap removes it. The Host refuses to add a Tag that the
 * Config does not define, so once removed it does not come back as a choice.
 */
export function RetiredTagChoice({
  name,
  color,
  onPress,
}: {
  name: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('bordered'),
        controlSize('small'),
        tint(color),
        accessibilityLabel(`Tag #${name}`),
        accessibilityValue('not in the Config, tap to remove'),
      ]}>
      <HStack spacing={4}>
        <Image systemName="square.dashed" size={11} color={color} />
        <Text>{`#${name}`}</Text>
        <Image systemName="xmark" size={9} color={color} />
      </HStack>
    </Button>
  );
}
