# Browser Coder - Full System Description Report

**Date:** 2026-06-19  
**Audience:** Management, product owners, operations leaders, and education program stakeholders  
**System:** Browser Coder web IDE and secure multi-language code execution platform

---

## 1. Executive Summary

Browser Coder is a browser-based coding environment that allows users to write, edit, run, and manage code directly from a web page. It provides a familiar VS Code-style interface with a file explorer, multi-file tabs, code editor, search and replace, execution output, project export, and support for several programming languages.

The system is designed for two main uses:

| Use Case | Description |
|---|---|
| Standalone Web IDE | A full browser coding workspace for users who need to create and run code without installing desktop tools. |
| Embedded Learning IDE | A controlled editor that can be embedded inside the StepUp learning platform, including snippet mode, project mode, readonly mode, and parent-page communication. |

The platform combines a modern frontend editor with a production-ready backend execution service. The backend runs submitted code in restricted processes, applies language-specific security validation, limits execution time and output size, and is deployed behind nginx with Docker-based scaling.

In simple terms: Browser Coder lets students or users code in the browser while giving the organization control over safety, scalability, language support, and integration with learning flows.

---

## 2. What The System Does

Browser Coder provides a complete coding workspace in the browser.

| Capability | What It Means For Users |
|---|---|
| Write code | Users type code in a professional editor with syntax highlighting and editor assistance. |
| Run code | Users execute code and see output immediately in the browser. |
| Work with projects | Users can create files, folders, and multi-file code projects. |
| Switch languages | Users can choose from multiple programming languages and versions. |
| Save work locally | Files are stored in the browser and survive refreshes. |
| Search and replace | Users can search across project files and replace text. |
| Export projects | Users can download their project as a ZIP file. |
| Embed in lessons | StepUp can load code snippets or project files into the IDE and receive code/output events back. |
| Restrict editing | The parent platform can set readonly, no-output, locked-structure, and panel visibility modes. |
| Test security | Automated tests validate that dangerous execution patterns are blocked. |

---

## 3. Target Users

The system can serve several user groups.

| User Group | Primary Need | How Browser Coder Helps |
|---|---|---|
| Students | Practice coding without setup friction | Opens in browser, supports starter files, gives quick output. |
| Instructors | Provide coding exercises and examples | Can embed controlled code editors inside lesson tasks. |
| Program managers | Offer scalable coding education | One system supports multiple languages and thousands of users. |
| Technical operations | Deploy and monitor safely | Docker, nginx, health checks, rate limits, security reports. |
| Security reviewers | Validate execution boundaries | Attack-vector tests and generated security reports. |

---

## 4. Main Product Modes

Browser Coder supports different operating modes so the same system can serve different learning and development scenarios.

| Mode | Purpose | Typical Scenario |
|---|---|---|
| Full IDE Mode | Complete coding workspace with file explorer, search, run panel, tabs, and output. | A learner or developer builds a small project. |
| Project Mode | Multi-file project editing, useful for structured tasks. | StepUp sends a set of files for an exercise. |
| Snippet Mode | Small focused code editor without the full workspace panels. | A student edits a code fragment inside a lesson. |
| Embedded Mode | Runs inside another platform through iframe and postMessage integration. | StepUp embeds the IDE inside a task page. |
| Readonly Mode | Displays code without allowing editing. | Lesson examples, explanations, or answer review. |
| No Output Mode | Hides or disables local execution output. | Parent platform handles execution or grading separately. |

---

## 5. Supported Programming Languages

The system currently supports six programming languages.

| Language | File Extension | Supported Versions / Targets | Execution Method |
|---|---:|---|---|
| JavaScript | `.js` | ES2022, ES2020, ES2015, ES5 | Node.js execution |
| TypeScript | `.ts` | TypeScript 5 strict, TypeScript 5, ES2020 target, ES2015 target | TS execution through `tsx` / Node runtime path |
| Python | `.py` | Python 3.x | Python 3 isolated execution |
| Java | `.java` | Java 17 LTS, Java 11 LTS | Compile with `javac`, run with Java runtime |
| PHP | `.php` | PHP 8.x | PHP CLI execution with restrictive PHP settings |
| C# | `.cs` | C# 12 / .NET 8, C# 10 / .NET 6 | .NET console project execution |

Each language includes configuration for editor highlighting, file extension, available versions, and runtime execution behavior.

---

## 6. User-Facing Features

### 6.1 Code Editor

Browser Coder uses the Monaco Editor, the same editor technology behind VS Code. This gives users a familiar, professional editing experience.

| Feature | Description |
|---|---|
| Syntax highlighting | Code is visually styled according to the selected language. |
| Editor workers | JavaScript and TypeScript use dedicated editor workers for better language support. |
| Theme switching | Users can switch visual themes. |
| Line and column status | The status bar shows the current cursor position. |
| Keyboard shortcuts | Common shortcuts are supported, including run, save, new file, close tab, sidebar toggle, and search. |

### 6.2 File And Folder Management

The system includes a browser-based project explorer.

| Feature | Description |
|---|---|
| Create files | Users can add new files with starter templates. |
| Create folders | Users can organize code in folders. |
| Rename items | Files and folders can be renamed. |
| Delete items | Users can remove files and folders with confirmation. |
| Nested structure | Folders can contain other folders and files. |
| Multi-file tabs | Open files appear as tabs, similar to desktop IDEs. |

### 6.3 Search And Replace

The search panel supports project-wide text discovery.

| Feature | Description |
|---|---|
| Search all files | Finds matches across the workspace. |
| Replace | Supports single-match and bulk replacement flows. |
| Regex option | Allows regular expression search. |
| Case-sensitive option | Finds only exact case matches. |
| Whole-word option | Matches complete words only. |
| Results navigation | Users can jump directly to matches. |

### 6.4 Run And Output

Users can execute their code and see the result in an output panel.

| Feature | Description |
|---|---|
| Run entire file | Executes the currently active file. |
| Function detection | Detects functions, classes, and arrow functions where supported. |
| Run specific function | Lets users execute selected functions with arguments. |
| Argument input | Users can provide function or constructor arguments. |
| Output panel | Displays stdout, stderr, exit code, and execution result. |
| Execution protection | Runtime has timeout, memory, and output limits. |

### 6.5 Local Persistence

Browser Coder stores workspace state locally in the user's browser through IndexedDB.

| Stored Data | Purpose |
|---|---|
| Files | Code content, file names, language, version, timestamps. |
| Folders | Folder tree structure, order, expanded/collapsed state. |
| Workspace state | Active file and theme preference. |

This means a user's project can survive browser refreshes or accidental tab closing on the same device and browser.

### 6.6 Project Export

Users can export their work as a ZIP file. This is useful for submitting, archiving, transferring, or backing up projects outside the browser.

---

## 7. StepUp Platform Integration

Browser Coder includes a dedicated integration layer for StepUp.

The IDE can be embedded in StepUp pages and controlled by the parent platform through URL parameters and postMessage events.

### 7.1 URL Parameters

| Parameter | Purpose |
|---|---|
| `embed=1` | Enables embedded behavior. |
| `mode=snippet` | Opens a focused snippet editor. |
| `mode=full` or `mode=project` | Opens a fuller project-style environment. |
| `readonly=1` | Prevents editing. |
| `nooutput=1` | Disables or hides local output behavior. |
| `lang=` | Sets the initial programming language. |
| `version=` | Sets the initial language version. |
| `uilang=` | Sets the interface language where relevant. |

### 7.2 Parent-Child Messages

| Message | Direction | Purpose |
|---|---|---|
| `ide:ready` | IDE to parent | Announces that the editor is ready. |
| `ide:code-change` | IDE to parent | Sends updated code to the parent platform. |
| `ide:run-result` | IDE to parent | Sends execution results to the parent platform. |
| `stepup:init` | Parent to IDE | Initializes code, files, output, panels, readonly mode, and autorun behavior. |
| `stepup:set-code` | Parent to IDE | Replaces the current snippet code. |
| `stepup:get-code` | Parent to IDE | Requests current snippet code. |
| `stepup:set-files` | Parent to IDE | Replaces the project files. |
| `stepup:get-files` | Parent to IDE | Requests current project files. |
| `stepup:run` | Parent to IDE | Triggers execution. |
| `stepup:set-readonly` | Parent to IDE | Changes readonly and lock behavior at runtime. |
| `stepup:show-output` | Parent to IDE | Displays parent-computed output. |
| `stepup:clear-output` | Parent to IDE | Clears the output panel. |

### 7.3 Allowed Parent Origins

The embedded integration validates parent origins before accepting messages. It allows local development origins and StepUp domains, including StepUp school, StepUp zone, staging, development, and related subdomains.

This protects the editor from unauthorized external pages attempting to control the embedded IDE.

---

## 8. Internationalization

The UI currently supports English and Hebrew.

| Language | Direction | Notes |
|---|---|---|
| English | Left-to-right | Default interface language. |
| Hebrew | Right-to-left | RTL support is included for standalone UI. |

In embedded mode, the editor forces English/LTR behavior because programming code is naturally left-to-right and should remain predictable inside lessons.

---

## 9. System Architecture

Browser Coder has three main layers.

| Layer | Responsibility | Main Technology |
|---|---|---|
| Frontend Web App | Editor, file explorer, tabs, search, output, StepUp iframe integration. | TypeScript, Vite, Monaco Editor, IndexedDB. |
| API Execution Server | Receives code, validates security, runs code, returns output. | Node.js, Express. |
| Deployment Layer | Load balancing, scaling, health checks, static asset delivery. | Docker Compose, nginx, autoscaler service. |

### 9.1 High-Level Flow

1. User opens Browser Coder in a browser.
2. The frontend loads language definitions and starter files.
3. User edits code or receives code from StepUp.
4. User or parent platform triggers execution.
5. The frontend sends code to the backend `/api/run` endpoint.
6. The backend validates the code for dangerous patterns.
7. The backend executes the code in a restricted runtime.
8. Output is returned to the frontend and optionally sent back to StepUp.

### 9.2 Production Deployment Flow

| Component | Role |
|---|---|
| nginx | Public entry point, load balancer, static file caching, API rate limiting. |
| API containers | Execute code and serve app/API endpoints. |
| Autoscaler | Watches load and adjusts API replicas. |
| Security test service | Runs attack-vector tests and generates reports. |
| Docker network | Separates internal API execution from public access. |

---

## 10. Backend API Capabilities

| Endpoint | Purpose |
|---|---|
| `GET /health` | Returns server health, load, uptime, and cache status. |
| `GET /api/languages` | Returns supported languages and versions. |
| `GET /api/starter/:lang/:version` | Returns starter code for a language/version. |
| `POST /api/run` | Executes a single code file or snippet. |
| Multi-file execution path | Supports project-style execution for languages that need multiple files. |

The backend uses structured request IDs, JSON logging in production, response compression, JSON body size limits, and language configuration caching.

---

## 11. Execution Engine

The execution engine is designed to be fast, limited, and resilient.

| Mechanism | Purpose |
|---|---|
| Code validation | Blocks dangerous patterns before execution. |
| Runtime restrictions | Runs languages with safer flags and memory limits. |
| Request cache | Returns repeated identical successful executions quickly. |
| Request deduplication | Prevents duplicate concurrent requests from executing multiple times. |
| Circuit breaker | Temporarily fails fast after repeated runtime failures. |
| Process limits | Limits active executions based on server memory. |
| Timeout control | Stops long-running or stuck code. |
| Output truncation | Prevents excessive output from overloading the service. |
| Temporary cleanup | Removes temporary execution files. |

### 11.1 Key Runtime Limits

| Limit | Default / Behavior |
|---|---|
| Standard execution timeout | 10 seconds by default. |
| Java timeout | 30 seconds by default, because compilation can take longer. |
| C# timeout | 45 seconds by default, because .NET build/run can take longer. |
| Maximum output | 100,000 characters. |
| API JSON body size | 100 KB. |
| Cache TTL | 30 minutes. |
| Circuit breaker threshold | Opens after 5 failures. |
| Circuit breaker reset | Retries after 30 seconds. |

---

## 12. Security Model

Browser Coder uses a defense-in-depth security approach. This means it does not rely on one protection layer; it combines validation, runtime controls, container isolation, network isolation, and automated testing.

### 12.1 Security Layers

| Layer | What It Protects Against |
|---|---|
| Pattern validation | Blocks unsafe APIs such as command execution, file access, network access, dynamic imports, reflection, and code injection. |
| Runtime flags | Restricts memory, file access, imports, PHP functions, Java heap, and process environment. |
| Sanitized environment | Removes access to sensitive environment variables and uses a minimal PATH. |
| No shell execution | Runs processes without shell interpolation. |
| Docker sandboxing | Drops capabilities, prevents privilege escalation, and uses limited temporary filesystems. |
| Network isolation | Keeps API containers on an internal network. |
| Rate limiting | Reduces abuse and excessive traffic. |
| Security tests | Continuously checks whether known attack patterns are blocked. |

### 12.2 Blocked Risk Categories

| Category | Examples Of What Is Blocked |
|---|---|
| Command execution | `exec`, `spawn`, `system`, `Runtime.exec`, `ProcessBuilder`, shell backticks. |
| File system access | Reading/writing files, path traversal, directory listing, includes/requires. |
| Network access | HTTP requests, sockets, DNS/exfiltration paths, WebSocket usage. |
| Code injection | `eval`, dynamic import/require, Python `exec`, PHP dynamic functions, reflection patterns. |
| Process/environment access | Environment variables, process killing, working directory access, system properties. |
| Privilege escalation | Prototype pollution, class loaders, unsafe blocks, native library loading. |
| Denial of service | Infinite timers, fork/process patterns, huge output, long-running code. |

### 12.3 Security Reporting

The repository includes automated security testing that generates JSON and HTML reports. Existing reports are stored under `security/reports/` and can be used to review pass/fail results over time.

The test suite includes attack files for JavaScript, TypeScript, Python, Java, PHP, and C#.

---

## 13. Performance And Scalability

The system is built for production deployment and high traffic.

| Area | Capability |
|---|---|
| Load balancing | nginx routes traffic across API containers using least-connections behavior. |
| Autoscaling | API replicas can scale based on CPU and queue pressure. |
| Rate limiting | nginx limits API request bursts and the API has per-IP request windows. |
| Static caching | Static assets are cached with long-lived headers. |
| API caching | Language and starter endpoints are cached by nginx. |
| Execution caching | Successful identical code executions are cached in the API layer. |
| Request deduplication | Duplicate in-flight executions share one result. |
| Compression | HTTP responses use compression. |
| Build optimization | Vite splits Monaco into a separate chunk and disables sourcemaps for production builds. |

### 13.1 Deployment Capacity Targets

Project documentation describes deployment patterns intended for high concurrency, including 1-8 API replicas by default and optional higher scaling through environment configuration.

Recommended server sizing from the project documentation:

| Concurrent Users | Suggested Specs | Suggested Replicas |
|---:|---|---|
| Up to 1,000 | 2 vCPU, 4 GB RAM | 1-2 |
| Up to 5,000 | 4 vCPU, 8 GB RAM | 2-4 |
| Up to 10,000 | 8 vCPU, 16 GB RAM | 4-8 |
| 10,000+ | 16 vCPU, 32 GB RAM | 8-16 |

Actual capacity depends on code execution volume, language mix, server resources, security settings, and traffic patterns.

---

## 14. Deployment And Operations

Browser Coder is deployed with Docker Compose.

### 14.1 Core Deployment Commands

| Command | Purpose |
|---|---|
| `docker compose up -d` | Starts the full production stack. |
| `docker compose logs -f` | Shows logs for all services. |
| `docker compose ps` | Shows running services. |
| `docker compose restart` | Restarts services. |
| `docker compose down` | Stops the stack. |

### 14.2 Environment Variables

| Variable | Purpose | Default / Example |
|---|---|---|
| `MAX_SCALE` | Maximum API replicas. | `8` |
| `MIN_REPLICAS` | Minimum API replicas. | `1` |
| `INITIAL_REPLICAS` | Starting number of API replicas. | `2` |
| `RUN_TIMEOUT_MS` | General execution timeout. | `10000` |
| `JAVA_TIMEOUT_MS` | Java compile/run timeout. | `30000` |
| `CSHARP_TIMEOUT_MS` | C# build/run timeout. | `45000` |
| `RATE_LIMIT_MAX` | API server request window limit. | `100` in server config, `200` in Docker environment. |
| `PORT` | API server port. | `3001` |

### 14.3 Production Services

| Service | Description |
|---|---|
| `nginx` | Public load balancer and static/API router. |
| `api` | Smart execution server and web app server. |
| `autoscaler` | Watches load and scales API service. |
| `security-tests` | Runs security tests and writes reports. |

### 14.4 DigitalOcean Deployment

The docs include a DigitalOcean deployment guide for Ubuntu 24.04 droplets with Docker. The guide covers firewall setup, repository clone, `docker compose up -d`, GitHub deployment secrets, optional SSL with Certbot, logs, restart, rebuild, and troubleshooting.

---

## 15. Quality Assurance And Testing

The repository includes a test suite organized by category.

| Test Category | Purpose |
|---|---|
| Security tests | Validate that malicious code patterns are blocked. |
| Language tests | Confirm supported language execution behavior. |
| Stress tests | Validate performance under load. |
| Feature tests | Validate product behavior. |

Main test commands:

| Command | Purpose |
|---|---|
| `npm test` | Runs the full test suite through the tests package. |
| `npm run test:security` | Runs security tests. |
| `npm run test:languages` | Runs language tests. |
| `npm run test:stress` | Runs stress tests. |
| `npm run test:features` | Runs feature tests. |
| `./run-security-tests.sh` | Runs Docker-based security tests and generates reports. |

---

## 16. Current Repository Structure

| Path | Purpose |
|---|---|
| `src/` | Frontend TypeScript app, editor logic, storage, tabs, i18n, language loader. |
| `languages/` | Language configurations and starter templates. |
| `server.mjs` | Backend API, execution engine, security validation, caching, rate limiting. |
| `security/` | Security config, attack vectors, report generation, reports. |
| `tests/` | Test suite for security, languages, stress, and features. |
| `nginx/` | Production nginx configuration. |
| `docs/` | Deployment and system documentation. |
| `Dockerfile*` | Docker images for app, production, tests, and autoscaler. |
| `docker-compose*.yml` | Local, production, and test stack definitions. |
| `autoscaler.sh` | Scaling logic for the Docker deployment. |

---

## 17. Management Value

Browser Coder provides business and operational value in several areas.

| Value Area | Benefit |
|---|---|
| Lower setup friction | Learners can code immediately without installing tools. |
| Multi-language coverage | One platform supports major education languages. |
| Learning platform integration | StepUp can embed coding tasks directly inside lessons. |
| Controlled execution | Code runs under restrictions instead of unrestricted server access. |
| Scalable deployment | Docker/nginx/autoscaling support growth and traffic spikes. |
| Security visibility | Reports give management and technical teams a reviewable security trail. |
| Reusable infrastructure | Same IDE can support snippets, projects, standalone use, and guided tasks. |
| Faster content creation | Starter templates and embedded modes help build coding activities quickly. |

---

## 18. Strengths

| Strength | Why It Matters |
|---|---|
| Browser-first experience | Removes installation and device setup barriers. |
| Familiar IDE design | Reduces training time because it resembles common developer tools. |
| Six-language support | Covers web, scripting, backend, and compiled language learning. |
| StepUp integration | Fits directly into the broader learning product. |
| Security-first backend | Code execution is treated as a controlled risk area. |
| Automated security reports | Gives evidence that protections are being checked. |
| Docker deployment | Simplifies deployment and environment consistency. |
| Autoscaling design | Supports growth without redesigning the app stack. |

---

## 19. Current Boundaries And Considerations

These are not blockers, but they are important management considerations.

| Area | Consideration |
|---|---|
| Browser storage | User files are stored locally in the browser unless StepUp or another backend captures them. Clearing browser data can remove local-only projects. |
| Code execution risk | Running user code is inherently sensitive; continued security testing and review are required. |
| Language package access | The system is optimized for standard runtime execution, not arbitrary dependency installation by users. |
| Embedded grading | Browser Coder can run and return code/output, but learning assessment rules should remain in StepUp or a dedicated grading layer. |
| Capacity planning | Real capacity depends on execution-heavy usage, not just page visits. Compiled languages are more expensive than small JS/Python snippets. |
| Security patterns | Pattern blocking is useful but should be maintained as languages and runtimes evolve. |
| Persistence model | For formal assignments, StepUp should save submissions server-side rather than relying only on IndexedDB. |

---

## 20. Recommended Next Steps

| Priority | Recommendation | Reason |
|---|---|---|
| High | Keep security tests in CI/CD and review reports after every deployment. | Code execution is the highest-risk part of the product. |
| High | Define official StepUp save/submission contracts for code and project files. | Ensures student work is stored reliably outside the browser. |
| High | Add management dashboards for usage, language mix, execution volume, failures, and security-test status. | Helps operations make decisions from real data. |
| Medium | Add clearer product documentation for embedded modes and parent messages. | Makes integration easier for future StepUp features. |
| Medium | Add observability around slow executions, timeout rates, cache hits, and rate-limit events. | Supports capacity planning and incident response. |
| Medium | Validate accessibility and mobile behavior for student-facing embedded contexts. | Coding tasks may be used by mixed-ability learners and different devices. |
| Low | Expand starter templates and lesson-specific templates. | Improves content creation speed and learner guidance. |

---

## 21. Final Summary

Browser Coder is a production-oriented browser IDE and secure code execution platform. It supports six programming languages, provides a VS Code-like editing experience, stores work locally, supports project files, runs code on a controlled backend, integrates with StepUp through iframe messaging, and includes Docker-based deployment with security testing and generated reports.

For management, the key point is that Browser Coder is not just an editor. It is a reusable coding infrastructure layer for learning products: it lets StepUp deliver coding activities safely, consistently, and at scale while preserving a simple browser-based experience for students and instructors.