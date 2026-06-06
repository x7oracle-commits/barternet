import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // Build output and native wrappers (Capacitor copies the minified bundle into
  // android/) are generated — never lint them.
  { ignores: ['dist', 'android', 'node_modules'] },

  // App source (browser + React)
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      // This codebase intentionally doesn't use PropTypes, and React already
      // escapes JSX text — these two rules are pure noise here.
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Test files also get Node + Vitest globals
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },

  // Service worker
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
    rules: { ...js.configs.recommended.rules },
  },

  // ESM config files (project is "type": "module")
  {
    files: ['*.config.js'],
    languageOptions: { globals: globals.node, sourceType: 'module' },
    rules: { ...js.configs.recommended.rules },
  },

  // CommonJS relay server
  {
    files: ['relay-server.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { ...js.configs.recommended.rules },
  },
]
