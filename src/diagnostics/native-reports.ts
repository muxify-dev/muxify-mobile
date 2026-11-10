import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface NativeReport { id: string; text: string }
interface NativeDiagnostics { reports(): { reports: NativeReport[]; error?: string } }

export function nativeReports(): { reports: NativeReport[]; error?: string; available: boolean } {
  try {
    const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeDiagnostics>('MuxifyDiagnostics') : null;
    return native ? { ...native.reports(), available: true } : { reports: [], available: false };
  } catch {
    return { reports: [], available: false, error: 'iOS diagnostic reports could not be read.' };
  }
}
