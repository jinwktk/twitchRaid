// @ts-check
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "*.config.js"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        global: "readonly",
        NodeJS: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // 型安全
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],

      // コーディング規約
      "no-console": "warn",
      "no-debugger": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "multi-line"],
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
