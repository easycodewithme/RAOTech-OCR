import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Until now there was no config at all, so tests ran on defaults and every
 * suite had to import relatively. That quietly decided what was testable: any
 * module using the `@/` alias — which is most of the ones that touch the
 * database or the API layer — could not be imported from a test at all, and
 * the alias is a convention the rest of the codebase uses everywhere.
 *
 * Mirrors the `paths` entry in tsconfig.json. If one changes, so must the
 * other, or a module will typecheck and fail to import under test.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
