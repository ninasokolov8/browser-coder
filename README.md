<p align="center">
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/javascript/javascript.png" width="54" alt="JavaScript"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/typescript/typescript.png" width="54" alt="TypeScript"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/python/python.png" width="54" alt="Python"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/java/java.png" width="54" alt="Java"/>
  <img src="https://raw.githubusercontent.com/github/explore/ccc16358ac4530c6a69b1b80c7223cd2744dea83/topics/php/php.png" width="54" alt="PHP"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/csharp/csharp.png" width="54" alt="C#"/>
</p>

<h1 align="center">🚀 Browser Coder</h1>

<p align="center">
  <strong>A teaching IDE that remembers how a program got its answer</strong><br>
  <em>Write, run, inspect, replay, and understand code directly in the browser</em>
</p>

<p align="center">
  <a href="https://github.com/ninasokolov8/browser-coder/actions/workflows/ci.yml">
    <img src="https://github.com/ninasokolov8/browser-coder/actions/workflows/ci.yml/badge.svg" alt="CI"/>
  </a>
  <img src="https://img.shields.io/badge/Languages-6-7c3aed?style=flat-square" alt="Six languages"/>
  <img src="https://img.shields.io/badge/UI-English_%2B_Hebrew-0ea5e9?style=flat-square" alt="English and Hebrew"/>
  <img src="https://img.shields.io/badge/Editor-Monaco-2563eb?style=flat-square" alt="Monaco Editor"/>
  <img src="https://img.shields.io/badge/Step--Up-Embedded-f97316?style=flat-square" alt="Step-Up integration"/>
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker ready"/>
</p>

<p align="center">
  <a href="http://167.71.63.99"><strong>🌐 Open the live IDE</strong></a>
</p>

<p align="center">
  <a href="#-why-browser-coder">Why Browser Coder?</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-learner-toolkit">Learner Toolkit</a> •
  <a href="#-languages">Languages</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-verification">Verification</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## ✨ Why Browser Coder?

Most IDEs show the current state and discard the journey. Browser Coder is built for
students, so it keeps the evidence a learner needs:

<p align="center">
  <strong>every pause</strong> · <strong>every variable value</strong> ·
  <strong>every output line</strong> · <strong>every Turtle command</strong>
</p>

That record powers features that make execution visible instead of mysterious:

<table>
<tr>
<td width="50%" valign="top">

### ⏪ Review earlier pauses

Step backward and forward through recorded debugger snapshots without rerunning the
program. Locals, globals, the call stack, watches, and variable history all move to
the selected moment.

</td>
<td width="50%" valign="top">

### 💎 Log without stopping

Add a logpoint from the code-line context menu. Its expression is evaluated whenever
the line runs, printed in source order, and execution continues automatically.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🧭 Trace output to code

Output remembers which source line produced it. Click an output row to jump to the
matching statement, including repeated output from a loop.

</td>
<td width="50%" valign="top">

### 🐢 Replay a drawing

Python Turtle commands are recorded in order. Scrub through a completed drawing while
the matching Python line is highlighted and future strokes remain visible as context.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🩹 Understand and fix errors

Structured hover cards separate the real error, its plain-language meaning, the likely
cause, and an example. A small set of unambiguous mistakes also offers an explicit safe
fix with a visible edit.

</td>
<td width="50%" valign="top">

### 🌍 Learn in English or Hebrew

The interface, teaching explanations, debugger controls, errors, and accessibility
labels use paired English and Hebrew catalogs. Code, identifiers, filenames, and raw
compiler messages stay in their technically correct form.

</td>
</tr>
</table>

---

## ⚡ Quick Start

### Local development

**Requirements**

- Node.js 22.18 or newer
- npm
- A Chromium-based browser for browser suites
- Python 3, PHP, JDK 17, and .NET 8 when running every contract test locally

    # Install the locked dependencies
    npm ci

Start the API and the Vite application in separate terminals:

    # Terminal 1: execution and project API on port 3001
    npm run dev:server

    # Terminal 2: browser application on port 3000
    npm run dev

Open **http://localhost:3000**. Vite proxies API requests to port 3001.

<details>
<summary><strong>🐳 Run the production-like Docker stack instead</strong></summary>

<br>

    docker compose up -d

Open **http://localhost**. This stack builds the production image, starts nginx,
creates shared storage for previews, blobs, and shares, and runs the configured API
replicas.

    # Follow the application logs
    docker compose logs -f api nginx

    # Stop without deleting persistent named volumes
    docker compose down

</details>

### Production build

    npm run build
    npm start

The build uses relative asset URLs so the same bundle works at the site root and under
the Step-Up <code>/coder/</code> reverse-proxy path.

---

## 🧰 Learner Toolkit

<table>
<tr>
<td width="33%" valign="top">

### 🐛 Debugger

- Breakpoints and conditions
- Non-stopping logpoints
- Continue, step over, into, and out
- Recorded pause history
- Back and forward review
- Locals, globals, stack, and watches
- Variable changes across time

</td>
<td width="33%" valign="top">

### 🔎 Live diagnostics

- Monaco language-service markers
- Server compiler checks while typing
- Multiple independent errors retained
- Project-wide Problems panel
- Accurate source ranges
- English and Hebrew teaching cards
- Safe first-aid edits

</td>
<td width="33%" valign="top">

### 🗂️ Workspace

- Files, folders, tabs, and breadcrumbs
- Search and replace
- Quick Open and command palette
- Rename and move reference updates
- Local file and folder import
- ZIP project download
- IndexedDB autosave

</td>
</tr>
<tr>
<td width="33%" valign="top">

### ▶️ Execution

- Multi-file projects
- Streaming stdout and stderr
- Interactive stdin and EOF
- Explicit Stop control
- Run selection where supported
- Output-to-source tracing
- No execution-result cache

</td>
<td width="33%" valign="top">

### 🎨 Creative output

- Python Turtle rendering
- Live Turtle updates during debugging
- Turtle replay scrubber
- HTML project previews
- CSS dependency discovery
- Local image and asset support
- Read-only project share links

</td>
<td width="33%" valign="top">

### ♿ Classroom-ready UI

- English and Hebrew
- Mixed RTL and LTR isolation
- Keyboard-accessible tree and panels
- Screen-reader labels and announcements
- High-contrast theme
- Responsive embedded layout
- Host-enforced read-only policy

</td>
</tr>
</table>

### Debugging is live, not on a countdown

The browser IDE uses a streamed interactive session for Run and Debug. A session may
wait for input or remain paused until the student continues or stops it. Closing the
page, navigating away, or removing the embedded IDE disconnects and terminates that
session automatically.

Resource, output, concurrency, and per-IP limits still protect the service. The
separate buffered <code>POST /api/run</code> compatibility endpoint keeps a bounded
wall-clock budget because it has no live browser session controlling it.

---

## 💻 Languages

Language identity, versions, starters, capabilities, and teaching data are catalog
driven from <code>languages/&lt;id&gt;/</code>.

| Language | Profiles | Debug | Run selection | Teaching data |
|---|---|:---:|:---:|:---:|
| **JavaScript** | ES5, ES2015, ES2020, ES2022 | ✅ | ✅ | EN + HE |
| **TypeScript** | TS5, strict TS5, ES2015, ES2020 | ✅ | ✅ | EN + HE |
| **Python** | Python 3.x | ✅ | ✅ | EN + HE |
| **Java** | Java 11 LTS, Java 17 LTS | ✅ |  | EN + HE |
| **PHP** | PHP 8.x | ✅ | ✅ | EN + HE |
| **C#** | C# 10 / .NET 6, C# 12 / .NET 8 | ✅ | ✅ | EN + HE |

<details>
<summary><strong>➕ What belongs in a language package?</strong></summary>

<br>

    languages/<id>/
    ├── config.json             identity, versions, capabilities
    ├── starters/               version-specific starter programs
    ├── keywords.json           English teaching entries
    ├── keywords_he.json        Hebrew teaching entries
    ├── errors.json             English error explanations
    ├── errors_he.json          Hebrew error explanations
    └── debugger/runtime files  only when the language needs them

Adding a language also requires a server adapter and contract coverage. See
[Architecture and ownership](docs/ARCHITECTURE.md) for the extension checklist.

</details>

---

## 🖥️ Interface Guide

    ┌──────────────────────────────────────────────────────────────────────────────┐
    │ Browser Coder                  Run  Debug  Language  Version  More           │
    ├────┬──────────────────┬──────────────────────────────────────────────────────┤
    │ 📁 │ Explorer         │ tabs                                                 │
    │ 🔎 │                  ├──────────────────────────────────────────────────────┤
    │ ▶  │ files            │                                                      │
    │    │ and folders      │                  Monaco Editor                       │
    │    │                  │                                                      │
    │    │                  ├──────────────────────────────────────────────────────┤
    │    │                  │ Output                                   Problems    │
    ├────┴──────────────────┴──────────────────────────────────────────────────────┤
    │ branch · problem count                                  language · position │
    └──────────────────────────────────────────────────────────────────────────────┘

### Useful shortcuts

| Shortcut | Action | Shortcut | Action |
|---|---|---|---|
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Run | <kbd>Ctrl</kbd> + <kbd>S</kbd> | Save |
| <kbd>Ctrl</kbd> + <kbd>N</kbd> | New file | <kbd>Ctrl</kbd> + <kbd>W</kbd> | Close tab |
| <kbd>Ctrl</kbd> + <kbd>P</kbd> | Quick Open | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> | Command palette |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> | Workspace search | <kbd>Alt</kbd> + <kbd>F8</kbd> | View problem |

Actions are registered through one command policy boundary. Toolbar clicks,
keybindings, context-menu actions, and Step-Up host requests therefore share the same
enablement rules.

---

## 🔗 Step-Up Integration

Browser Coder can run as a standalone application or as the coding surface inside an
Arc Academy Step-Up lesson.

    ┌──────────────────────────┐       validated postMessage       ┌───────────────┐
    │ Step-Up lesson or sandbox│ ◀───────────────────────────────▶ │ Browser Coder │
    │                          │   init · files · policy · output   │ iframe        │
    └──────────────────────────┘                                   └───────────────┘

The integration supports:

- complete multi-file project initialization and replacement;
- host reads of the current unsaved workspace;
- code-change and full-workspace notifications;
- read-only, run, and structure-lock policies;
- host-triggered run and output display;
- identity-preserving file refreshes, so autosave does not reset models or undo;
- origin validation and ordered message handling;
- automatic session cleanup when the iframe leaves the page.

Only <code>src/integrations/</code> owns this boundary. The workspace and editor do not
depend on the host platform.

---

## 🏗️ Architecture

Browser Coder has three explicit runtime boundaries and one external host boundary:

    Step-Up host
         │ validated messages
         ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │ Browser workbench                                                   │
    │                                                                     │
    │ src/main.ts                                                         │
    │   ├── app/           runtime and configuration                      │
    │   ├── commands/      centralized action policy                      │
    │   ├── components/    reusable UI primitives                         │
    │   ├── diagnostics/   normalized sources, store, markers             │
    │   ├── features/      editor, debugger, explorer, previews           │
    │   ├── i18n/          English and Hebrew catalogs                    │
    │   ├── integrations/  Step-Up protocol adapter                       │
    │   └── workspace/     documents, IndexedDB, Monaco models            │
    └──────────────────────────────┬──────────────────────────────────────┘
                                   │ HTTP / NDJSON
    ┌──────────────────────────────▼──────────────────────────────────────┐
    │ Execution service                                                  │
    │                                                                     │
    │ server.mjs                                                         │
    │   ├── server/http/       middleware and route adapters             │
    │   ├── server/execution/  jobs, processes, sessions, pipeline       │
    │   ├── server/languages/  catalog and execution adapters            │
    │   ├── server/security/   source validation                         │
    │   └── server/{blobs,previews,shares,graphics}/                     │
    └──────────────────────────────┬──────────────────────────────────────┘
                                   │
                         languages/<id>/
                         metadata · starters · debug
                         EN/HE teaching catalogs

### Design rules

- Composition roots assemble collaborators; domain decisions live in focused modules.
- Workspace state flows through <code>WorkspaceService</code>, not directly through
  Monaco or IndexedDB.
- Monaco models have an explicit lifecycle separate from workspace documents.
- Diagnostics from Monaco, local scanners, and real compilers merge through one store.
- HTTP routes translate requests; execution policy stays in the pipeline and adapters.
- UI copy is translated at the presentation boundary.
- Feature initialization returns disposers where lifecycle cleanup is required.

Read the full [architecture guide](docs/ARCHITECTURE.md) for ownership and extension
points.

---

## 🔒 Security Model

Browser Coder executes untrusted classroom code, so protection is layered and tested in
both directions: attacks must be contained, and legitimate curriculum code must keep
working.

| Layer | Current protection |
|---|---|
| **Source boundary** | Language-aware validation blocks prohibited capabilities before execution |
| **Job boundary** | Every run receives an isolated job directory and sanitized environment |
| **Process boundary** | Process-tree termination, output caps, memory assumptions, and concurrency admission |
| **Container boundary** | Read-only root filesystem, dropped capabilities, PID limit, bounded tmpfs |
| **Network boundary** | API containers use an internal Docker network with no default egress route |
| **Storage boundary** | Preview, blob, and share services use separate bounded stores |
| **Protocol boundary** | Step-Up messages validate their origin; operational report triggers require authorization |

The CI production-image job runs **322 security cases across all six languages**. It
also checks safe filesystem use and ordinary programs, so making the sandbox too strict
fails the build just as a bypass does.

<details>
<summary><strong>🧪 Run the security corpus locally</strong></summary>

<br>

With an API already listening on port 3001:

    npm run test:security

Against the Docker stack:

    docker compose run --rm security-tests

Generated reports are written under <code>security/reports/</code>.

</details>

> Capacity is derived from the container memory budget and measured per-run
> assumptions. This project deliberately makes no fixed concurrent-student claim.

---

## 🔌 HTTP Surface

The browser uses these endpoints, but their route modules remain thin adapters around
the execution and storage services.

| Endpoint | Purpose |
|---|---|
| <code>GET /live</code> | Process liveness |
| <code>GET /ready</code> | Admission readiness |
| <code>GET /health</code> | Limits, load, and operational health |
| <code>GET /api/languages</code> | Catalog of supported languages and versions |
| <code>GET /api/starter/:language/:version</code> | Version-specific starter source |
| <code>POST /api/check</code> | Compile or preflight without running |
| <code>POST /api/run</code> | Buffered compatibility run |
| <code>POST /api/run/interactive</code> | Streamed run, stdin, stop, and debugger session |
| <code>POST /api/blobs/check</code> | Find cached project assets by digest |
| <code>PUT /api/blobs/:digest</code> | Upload a missing content-addressed asset |
| <code>POST /api/previews</code> | Publish an immutable web project preview |
| <code>POST /api/shares</code> | Publish an expiring read-only workspace snapshot |

Interactive output is newline-delimited JSON. Session command routes carry stdin,
EOF, stop requests, and debugger commands without opening a second execution path.

Preview behavior and its response-level sandbox boundary are documented in
[Web previews](docs/PREVIEWS.md).

---

## 🧪 Verification

The test pyramid covers pure logic, browser wiring, real compilers/debuggers, container
operations, and the production sandbox.

    # Repository, source, architecture, and translation gates
    npm run check:files
    npm run typecheck
    npm run check:i18n
    npm run check:unused
    npm run check:duplicates
    npm run check:architecture

    # Behavior
    npm run test:unit
    npm run test:browser
    npm run test:contract

    # Production bundle
    npm run build

<code>npm test</code> runs the full non-container suite. Contract tests report a skip
when a local toolchain is missing; CI installs all supported toolchains so every
language path is exercised.

### CI jobs

| Job | What it proves |
|---|---|
| **Typecheck and build** | File hygiene, types, i18n, unused code, duplicates, cycles, production bundle |
| **Unit tests** | Domain logic and adapters |
| **Frozen contract and defect gates** | HTTP behavior, six toolchains, run/check/debug contracts |
| **Browser suites** | Workspace, full application, and real Step-Up embedding |
| **Operations configuration** | nginx, Compose, isolation, and volume rules |
| **Production image** | Constrained boot, health, capacity derivation, and security corpus |

---

## 🌐 Deployment

Production is image-based:

    push to main
        │
        ▼
    GitHub Actions builds an immutable image
        │
        ▼
    GHCR stores latest and commit-SHA tags
        │
        ▼
    DigitalOcean host pulls and recreates services
        │
        ▼
    health checks verify API and nginx

The deployed stack contains:

- **nginx** for public HTTP/TLS termination and load balancing;
- **api** replicas built from <code>Dockerfile.production</code>;
- **shared-storage-init** for preview, blob, and share volume ownership;
- an optional production **autoscaler** profile for measured operational use.

    # Validate deployment configuration
    node scripts/check-ops-config.mjs
    docker compose -f docker-compose.prod.yml config

    # Operator-triggered deployment from the configured host checkout
    ./deploy.sh

Do not use <code>docker compose down -v</code> in production. The named volumes contain
previews, shared snapshots, and cached assets. See the
[deployment runbook](docs/DEPLOY.md) for health checks, rollback, capacity tuning, and
backup responsibilities.

---

## 📚 Documentation

| Guide | Use it when... |
|---|---|
| [Architecture and ownership](docs/ARCHITECTURE.md) | adding a feature, module, language, or integration |
| [Production deployment](docs/DEPLOY.md) | deploying, diagnosing, tuning, or rolling back |
| [Web previews](docs/PREVIEWS.md) | changing HTML/CSS preview behavior or sandboxing |
| [Writing a marking harness](docs/WRITING_A_MARKING_HARNESS.md) | connecting project checks to curriculum tasks |
| [Historical engineering records](docs/history/) | investigating why a boundary or invariant exists |

---

<p align="center">
  <strong>Built for the moment when a student asks, “How did my program get here?”</strong>
</p>

<p align="center">
  <a href="https://github.com/ninasokolov8/browser-coder">⭐ Repository</a> •
  <a href="https://github.com/ninasokolov8/browser-coder/issues">🐛 Report a bug</a> •
  <a href="https://github.com/ninasokolov8/browser-coder/issues">✨ Request a feature</a>
</p>
