import { AppState } from 'react-native';
import { deviceLog, deviceLogs } from './device-log';
import { installErrorHandlers, type ErrorRuntime, type ExceptionReports } from './error-handler';

const exceptionReports: ExceptionReports = require('react-native/Libraries/Core/ExceptionsManager').default;

const runtime = globalThis as typeof globalThis & ErrorRuntime & { muxifyDiagnosticsStarted?: boolean };
if (!runtime.muxifyDiagnosticsStarted) {
  runtime.muxifyDiagnosticsStarted = true;
  installErrorHandlers(runtime, exceptionReports, (error, fatal) => deviceLogs().recordError(error, fatal));
  deviceLog().record('app', 'Launch started');
  AppState.addEventListener('change', (state) => deviceLog().record('app', `State ${state}`));
}
