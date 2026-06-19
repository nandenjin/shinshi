// @ts-check

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";

export default defineConfig(
  globalIgnores(["node_modules", "dist"]),
  // JavaScript and TypeScript source files
  {
    files: ["**/*.{js,ts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  // Vue single-file components — use the vue-eslint-parser with TypeScript support
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        // Enable TypeScript parsing inside <script lang="ts"> blocks
        parser: tseslint.parser,
      },
    },
  },
  prettier,
);
