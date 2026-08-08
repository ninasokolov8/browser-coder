# Frontend source ownership

`src/main.ts` is the browser composition root. It creates the workspace, editor,
command registry, diagnostics store, and feature controllers in dependency order.
New behavior should live in the narrowest owning folder and be wired from the
composition root.

| Folder | Owns | Must not own |
| --- | --- | --- |
| `app/` | Runtime references, URL/runtime configuration, lazy boundaries | Feature UI |
| `commands/` | Command identity, availability policy, keybindings | Feature implementation |
| `components/` | Reusable DOM/Monaco UI primitives | Workspace or HTTP policy |
| `diagnostics/` | Diagnostic normalization, merging, staleness | Error teaching copy |
| `features/` | User-facing feature controllers and views | Direct IndexedDB access |
| `i18n/` | Locale selection, interpolation, English/Hebrew catalogs | Language syntax |
| `integrations/` | Step-Up message protocol and origin boundary | IDE domain state |
| `languages/` | Client language metadata, syntax/check loaders | Server processes |
| `styles/` | Application styling and theme variables | Runtime behavior |
| `workspace/` | Documents, tree, persistence, models, events | Feature-specific UI |

Cross-cutting conventions:

- Use the workspace service for files and persistence.
- Register actions through the command registry when more than one surface can
  invoke them.
- Keep domain results structured; translate them only at the presentation edge.
- Put all translatable UI copy in both locale catalogs.
- Return listener disposers where initialization can be repeated.
- Avoid import-time filesystem, network, or timer side effects.

The complete map and server boundaries are in
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
