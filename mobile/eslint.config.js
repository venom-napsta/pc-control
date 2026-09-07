// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "node_modules/*"],
  },
  {
    // Jest's globals are injected by the test runner, not imported.
    files: ["__tests__/**/*.js", "jest.setup.js", "jest.config.js"],
    rules: {
      // jest.mock() factories must be declared above the imports they replace,
      // and the mock-prefixed variables they reference above that.
      "import/first": "off",
      // Test harnesses render throwaway inline components.
      "react/display-name": "off",
    },
    languageOptions: {
      globals: {
        jest: "readonly",
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
  },
  {
    // CommonJS config files at the project root.
    files: ["*.config.js", "jest.setup.js"],
    languageOptions: { sourceType: "commonjs" },
  },
]);
