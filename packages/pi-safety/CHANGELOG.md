# @marcfargas/pi-safety

## 0.1.1

### Patch Changes

- Fix pattern validation rejecting runner prefixes (npx, node, python, etc.).

  Patterns like `"npx go-gmail * search *"` with tool name `"go-gmail"` were silently
  rejected because validation required patterns to start exactly with the tool name.
  Now allows known runner prefixes before the tool name. Added test for npx patterns.
