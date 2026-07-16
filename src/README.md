# Browser Coder modular source

This package splits the original `main.ts` into smaller TypeScript modules while preserving the same runtime behavior and public integration contract.

## Files

- `main.ts` — application bootstrap and orchestration
- `components/dom.ts` — DOM element references
- `components/settings.ts` — localStorage UI settings
- `components/output.ts` — status/output helpers
- `components/turtle.ts` — Turtle renderer
- `components/keyword-help.ts` — keyword help popup
- `components/run-loader.ts` — Run button loading state
- `components/download.ts` — single-file download helper
- `components/monaco-config.ts` — Monaco workers/version configuration
- `components/code-analysis.ts` — function parsing and definition extraction
- `components/project-path.ts` — project path normalization

## Installation

Copy `main.ts` and the entire `components/` directory into the same source directory where the original `main.ts` lived.

No HTML, API, route, storage, tabs, language, build, or production deployment contract was changed.

## Production build

Run the same build command already used by the project, for example:

```bash
npm run build
```

Then rebuild/redeploy the production image exactly as before.
