import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'dist-viewer', 'release', 'src-tauri', 'node_modules', 'test-results', 'playwright-report', 'evidence'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true }],
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='innerHTML']", message: 'ユーザー文字列はtextContentで表示する' },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
