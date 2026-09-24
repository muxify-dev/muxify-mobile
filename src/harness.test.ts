import { Platform } from 'react-native';

/**
 * Smoke test for the test harness itself (ticket 02).
 *
 * Proves that TypeScript test files compile and run, and that the `jest-expo`
 * preset resolves React Native modules. Real behavioural tests live next to the
 * modules they cover.
 */
describe('test harness', () => {
  it('runs TypeScript test files', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves react-native through the jest-expo preset', () => {
    expect(['ios', 'android', 'web', 'macos', 'windows']).toContain(Platform.OS);
  });
});
