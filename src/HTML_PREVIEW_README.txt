Browser Coder HTML/CSS Live Preview

Replace the included files in the same paths, then rebuild the frontend.

Features:
- Built-in HTML5 and CSS3 language support
- HTML and CSS Monaco syntax highlighting
- HTML/CSS file creation and extension detection
- Open Preview button for active HTML files
- Ctrl/Cmd+Enter or Run opens HTML in a new tab
- Workspace-local CSS and classic JavaScript are bundled into the preview
- JavaScript module imports are resolved for normal acyclic module graphs
- CSS @import and url(...) references are resolved
- Local src/href/poster assets are embedded when stored as text
- Preview runs in a sandboxed iframe with an opaque origin
- HTML/CSS paths are updated when files or folders are moved or renamed

Limitations:
- Binary images are not stored by the current text-file storage layer.
  Text SVG files work; binary upload support requires a binary-capable storage update.
- Circular ES module graphs produce a warning and use a safe fallback.
