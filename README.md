# Browser Coder

Browser Coder is a browser-based teaching IDE built around Monaco Editor. It runs
JavaScript, TypeScript, Python, Java, PHP, and C# through a restricted server-side
execution service, and it can be embedded in Step-Up lessons.

The product is designed for learners: it keeps debugger pause history, traces output
back to source, explains common errors, offers safe first-aid fixes, supports
non-stopping logpoints, and can replay Python turtle drawings.

## Development

Requirements:

- Node.js 22.18 or newer
- npm
- A Chromium-based browser for browser tests
- Optional local language toolchains for contract tests: Python 3, PHP, JDK 17,
  and .NET 8

Install once:

```bash
npm ci
```

Run the API and Vite development server in separate terminals:

```bash
npm run dev:server
npm run dev
```

Open `http://localhost:3000`. Vite proxies API requests to
`http://localhost:3001`.

For a production build:

```bash
npm run build
npm start
```

`npm start` is cross-platform and defaults `NODE_ENV` to `production`.

## Verification

```bash
npm run check:files
npm run typecheck
npm run check:i18n
npm run check:unused
npm run check:duplicates
npm run check:architecture
npm run test:unit
npm run test:browser
npm run test:contract
npm run build
```

`npm test` runs the complete non-container suite. Contract tests report a skip when
a required local toolchain is unavailable; CI installs every supported toolchain so
those paths are exercised there. The production-image job also runs the security
corpus against the built container.

## Architecture

The application has explicit composition roots and one-way dependencies:

```text
index.html + src/styles/
        |
        v
src/main.ts
  app/          runtime/configuration
  commands/     centralized user-action policy
  components/   reusable UI primitives
  diagnostics/  normalized diagnostic sources and store
  features/     feature controllers and views
  i18n/         English/Hebrew catalogs and translation runtime
  integrations/ Step-Up message boundary
  languages/    client language catalog/loaders
  workspace/    documents, persistence, Monaco models, events

server.mjs
  server/http/       middleware and route adapters
  server/execution/  jobs, processes, sessions, pipeline
  server/languages/  execution adapters and version resolution
  server/domain/     shared server-domain contracts
  server/{blobs,previews,shares,security,graphics}/

languages/<id>/
  config, starter files, teaching/error data, debugger adapters
```

Core rules:

- `src/main.ts` and `server.mjs` assemble collaborators; domain decisions live in
  focused modules.
- Workspace state is accessed through the workspace service rather than directly
  through IndexedDB or Monaco.
- Commands are registered once so toolbar, keyboard, context-menu, and embedded
  actions share the same policy.
- Server routes translate HTTP; execution and storage rules live below the route
  layer.
- User-facing strings use `src/i18n/locales/en.json` and `he.json`. Language
  teaching data has paired English/Hebrew catalogs under `languages/`.
- Generated reports, dependencies, and build output are not source.

See [the current architecture guide](docs/ARCHITECTURE.md) for ownership boundaries
and extension points.

## Language and learner features

- Six runtime languages with catalog-driven version profiles
- Debugging and conditional/non-stopping logpoints
- Back/forward review of recorded debugger pauses
- Variable history, locals, stack, watches, and breakpoint controls
- Python turtle rendering and replay
- Clickable output-to-source tracing
- Problems panel, live syntax/compiler checks, teaching explanations, and safe fixes
- Multi-file workspace, tabs, search/replace, rename/move reference updates, and
  IndexedDB persistence
- HTML/CSS/JavaScript preview publishing and read-only share links
- English and Hebrew UI with RTL layout support
- Step-Up embedding with origin validation and host/IDE event contracts

## Internationalization

Translate product UI with `t(key, params)` or `tn(key, count, params)`; do not place
English copy in feature/domain state. Add every key to both locale files. Keep code,
identifiers, filenames, raw compiler output, and language syntax in their original
form where translating would be misleading.

`npm run check:i18n` enforces:

- exact key parity between English and Hebrew;
- non-empty values and matching interpolation placeholders;
- valid keys in HTML and source;
- no unused locale entries.

## Deployment

Production uses a prebuilt image, nginx, shared named volumes, health checks, and a
network-isolated API service. Capacity is deliberately derived from container memory
and must be load-tested for the intended class size; this repository makes no fixed
concurrent-user claim.

Use [the deployment runbook](docs/DEPLOY.md). Preview behavior and its security
boundary are documented in [docs/PREVIEWS.md](docs/PREVIEWS.md).

## Documentation

- [Architecture and ownership](docs/ARCHITECTURE.md)
- [Deployment runbook](docs/DEPLOY.md)
- [Web previews](docs/PREVIEWS.md)
- [Writing a marking harness](docs/WRITING_A_MARKING_HARNESS.md)
- [Historical engineering records](docs/history/)

## CI and dependency maintenance

GitHub Actions gates type safety, unused-code/dependency analysis, translation
coverage, unit/browser/contract tests, operations configuration, the production
image, and the security corpus. Dependabot tracks npm, GitHub Actions, and Docker
updates.
