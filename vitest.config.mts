import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    // Run in a zone far from Melbourne, so a test passes only if the code
    // uses the business timezone explicitly rather than the machine's (D22).
    env: { TZ: "America/Los_Angeles" },
  },
});
