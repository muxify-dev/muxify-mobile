// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.cook/*', '.scratch/*'],
  },
  {
    // The e2e suites run under Node's jest, not Metro, so process.env is a plain object there.
    files: ['e2e/**'],
    rules: {
      'expo/no-env-var-destructuring': 'off',
    },
  },
  {
    // Baseline: these files predate the lint setup and break React Compiler rules.
    // They stay warnings here until each is reworked; new files get the rules as errors.
    files: [
      'src/app/topic-add-session.tsx',
      'src/app/topic-edit.tsx',
      'src/app/topic-form.tsx',
      'src/components/banner.tsx',
      'src/components/title-sheet.tsx',
      'src/hooks/use-color-scheme.web.ts',
      'src/hooks/use-host-entry.test.tsx',
      'src/hooks/use-keyboard-frame.ts',
      'src/hooks/use-physical-keyboard.ts',
      'src/settings/settings-context.test.tsx',
      'src/settings/settings-context.tsx',
      'src/tmux/attach-context.tsx',
    ],
    rules: {
      'react-hooks/globals': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
