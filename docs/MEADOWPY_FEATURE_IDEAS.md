# Feature Ideas from MeadowPy — What Browser Coder Could Add

**Source analyzed:** `MeadowPy-main/` (a local, Windows-only, single-language PyQt6 desktop IDE for
beginner Python learners, with a local Ollama AI assistant, step-through debugger, and linting).

**Context:** Browser Coder is a **multi-language** (JavaScript, TypeScript, Python, Java, PHP, C#),
**multi-tenant**, **containerized web IDE** where every "Run" spawns a short-lived, sandboxed,
timeout-bound subprocess with no persistent state, no shell access, and no outbound network
(see `server.mjs` `SmartExecutor`/`runProcess`, and `security/`). MeadowPy's features assume the
opposite: one user, one language, a long-lived local process, and full OS access. So each idea
below is re-scoped for Browser Coder's architecture, not copied as-is.

Every feature is scored on:
- **Languages affected** — does it need per-language work for all 6 supported languages?
- **Security impact** — does it touch the sandbox / attack surface tested by `security/attacks/*.mjs`?
- **Effort** — S / M / L / XL

---

## Already covered (no work needed)

Cross-checked against MeadowPy's feature list so we don't duplicate effort:

| MeadowPy feature | Browser Coder status |
|---|---|
| Tabbed editing, syntax highlighting, themes | ✅ Have it (Monaco, dark/light) |
| Auto-completion, smart indent, auto-close brackets | ✅ Have it (Monaco defaults) |
| Find & replace across files | ✅ Have it (Search panel) |
| Hover tooltips | ✅ Already enabled (`hover: { enabled: true }` in `src/main.ts`) |
| Multi-cursor editing | ✅ Free via Monaco (Alt+Click / Cmd+D) — not actually missing |
| Starter/example project per language | ⚠️ Partial — one starter file per language exists (`languages/*/starters/`), not a curated multi-template gallery |
| "Run specific function" list | ✅ Have it — and its function/class detection logic is reusable for a symbol outline (see below) |

---

## Tier 1 — Low risk, stateless, per-request (build first)

These fit the existing "spawn → capture output → return" model with no architecture change.

### 1. Beginner-friendly error explainer
Translate raw stderr into a plain-English hint, like MeadowPy's `error_explainer.py`
(regex → template, ~100+ patterns across `error_pattern_groups/`).

- **What it needs per language:** a hand-written regex→explanation pattern library for each
  runtime's real error output:
  - Python: tracebacks (`NameError`, `IndentationError`, `ModuleNotFoundError`, ...) — closest to a 1:1 port of MeadowPy's existing patterns.
  - JavaScript/TypeScript: V8 exceptions (`ReferenceError`, `TypeError`, `SyntaxError`) + `tsc` diagnostic codes (TSxxxx).
  - PHP: `Fatal error:` / `Parse error:` / `Warning:` output format.
  - Java: `javac` compiler errors + `Exception in thread "main" ...` stack traces.
  - C#: `CSxxxx` compiler errors + unhandled `System.*Exception` traces.
- **Where it lives:** pure post-processing of `stdout`/`stderr` already returned by `/api/run` — can
  run client-side in `src/main.ts` or server-side in `server.mjs`, either works.
- **Security impact:** none — it only reads text the sandbox already produced.
- **Effort:** M (mainly content authoring × 6 languages, ~15-20 patterns per language for parity with MeadowPy).

### 2. Clickable tracebacks (jump from output to file:line)
- **What it needs:** a regex per language to extract `(file, line)` from its native trace format
  (Python `File "x.py", line N`; Node `at file:line:col`; Java `at Class.method(File.java:N)`; C#
  `in /path:line N`; PHP `in /path on line N`), then call Monaco's `revealLineInCenter` +
  `setPosition` (already used elsewhere in `src/main.ts` for "Run specific function").
- **Security impact:** none.
- **Effort:** S–M.

### 3. "Explain this keyword" popup
Right-click (or hover) a keyword and show a plain-English explanation + example, like MeadowPy's
`keyword_help_popup.py` (50+ keywords documented).
- **What it needs:** a static keyword dictionary per language (`for`, `class`, `async`, `try`, etc.)
  — content authoring only, ~40-60 entries × 6 languages. UI: a Monaco context-menu action or hover
  provider rendering a small popup (MeadowPy's popup widget is a good visual reference).
- **Security impact:** none (static content, no execution).
- **Effort:** M (content-heavy, trivial engineering).

### 4. Expanded starter-template gallery + first-run welcome screen
MeadowPy ships 6 starter templates (Hello World, Calculator, Guessing Game, Todo List, Turtle
Graphics, Quiz) shown on a welcome screen.
- **What it needs:** author ~5-6 templates per language (`languages/*/starters/` already has the
  folder structure — just add more files + a `templates` list in each `config.json`), plus a
  first-load "Welcome" UI panel (matches the Admin/Instructor/Student portal principle of guided
  first-run screens — StepUp cognitive architecture applies equally well here).
- **Caveat:** MeadowPy's "Turtle Graphics" template needs a graphical canvas output channel, which
  Browser Coder doesn't have today (output panel is text-only, see `panelContentEl`). Either skip
  that template or scope a separate "graphics/canvas output" feature (out of scope here).
- **Security impact:** none (static files).
- **Effort:** M (content × 30-36 files) + S (UI).

### 5. Keyboard shortcut list/editor
- **What it needs:** enumerate current Monaco/app keybindings, add a searchable panel (Help menu),
  allow rebinding + reset-to-default, persisted the same way `IDESettings` is today (localStorage).
- **Security impact:** none.
- **Effort:** S–M.

---

## Tier 2 — Moderate effort, needs a new (still sandboxed) capability

### 6. Real-time linting / Problems panel
MeadowPy runs flake8/pylint as a subprocess and shows a clickable Problems panel.
- **Per-language tool mapping:**
  | Language | Linter |
  |---|---|
  | JavaScript/TypeScript | ESLint (or reuse Monaco's built-in TS diagnostics — already free for TS/JS) |
  | Python | `pyflakes` (lightweight) or `pylint`/`flake8` (heavier, matches MeadowPy exactly) |
  | PHP | PHP_CodeSniffer or PHPStan |
  | Java | Checkstyle/PMD, or just `javac -Xlint` |
  | C# | Roslyn analyzers via `dotnet build` warnings |
- **What it needs:** a new `/api/lint` endpoint that runs the linter as a **sandboxed** subprocess
  (reuse `runProcess()`'s timeout/memory/env isolation, same as `/api/run`) and returns structured
  `{line, column, severity, message}` issues instead of raw stdout. A `ProblemsPanel` UI component
  (click → jump to line), mirroring MeadowPy's `problems_panel.py`.
- **Security impact:** low, if scoped correctly — the *user's code* still goes through
  `validateCodeSecurity()` exactly like `/api/run` (it's the same untrusted input); the *linter
  binaries themselves* are first-party trusted tooling, not user input, so they don't need to pass
  through the dangerous-pattern check. Also increases each language's Docker image with new
  packages (ESLint, pyflakes, phpcs, checkstyle, Roslyn analyzers) — check final image size budget.
- **Effort:** L (6 language integrations + new endpoint + UI panel).

### 7. Symbol outline / code navigation panel
MeadowPy uses Python's `ast` module to list classes/functions in a dockable panel.
- **JS/TS:** Monaco's built-in TypeScript language service can already produce this
  (`getNavigationTree`/document symbols) — cheapest, near-free win.
- **Python/PHP/Java/C#:** Monaco has no real language service for these (syntax highlighting only).
  Two paths:
  - **Cheap route (recommended to start):** reuse the function/class-detection logic that
    **already exists** in `src/main.ts` for the "Run specific function" panel —
    it's regex/heuristic-based per language already, just needs a tree-view UI instead of a run-list.
  - **Full route:** stand up real language servers (pyright/python-lsp-server, phpactor/intelephense,
    jdt.ls, omnisharp) — each is a heavyweight, stateful, memory-hungry background process per
    session, which conflicts with the current "spawn per request, no persistent process" model.
- **Security impact:** none for the cheap route (pure text parsing); the full LSP route would need
  its own resource/lifecycle policy (idle timeout, memory caps) similar to a debug session (see Tier 3).
- **Effort:** S (JS/TS, and Python/PHP/Java/C# cheap route) vs. XL (full LSP route).

### 8. Interactive stdin / mini "REPL"
Prerequisite for anything debugger-like, and useful on its own (today `runProcess()` never writes
to the child's stdin — a program that calls `input()`/`Scanner`/`Console.ReadLine()` just hangs
until timeout).
- **What it needs:** a WebSocket (or long-poll) channel per run so the browser can stream stdin
  bytes to the still-running sandboxed process; all 6 language runners already read stdin natively
  (`python3 -u`, `node`, `java` w/ `Scanner`/`System.in`, `php` w/ `STDIN`, `dotnet` w/
  `Console.ReadLine`), so this is one plumbing change, not 6 separate integrations.
- **Security impact:** must keep the **same** timeout/kill-switch semantics — a process "waiting
  for input forever" is a resource-hold DoS vector, so add an *idle* timeout in addition to the
  existing wall-clock timeout, and rate-limit concurrent "waiting" sessions per IP.
- **Effort:** L.

---

## Tier 3 — High effort and/or conflicts with the current security model

These need explicit design review before committing to — flagging the trade-offs rather than
just the mechanics.

### 9. Step-through debugger (breakpoints, step over/into/out, variable inspector, watch expressions, call stack)
MeadowPy's `debug_manager.py`/`debug_helper.py` runs a **long-lived, pausable** local subprocess
controlled over a TCP protocol. This is the single biggest architecture mismatch with Browser
Coder:

- Every `/api/run` today is fire-and-forget with a hard timeout (10s default, up to 45s for C#)
  and **no bidirectional control channel** — a pausable process needs the opposite model entirely.
- **Different debug protocol per language** (this alone is 5 separate integrations, not one):
  - Python → `pdb`/`debugpy` (most mature, easiest starting point)
  - JavaScript/TypeScript → Node `--inspect` + Chrome DevTools Protocol
  - Java → JDWP (`java -agentlib:jdwp`, `jdb`)
  - C# → `netcoredbg`/`vsdbg`
  - PHP → Xdebug
- **Security impact is significant, not incidental:** a debugger's whole purpose is pausing
  execution indefinitely and evaluating arbitrary expressions in the paused process's memory —
  this directly overlaps with the "eval / code injection" attack category the security suite
  already tests against (`security/attacks/*.mjs`), and an indefinitely-paused process is exactly
  the kind of resource hold the timeout/kill-switch model exists to prevent. This would need a
  **separate, isolated execution tier** (one container per debug session, its own stricter
  memory/CPU/wall-clock ceiling, forced kill after an idle-while-paused timeout) — not a bolt-on
  to the existing sandbox.
- **Recommendation:** treat as a major initiative, not a feature ticket. If pursued, scope an MVP
  to **one language only** (Python via `debugpy`) before generalizing to the rest.

### 10. Integrated terminal with real shell access
- **Directly conflicts** with Browser Coder's core security model.
  `validateCodeSecurity()` explicitly blocks shell/process-execution APIs in every language
  (`child_process`/`exec`, `Runtime.exec`/`ProcessBuilder`, `System.Diagnostics.Process`,
  `shell_exec`/`system`, etc.), and the security suite has an entire **Command Execution** attack
  category specifically proving these stay blocked. A real terminal is the same capability by
  another name.
- **Recommendation:** not recommended. Tier 2's interactive stdin (#8) delivers most of the
  beginner-facing value ("my program is asking me for input") without reopening the
  shell-execution attack surface.

### 11. Git basics panel
- Needs the `git` binary, a real **persistent** per-user/session working directory (today's
  sandbox is ephemeral tmpfs, wiped after every run), and **outbound network access to a remote**
  — the sandbox's `internal` Docker network explicitly has none today.
- **Recommendation:** out of scope unless/until persistent per-user workspaces and outbound git
  network access become their own reviewed initiative.

---

## Local AI Assistant — its own category (biggest single opportunity)

MeadowPy's standout feature is a **local, offline** AI assistant (via Ollama) for "Explain this
code", "Review & improve", "Generate docstring", and a chat sidebar — no account, no data leaves
the machine. This philosophy actually maps *better* onto Browser Coder's security-first design
than most of MeadowPy's other features, because the model can run **inside the same trusted
Docker network** with no external API calls — no user code or PII ever leaves the stack, matching
the project's "sandboxed learning environment" positioning.

- **What it needs:**
  - A new `ollama` service in `docker-compose.yml` **and** `docker-compose.prod.yml`, on the
    existing `internal` network (never exposed publicly, same trust boundary as `api`).
  - A memory budget decision — coding-capable local models are RAM-hungry; the DigitalOcean
    droplet sizes in `docs/DEPLOY.md` ($12-24/mo, 2-4GB RAM) may not comfortably fit a
    good code model alongside the existing per-language runtimes (Python/JDK/PHP/.NET) already
    installed in the `api` image — likely needs a dedicated larger droplet/VM for this feature.
  - New endpoints (`/api/ai/chat`, `/api/ai/explain`, `/api/ai/review`, `/api/ai/docstring`)
    proxying to Ollama with a system prompt that includes the target language — **one
    implementation serves all 6 languages** (the LLM doesn't need per-language special-casing
    beyond prompt text), making this the *least* per-language-divergent feature on this whole list.
  - Streaming (SSE or WebSocket) into a new chat sidebar / inline popup, mirroring MeadowPy's
    `ai_chat_panel.py` token-by-token streaming UX.
- **Security impact:**
  - Low risk of sandbox bypass: Ollama only generates text, it never executes the user's code, so
    it can't be used to escape the sandbox.
  - Should be rate-limited **separately** from `/api/run` so it can't become its own
    resource-exhaustion vector.
  - Explaining code that *did* trip the security patterns is fine (and on-brand for this project's
    "Hacker's Classroom" educational angle) but should still be logged like any other blocked
    attempt, for consistency with existing `security_block` logging in `server.mjs`.
- **Effort:** XL — new service + memory budget/infra decision + prompt engineering × use cases +
  streaming UI + rate limiting, but arguably the highest-value, most "on-brand" addition on this
  list since it doesn't fragment by language.

---

## Priority Summary

| # | Feature | Languages affected | Security impact | Effort | Suggested phase |
|---|---|---|---|---|---|
| 1 | Beginner error explainer | All 6 (separate patterns) | None | M | Phase 1 |
| 2 | Clickable tracebacks | All 6 (separate regex) | None | S–M | Phase 1 |
| 3 | Keyword explain popup | All 6 (content only) | None | M | Phase 1 |
| 4 | Starter template gallery + welcome screen | All 6 (content only) | None | M+S | Phase 1 |
| 5 | Keyboard shortcut editor | None (editor-wide) | None | S–M | Phase 1 |
| 6 | Linting / Problems panel | All 6 (separate tool per language) | Low (new sandboxed subprocess type) | L | Phase 2 |
| 7 | Symbol outline panel | JS/TS free; others need work | None (cheap route) | S–XL | Phase 2 |
| 8 | Interactive stdin / mini REPL | All 6 (shared plumbing) | Medium (needs idle-timeout policy) | L | Phase 2 |
| 9 | Step-through debugger | All 6 (5 different protocols) | High (needs isolated tier) | XL | Phase 3 / major initiative |
| 10 | Integrated real terminal | N/A | **Conflicts with sandbox model** | — | Not recommended |
| 11 | Git basics panel | N/A | High (persistence + network) | XL | Out of scope for now |
| — | Local AI assistant (Ollama) | All 6 (single implementation) | Low, if rate-limited separately | XL | High-value, phase after infra sizing |

**Suggested order:** Phase 1 items are pure content/UI work with zero sandbox risk and can ship
independently and incrementally. Phase 2 introduces one new "sandboxed but non-`Run`" subprocess
category (linting) and one new transport capability (stdin streaming) — both reusable building
blocks for later features. The AI assistant is the standout differentiator but needs an infra
sizing decision first. The debugger and integrated terminal are the two ideas that most directly
push against Browser Coder's current security model and should go through explicit design review
rather than being scheduled as normal feature work.
