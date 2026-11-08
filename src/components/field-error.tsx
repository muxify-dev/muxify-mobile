import { Text } from '@expo/ui/swift-ui';
import { font, foregroundColor, frame } from '@expo/ui/swift-ui/modifiers';

import type { Appearance } from '@/constants/app-theme';

/** Why a sheet did not save, in red under the field it is about. Nothing when there is no error. */
export function FieldError({ error, palette }: { error: string | undefined; palette: Appearance }) {
  if (error === undefined) return null;
  return (
    <Text
      modifiers={[
        font({ size: 13 }),
        foregroundColor(palette.destructive),
        frame({ maxWidth: 3000, alignment: 'leading' }),
      ]}>
      {error}
    </Text>
  );
}
