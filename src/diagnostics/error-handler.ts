export interface NativeException {
  message: string;
  name?: string | null;
  componentStack?: string | null;
  stack: readonly { methodName: string; file?: string | null; lineNumber?: number | null; column?: number | null }[];
  isFatal: boolean;
}
export interface ErrorRuntime {
  RN$registerExceptionListener?: (listener: (error: NativeException) => void) => void;
}
export interface ExceptionReports {
  unstable_setExceptionDecorator(decorate: (report: NativeException) => NativeException): void;
}

export function installErrorHandlers(runtime: ErrorRuntime, reports: ExceptionReports, record: (error: unknown, fatal: boolean) => void) {
  const capture = (report: NativeException) => {
    if (!report.isFatal) return;
    try {
      const error = new Error(report.message);
      error.name = report.name ?? 'Error';
      error.stack = report.stack.map((frame) => `${frame.methodName} (${frame.file ?? 'unknown'}:${frame.lineNumber ?? '?'}:${frame.column ?? '?'})`).join('\n');
      Object.assign(error, { componentStack: report.componentStack });
      record(error, true);
    } catch { /* Reporting must not replace the original failure. */ }
  };
  // React Native can use its JavaScript pipeline even when the native listener exists.
  runtime.RN$registerExceptionListener?.(capture);
  reports.unstable_setExceptionDecorator((report) => {
    capture(report);
    return report;
  });
}
