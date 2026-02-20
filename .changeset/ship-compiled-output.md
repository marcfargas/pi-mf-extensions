---
"@marcfargas/pi-test-harness": minor
---

Ship compiled `.js` + `.d.ts` output instead of raw TypeScript sources

Previously, the package shipped only `.ts` source files and relied on consumers having a TypeScript-aware loader (jiti, vitest). Node 24's `--experimental-strip-types` refuses to process `.ts` files inside `node_modules/`, making the package unusable with `node --test` or any Node-native test runner.

Now:
- Package exports point to pre-compiled `dist/index.js` (with `dist/index.d.ts` for types)
- Source `.ts` files are still included for debugging/source maps
- Build step (`tsc -p tsconfig.build.json`) runs automatically before publish via `prepublishOnly`
