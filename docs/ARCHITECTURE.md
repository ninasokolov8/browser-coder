# Architecture and ownership

This is the current module map. The long-form refactor ledger is retained under
`docs/history/` as evidence and decision history.

## Runtime boundaries

Browser Coder has three independently testable boundaries:

1. The browser workbench, composed by `src/main.ts`.
2. The HTTP/execution service, composed by `server.mjs`.
3. Per-language metadata and debugger/runtime adapters under `languages/<id>/`.

The Step-Up host is outside the IDE boundary. It communicates only through the
validated integration protocol in `src/integrations/`.

## Frontend dependency direction

```text
main
 |- app/runtime + app/config
 |- workspace service
 |- command registry
 |- diagnostics store/sources
 |- editor and reusable components
 '- feature controllers
      '- integration/presentation adapters
```

Feature modules may depend on workspace, commands, diagnostics, components, i18n, and
language metadata. Workspace/domain modules do not depend on feature UI. Structured
domain outcomes are translated only when rendered.

Important ownership points:

- `workspace/service.ts` is the application-facing filesystem API.
- `workspace/store-indexeddb.ts` is the persistence adapter.
- `workspace/monaco/` owns model lifecycle.
- `commands/registry.ts` is the single user-action policy boundary.
- `diagnostics/store.ts` merges diagnostics from Monaco, local syntax checks, and
  the server.
- `features/debug/` owns recorded pause state and debugger presentation.
- `features/explorer/` owns file-tree interaction and reference refactoring.
- `i18n/index.ts` owns locale loading, fallback, interpolation, plural selection,
  document direction, and language-change notification.
- `styles/app.css` is the ordered stylesheet entrypoint; the sibling stylesheets
  separate theme/base, title bar, workspace, debugger, auxiliary surfaces, and
  responsive/embed concerns.

## Server dependency direction

```text
server.mjs
 |- config + logging + lifecycle
 |- HTTP middleware
 |- HTTP route adapters
 |- execution pipeline + session registry
 |- language registry/adapters
 '- blob, preview, share, graphics, and security services
```

HTTP modules validate/translate requests and responses. They do not implement
language compilation, process lifecycle, or storage policy. The execution pipeline
selects catalog-driven language adapters. Each run receives its own job directory;
interactive sessions are bounded and registered centrally.

Storage services are independent:

- Blob storage is a disposable content-addressed asset cache.
- Share storage holds expiring read-only workspace snapshots.
- Preview storage holds expiring web projects.

All three need shared directories when more than one API replica is active.

## Language packages

Each `languages/<id>/` directory owns:

- `config.json`: language identity, extension, profiles, and capabilities;
- starter files;
- English and Hebrew keyword/error teaching catalogs;
- debugger/runtime helpers unique to that language.

Server version resolution reads these configs. Adding a language should not require a
new hardcoded extension map in the core.

## Internationalization

Product UI belongs in `src/i18n/locales/en.json` and `he.json`. HTML uses
`data-i18n*` attributes; TypeScript uses `t` and `tn`. Translation validation is
a build gate.

Do not translate:

- source code, identifiers, filenames, encodings, or language IDs;
- raw compiler/runtime output where exact text helps diagnosis;
- protocol field names and stable API error codes.

Translate the explanatory presentation around those values.

## Extension checklist

For a feature:

1. Put domain state/logic in its owning module.
2. Keep UI rendering and translated copy at the presentation boundary.
3. Register shared actions in the command registry.
4. Return disposers for repeatable initialization.
5. Add unit coverage for logic and browser coverage for critical wiring.

For a language:

1. Add a complete `languages/<id>/config.json`.
2. Add paired English/Hebrew teaching data.
3. Implement and register the server adapter.
4. Declare real capabilities rather than inferring from language name.
5. Add contract coverage for run/check/debug behavior.

## Automated architecture gates

- repository-wide UTF-8, LF, JSON, JavaScript-syntax, and path hygiene checks
- TypeScript unused-local/parameter checks
- Knip unused file/export/dependency checks
- runtime import-cycle and duplicate-source checks
- i18n parity, placeholder, usage, duplicate-key, report-hub, and security-
  explanation coverage checks
- unit, browser, contract, operations, image, and security CI jobs
- production-bundle check that development test seams were removed
