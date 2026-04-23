import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    // Buf / Connect generated TypeScript. Source of truth is idl/**.
    'src/gen/**/*',
    '**/*_pb.ts',
    '**/*.connect.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // These React Compiler rules currently flag existing patterns across the
      // app. Keep lint actionable while the project is still in UI rebuild mode.
      'react-hooks/immutability': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/lib/i18n/provider.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: [
      'src/components/app/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
      'src/routes/**/*.{ts,tsx}',
    ],
    ignores: [
      'src/components/app/shared/shiki-code-frame.tsx',
      'src/components/app/shared/skill-reference-chip.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXText[value=/[A-Za-z][A-Za-z0-9 ,.!?;:()&+-]{2,}/]',
          message:
            'Stable UI copy must use react-i18next. Add a key in src/lib/i18n/messages.ts and render it with t(...).',
        },
      ],
    },
  },
])
