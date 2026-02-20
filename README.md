# pi-mf-extensions (archived)

> ⚠️ **This monorepo has been split into standalone repositories.** No further development will happen here.

## New Locations

Each package now lives in its own repository:

| Package | New Repository |
|---------|---------------|
| `@marcfargas/pi-planner` | [marcfargas/pi-planner](https://github.com/marcfargas/pi-planner) |
| `@marcfargas/pi-safety` | [marcfargas/pi-safety](https://github.com/marcfargas/pi-safety) |
| `@marcfargas/pi-powershell` | [marcfargas/pi-powershell](https://github.com/marcfargas/pi-powershell) |
| `@marcfargas/pi-test-harness` | [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness) |
| `@marcfargas/permission-gate` | [marcfargas/permission-gate](https://github.com/marcfargas/permission-gate) |

## Why?

The packages were unrelated and the monorepo added release coupling, CI overhead, and cognitive load without benefit. Each package now has its own CI, releases, and issue tracker.

## npm Packages

The npm package names remain the same. Install from npm as before:

```bash
npm install @marcfargas/pi-planner
npm install @marcfargas/pi-safety
npm install @marcfargas/pi-powershell
npm install @marcfargas/pi-test-harness
```
