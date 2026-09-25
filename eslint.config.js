import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'local/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The engine must not depend on locale or time zone (CLAUDE.md, Convenções).
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=1][arguments.0.type!='Literal']",
          message: 'Não usar new Date(string) na lógica: fazer o parse manual das datas.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
);
