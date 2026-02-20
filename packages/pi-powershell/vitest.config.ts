import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

export default defineConfig({
  test: {
    environment: "node",
    // pi-powershell is Windows-only — skip tests on other platforms
    ...(isWindows ? {} : { include: [], passWithNoTests: true }),
  },
});