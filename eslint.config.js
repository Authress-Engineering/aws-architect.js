const nodePlugin = require('eslint-plugin-node');
const importPlugin = require('eslint-plugin-import');
const promisePlugin = require('eslint-plugin-promise');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', '.git/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        global: 'readonly'
      }
    },
    plugins: {
      node: nodePlugin,
      import: importPlugin,
      promise: promisePlugin
    },
    rules: {
      'arrow-parens': ['error', 'as-needed'],
      'indent': ['error', 2, { 'SwitchCase': 1, 'MemberExpression': 0 }],
      'node/no-unsupported-features/es-syntax': ['off'],
      'no-throw-literal': 'off',
      'spaced-comment': 'off',
      'no-continue': 'off',
      'require-atomic-updates': 'off'
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly'
      }
    }
  }
];
