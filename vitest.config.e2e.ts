import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__e2e__/**/*.test.ts"],
	},
});
