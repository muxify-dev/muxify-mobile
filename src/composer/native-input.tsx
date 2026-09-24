import { requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType, Ref } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export interface ComposerInputRef {
  focus(): Promise<boolean>;
  blur(): Promise<boolean>;
  paste(): Promise<void>;
}

export interface ComposerInputProps extends ViewProps {
  ref?: Ref<ComposerInputRef>;
  value: { text: string; eventCount: number };
  editable: boolean;
  dark: boolean;
  textColor: string;
  tintColor: string;
  onTextChange(event: NativeSyntheticEvent<{ text: string; eventCount: number }>): void;
  onImagePaste(event: NativeSyntheticEvent<{ id: string }>): void;
}

export const ComposerInput = requireNativeView('ComposerInput') as ComponentType<ComposerInputProps>;
export const nativePaste = requireNativeModule<{
  preparePaste(id: string): Promise<{ uri: string; name: string }>;
  releasePaste(id: string): Promise<void>;
}>('ComposerInput');
