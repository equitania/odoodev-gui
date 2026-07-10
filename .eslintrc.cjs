module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    "eslint:recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-empty": ["error", { allowEmptyCatch: true }],
  },
  ignorePatterns: ["dist", "src-tauri", "node_modules"],
};