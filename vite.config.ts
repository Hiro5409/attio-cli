import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    // scripts/update-api-schema.ts owns the layout of the pinned upstream schema.
    ignorePatterns: ["openapi/attio-api.json"],
    printWidth: 100,
    sortImports: true,
  },
  lint: {
    categories: {
      correctness: "error",
    },
    ignorePatterns: ["src/types/**"],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["**/*.test.ts"],
        rules: {
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
          "typescript/no-unsafe-type-assertion": "off",
        },
      },
    ],
    plugins: ["typescript", "unicorn", "oxc", "import"],
    rules: {
      eqeqeq: "error",
      "import/extensions": ["error", "always", { checkTypeImports: true, ignorePackages: true }],
      "import/no-cycle": "error",
      "import/no-self-import": "error",
      "no-promise-executor-return": "error",
      "no-shadow": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "oxc/misrefactored-assign-op": "error",
      "oxc/no-barrel-file": ["error", { threshold: 0 }],
      "preserve-caught-error": "error",
      "typescript/ban-ts-comment": "error",
      "typescript/consistent-type-imports": "error",
      "typescript/no-base-to-string": "off",
      "typescript/no-deprecated": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-unnecessary-condition": ["error", { allowConstantLoopConditions: true }],
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-unsafe-type-assertion": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/restrict-template-expressions": "off",
      "typescript/switch-exhaustiveness-check": "error",
      "unicorn/prefer-node-protocol": "error",
    },
  },
  pack: {
    deps: {
      resolveDepSubpath: false,
    },
    entry: ["src/main.ts"],
    format: ["esm"],
    platform: "node",
    sourcemap: true,
  },
  staged: {
    "*.{js,json,jsonc,md,ts,yaml,yml}": "vp check --fix",
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
