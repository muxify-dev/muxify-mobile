import { installErrorHandlers, type ErrorRuntime, type ExceptionReports, type NativeException } from './error-handler';

const report: NativeException = { message: 'render failed', isFatal: true, componentStack: 'at Header',
  stack: [{ methodName: 'render', file: 'index.js', lineNumber: 12, column: 4 }] };

function runtime() {
  let native: ((report: NativeException) => void) | undefined;
  let legacy: ((report: NativeException) => NativeException) | undefined;
  const engine: ErrorRuntime = { RN$registerExceptionListener: (next) => { native = next; } };
  Object.defineProperty(engine, 'RN$handleException', { value: () => true, writable: false });
  const reports: ExceptionReports = { unstable_setExceptionDecorator: (next) => { legacy = next; } };
  return { engine, reports, native: (value: NativeException) => native!(value), legacy: (value: NativeException) => legacy!(value) };
}

it('records native errors without replacing the read-only runtime handler', () => {
  const source = runtime();
  const record = jest.fn();
  expect(() => installErrorHandlers(source.engine, source.reports, record)).not.toThrow();
  source.native(report);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ message: 'render failed',
    stack: 'render (index.js:12:4)', componentStack: 'at Header' }), true);
});

it('records JavaScript pipeline errors even when the native listener exists', () => {
  const source = runtime();
  const record = jest.fn();
  installErrorHandlers(source.engine, source.reports, record);
  expect(source.legacy(report)).toBe(report);
  expect(record).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ message: 'render failed' }), true);
});

it('does not collect nonfatal reports or prevent the original error handling', () => {
  const source = runtime();
  const record = jest.fn(() => { throw new Error('disk full'); });
  installErrorHandlers(source.engine, source.reports, record);
  source.native({ ...report, isFatal: false });
  source.legacy({ ...report, isFatal: false });
  expect(record).not.toHaveBeenCalled();
  const fatal = { ...report, preventDefault: jest.fn() };
  expect(() => source.native(fatal)).not.toThrow();
  expect(source.legacy(fatal)).toBe(fatal);
  expect(fatal.preventDefault).not.toHaveBeenCalled();
});
