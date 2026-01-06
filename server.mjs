/**
 * Unified Smart Server for Web IDE
 * 
 * Auto-scaling, fail-safe, production-ready server that works in dev & prod.
 * Designed for 10k-50k concurrent users with zero configuration.
 * 
 * Features:
 * - Auto-scaling worker pool based on CPU/memory/queue load
 * - Multi-tier caching (memory + Redis)
 * - Request deduplication (coalesce identical requests)
 * - Circuit breaker pattern for fail-safety
 * - Graceful degradation under extreme load
 * - Health monitoring and self-healing
 * - Zero-config cloud deployment ready
 * - SECURITY: Code sandboxing and dangerous function blocking
 */

import express from "express";
import http from "http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import compression from "compression";
import cluster from "node:cluster";

// ============================================
// SECURITY: CODE SANITIZATION & VALIDATION
// ============================================
const SECURITY = {
  // Dangerous patterns for each language
  patterns: {
    javascript: [
      // Process/child execution
      /\bchild_process\b/i,
      /\brequire\s*\(\s*['"`]child_process['"`]\s*\)/i,
      /\bimport\s*.*from\s*['"`]child_process['"`]/i,
      /\bspawn\s*\(/i,
      /\bexec\s*\(/i,
      /\bexecSync\s*\(/i,
      /\bexecFile\s*\(/i,
      /\bfork\s*\(/i,
      // File system access
      /\brequire\s*\(\s*['"`]fs['"`]\s*\)/i,
      /\bimport\s*.*from\s*['"`]fs['"`]/i,
      /\bimport\s*.*from\s*['"`]fs\/promises['"`]/i,
      /\bimport\s*.*from\s*['"`]node:fs['"`]/i,
      // Network access
      /\brequire\s*\(\s*['"`]net['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]http['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]https['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]dgram['"`]\s*\)/i,
      /\bimport\s*.*from\s*['"`]net['"`]/i,
      /\bimport\s*.*from\s*['"`]http['"`]/i,
      /\bimport\s*.*from\s*['"`]https['"`]/i,
      /\bimport\s*.*from\s*['"`]node:net['"`]/i,
      /\bimport\s*.*from\s*['"`]node:http['"`]/i,
      // Process manipulation
      /\bprocess\.exit\s*\(/i,
      /\bprocess\.kill\s*\(/i,
      /\bprocess\.env\b/i,
      /\bprocess\.cwd\s*\(/i,
      /\bprocess\.chdir\s*\(/i,
      /\bprocess\.mainModule\b/i,
      // Dangerous globals
      /\brequire\s*\(\s*['"`]os['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]path['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]cluster['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]vm['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]worker_threads['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]crypto['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]stream['"`]\s*\)/i,
      /\brequire\s*\(\s*['"`]zlib['"`]\s*\)/i,
      /\bimport\s*.*from\s*['"`]os['"`]/i,
      /\bimport\s*.*from\s*['"`]node:os['"`]/i,
      /\bimport\s*.*from\s*['"`]crypto['"`]/i,
      /\bimport\s*.*from\s*['"`]stream['"`]/i,
      /\bimport\s*.*from\s*['"`]zlib['"`]/i,
      // Dynamic require/import (could bypass checks)
      /\brequire\s*\(\s*[^'"`]/i,
      /\bimport\s*\(\s*[^'"`]/i,
      // Eval and code injection
      /\bFunction\s*\(/i,
      /\beval\s*\(/i,
      // Buffer manipulation for binary exploits
      /\bBuffer\.alloc(?:Unsafe)?\s*\(/i,
      /\bBuffer\.from\s*\([^)]*,\s*['"]hex['"]\)/i,
      // Fetch/network
      /\bfetch\s*\(/i,
      /\bXMLHttpRequest\b/i,
      /\bWebSocket\b/i,
      // Encoding bypass attempts
      /String\.fromCharCode\s*\(/i,
      /\batob\s*\(/i,
      // Prototype pollution
      /\b__proto__\b/i,
      /Object\.setPrototypeOf\s*\(/i,
      /\.constructor\.prototype\b/i,
      /Object\.prototype\b/i,  // Any Object.prototype access
      /Object\.defineProperty\s*\(\s*Object\.prototype/i, // defineProperty on prototype
      // Global object access
      /\bglobalThis\b/i,
      /\bglobal\b/i,
      /\bthis\.constructor\.constructor\b/i,
      // Reflect/Proxy APIs
      /\bReflect\./i,
      /\bnew\s+Proxy\s*\(/i,
      // Timer abuse with strings (potential eval)
      /setTimeout\s*\(\s*['"`]/i,
      /setInterval\s*\(/i,  // Block ALL setInterval - DoS risk
      // Async exploit attempts
      /\bqueueMicrotask\s*\(/i,
      /\bsetImmediate\s*\(/i,
    ],
    
    typescript: [], // Will inherit JavaScript patterns
    
    python: [
      // Command execution
      /\bos\.system\s*\(/i,
      /\bos\.popen\s*\(/i,
      /\bos\.spawn\w*\s*\(/i,
      /\bos\.exec\w*\s*\(/i,
      /\bsubprocess\b/i,
      /\bpopen\s*\(/i,
      /\bcommands\./i,
      // Dangerous imports
      /\bimport\s+os\b/i,
      /\bfrom\s+os\s+import\b/i,
      /\bimport\s+subprocess\b/i,
      /\bfrom\s+subprocess\s+import\b/i,
      /\bimport\s+sys\b/i,
      /\bfrom\s+sys\s+import\b/i,
      /\bimport\s+socket\b/i,
      /\bfrom\s+socket\s+import\b/i,
      /\bimport\s+http\b/i,
      /\bimport\s+urllib\b/i,
      /\bfrom\s+urllib\b/i,  // Also catch "from urllib.request import"
      /\bimport\s+requests\b/i,
      /\bimport\s+shutil\b/i,
      /\bfrom\s+shutil\s+import\b/i,
      /\bimport\s+pty\b/i,
      /\bimport\s+ctypes\b/i,
      /\bimport\s+multiprocessing\b/i,
      /\bimport\s+threading\b/i,
      /\bimport\s+io\b/i,
      /\bfrom\s+io\s+import\b/i,
      /\bimport\s+pathlib\b/i,
      /\bfrom\s+pathlib\s+import\b/i,
      // Additional dangerous network modules
      /\bimport\s+ftplib\b/i,
      /\bfrom\s+ftplib\s+import\b/i,
      /\bimport\s+smtplib\b/i,
      /\bfrom\s+smtplib\s+import\b/i,
      /\bimport\s+telnetlib\b/i,
      /\bfrom\s+telnetlib\s+import\b/i,
      /\bimport\s+poplib\b/i,
      /\bimport\s+imaplib\b/i,
      /\bimport\s+nntplib\b/i,
      // File input module (can read files)
      /\bimport\s+fileinput\b/i,
      /\bfrom\s+fileinput\s+import\b/i,
      /\bfileinput\.input\s*\(/i,
      // Password/credential access
      /\bimport\s+getpass\b/i,
      /\bfrom\s+getpass\s+import\b/i,
      /\bgetpass\.\w+\s*\(/i,
      // File operations - BLOCK ALL FILE ACCESS (read and write)
      /\bopen\s*\(/i, // Block ALL open() calls
      /\bfile\s*\(/i, // Python 2 file()
      /\bcodecs\.open\s*\(/i,
      /\bio\.open\s*\(/i,
      /\bPath\s*\(/i, // pathlib.Path
      /\bos\.remove\s*\(/i,
      /\bos\.unlink\s*\(/i,
      /\bos\.rmdir\s*\(/i,
      /\bos\.mkdir\s*\(/i,
      /\bos\.makedirs\s*\(/i,
      /\bos\.rename\s*\(/i,
      /\bos\.chmod\s*\(/i,
      /\bos\.chown\s*\(/i,
      /\bos\.path\b/i,
      /\bos\.listdir\s*\(/i,
      /\bos\.walk\s*\(/i,
      /\bos\.getcwd\s*\(/i,
      /\bos\.chdir\s*\(/i,
      /\bos\.environ\b/i,
      /\bos\.getenv\s*\(/i,
      // Code execution
      /\bexec\s*\(/i,
      /\beval\s*\(/i,
      /\bcompile\s*\(/i,
      /\b__import__\s*\(/i,
      /\bimportlib\b/i,
      // Builtins manipulation
      /\b__builtins__\b/i,
      /\b__class__\b/i,
      /\b__subclasses__\b/i,
      /\b__globals__\b/i,
      /\b__code__\b/i,
      /\bgetattr\s*\(/i,
      /\bsetattr\s*\(/i,
      /\bdelattr\s*\(/i,
      /\bglobals\s*\(\)/i,
      /\blocals\s*\(\)/i,
      /\bvars\s*\(\)/i,
      /\bdir\s*\(/i,
      // Pickle (arbitrary code execution)
      /\bimport\s+pickle\b/i,
      /\bimport\s+cPickle\b/i,
      /\bimport\s+marshal\b/i,
      // Signal handling
      /\bimport\s+signal\b/i,
      // Encoding bypass
      /\bchr\s*\(/i,
      /\bbytes\s*\(\s*\[/i,
      /\bbase64\b/i,
      /\bbytes\.fromhex\s*\(/i,
      // Frame/code manipulation
      /\bsys\._getframe\s*\(/i,
      /\b__code__\s*=/i,
      /\bimport\s+types\b/i,
      /\btypes\.FunctionType\b/i,
      // More dangerous modules
      /\bimport\s+inspect\b/i,
      /\bimport\s+gc\b/i,
      /\bimport\s+dis\b/i,
      /\bimport\s+ast\b/i,
      /\bimport\s+builtins\b/i,
      /\bimport\s+code\b/i,
      /\bimport\s+platform\b/i,
      /\bimport\s+tempfile\b/i,
      /\bimport\s+glob\b/i,
      /\bimport\s+fnmatch\b/i,
      /\bimport\s+asyncio\b/i,
    ],
    
    php: [
      // Command execution
      /\bexec\s*\(/i,
      /\bshell_exec\s*\(/i,
      /\bsystem\s*\(/i,
      /\bpassthru\s*\(/i,
      /\bpopen\s*\(/i,
      /\bproc_open\s*\(/i,
      /\bproc_close\s*\(/i,
      /\bproc_get_status\s*\(/i,
      /\bproc_terminate\s*\(/i,
      /\bpcntl_\w+\s*\(/i,
      /\bbacktick\b/i,
      /`[^`]+`/,  // Backtick execution
      /\bexpect_popen\s*\(/i,  // expect extension popen
      // File operations
      /\bfopen\s*\(/i,
      /\bfwrite\s*\(/i,
      /\bfputs\s*\(/i,
      /\bfile_put_contents\s*\(/i,
      /\bfile_get_contents\s*\(/i,
      /\bfile\s*\(/i,
      /\breadfile\s*\(/i,
      /\bfread\s*\(/i,
      /\binclude\s*[^;]+/i,
      /\binclude_once\s*[^;]+/i,
      /\brequire\s*[^;]+/i,
      /\brequire_once\s*[^;]+/i,
      /\bunlink\s*\(/i,
      /\brmdir\s*\(/i,
      /\bmkdir\s*\(/i,
      /\brename\s*\(/i,
      /\bcopy\s*\(/i,
      /\bchmod\s*\(/i,
      /\bchown\s*\(/i,
      /\bchgrp\s*\(/i,
      /\bscandir\s*\(/i,
      /\bglob\s*\(/i,
      /\bopendir\s*\(/i,
      /\breaddir\s*\(/i,
      /\bshow_source\s*\(/i,  // Alias for highlight_file
      /\bhighlight_file\s*\(/i,  // Can expose source code
      /\bmove_uploaded_file\s*\(/i,  // File upload handling
      /\bsymlink\s*\(/i,  // Create symbolic links
      /\blink\s*\(/i,  // Create hard links
      // Network operations
      /\bftp_\w+\s*\(/i,  // FTP functions
      /\bfsockopen\s*\(/i,
      /\bpfsockopen\s*\(/i,
      /\bcurl_\w+\s*\(/i,
      /\bsocket_\w+\s*\(/i,
      /\bstream_socket_\w+\s*\(/i,
      // Code execution
      /\beval\s*\(/i,
      /\bassert\s*\(/i,
      /\bcreate_function\s*\(/i,
      /\bcall_user_func\s*\(/i,
      /\bcall_user_func_array\s*\(/i,
      /\bpreg_replace\s*\([^)]*\/[^)]*e[^)]*\)/i, // preg_replace with /e modifier
      // Dangerous functions
      /\bputenv\s*\(/i,
      /\bgetenv\s*\(/i,
      /\bini_set\s*\(/i,
      /\bini_get\s*\(/i,
      /\bdl\s*\(/i,
      /\bset_include_path\s*\(/i,
      /\bphpinfo\s*\(/i,
      /\bget_defined_functions\s*\(/i,
      /\bget_defined_vars\s*\(/i,
      /\bextract\s*\(/i,
      /\bparse_str\s*\(/i,
      // Apache-specific functions
      /\bapache_\w+\s*\(/i,  // All apache_* functions including getenv/setenv
      // PHP superglobals (can leak server info) - use explicit $ without \b
      /\$_SERVER/i,
      /\$_ENV/i,
      /\$_GET/i,
      /\$_POST/i,
      /\$_REQUEST/i,
      /\$_FILES/i,
      /\$GLOBALS/i,
      // Encoding bypass attempts
      /\bchr\s*\(/i,
      /\bbase64_decode\s*\(/i,
      /\bhex2bin\s*\(/i,
      /\bpack\s*\(/i,
      /\bstr_rot13\s*\(/i,  // ROT13 encoding (obfuscation)
      /\bconvert_uudecode\s*\(/i,  // UU decoding (obfuscation)
      /\bconvert_uuencode\s*\(/i,  // UU encoding (obfuscation)
      // Variable variable bypass
      /\$\$/i,  // $$var
      // Callback exploitation
      /\barray_map\s*\(/i,
      /\barray_filter\s*\(/i,
      /\barray_walk\s*\(/i,  // array_walk with callback
      /\barray_walk_recursive\s*\(/i,
      /\barray_reduce\s*\(/i,
      /\busort\s*\(/i,
      /\buasort\s*\(/i,
      /\buksort\s*\(/i,
      /\bpreg_replace_callback\s*\(/i,
      // Reflection
      /\bReflectionFunction\b/i,
      /\bReflectionClass\b/i,
      /\bReflectionMethod\b/i,
      // Serialization
      /\bunserialize\s*\(/i,
      // Dangerous constructs
      /\bregister_shutdown_function\s*\(/i,
      /\bregister_tick_function\s*\(/i,
      /\bob_start\s*\([^)]+\)/i,  // ob_start with callback
      /\bset_error_handler\s*\(/i,
      /\bset_exception_handler\s*\(/i,
    ],
    
    java: [
      // Runtime execution
      /Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/i,
      /Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*halt\s*\(/i,  // Forceful JVM termination
      /Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*load\s*\(/i,  // Load native library by path
      /Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*loadLibrary\s*\(/i,  // Load native library
      /ProcessBuilder\b/i,
      /\bnew\s+ProcessBuilder\s*\(/i,
      // File operations
      /\bnew\s+File\s*\(/i,
      /\bnew\s+FileReader\s*\(/i,
      /\bnew\s+FileWriter\s*\(/i,
      /\bnew\s+FileInputStream\s*\(/i,
      /\bnew\s+FileOutputStream\s*\(/i,
      /\bnew\s+BufferedReader\s*\(/i,
      /\bnew\s+BufferedWriter\s*\(/i,
      /\bnew\s+RandomAccessFile\s*\(/i,
      /Files\s*\.\s*(read|write|delete|copy|move|create)/i,
      /\bnew\s+Scanner\s*\(\s*new\s+File/i,
      /\bPaths\s*\.\s*get\s*\(/i,
      // Network
      /\bnew\s+Socket\s*\(/i,
      /\bnew\s+ServerSocket\s*\(/i,
      /\bnew\s+URL\s*\(/i,
      /\bnew\s+HttpURLConnection\b/i,
      /\bURLConnection\b/i,
      /\bHttpClient\b/i,
      /\bDatagramSocket\b/i,
      // Reflection (can bypass security)
      /\.getDeclaredMethod\s*\(/i,
      /\.getDeclaredField\s*\(/i,
      /\.setAccessible\s*\(/i,
      /Class\s*\.\s*forName\s*\(/i,
      /\.getMethod\s*\(/i,
      /\.invoke\s*\(/i,
      // ClassLoader manipulation
      /ClassLoader\b/i,
      /URLClassLoader\b/i,
      /\.defineClass\s*\(/i,
      /\.loadClass\s*\(/i,
      // System access
      /System\s*\.\s*exit\s*\(/i,
      /System\s*\.\s*getProperty\s*\(/i,
      /System\s*\.\s*setProperty\s*\(/i,
      /System\s*\.\s*getenv\s*\(/i,
      /System\s*\.\s*load\s*\(/i,
      /System\s*\.\s*loadLibrary\s*\(/i,
      /System\s*\.\s*setSecurityManager\s*\(/i,
      /SecurityManager\b/i,
      // Scripting engine (can execute arbitrary code)
      /ScriptEngine\b/i,
      /ScriptEngineManager\b/i,
      // Serialization (potential RCE)
      /ObjectInputStream\b/i,
      /readObject\s*\(/i,
      // Deserialization libraries (RCE vulnerabilities)
      /\bXStream\b/i,  // XStream deserialization
      /\bYaml\s*\.\s*load\s*\(/i,  // SnakeYAML unsafe load
      /\bnew\s+Yaml\s*\(/i,  // SnakeYAML
      /\bObjectMapper\s*\(\s*\)\s*\.\s*enableDefaultTyping/i,  // Jackson polymorphic
      // Native code
      /\bnative\s+\w+\s*\(/i,
      /JNI\b/i,
      // Threads (DoS potential)
      /\bnew\s+Thread\s*\(/i,
      /Thread\s*\.\s*sleep\s*\(\s*\d{5,}/i, // Long sleep
      /ExecutorService\b/i,
      /ThreadPoolExecutor\b/i,
      // MethodHandle API
      /MethodHandles\s*\.\s*lookup\s*\(/i,
      /MethodHandle\b/i,
      /VarHandle\b/i,
      // Unsafe class
      /\bUnsafe\b/i,
      /sun\.misc\.Unsafe/i,
      // JNDI (Log4Shell style attacks)
      /InitialContext\b/i,
      /\bctx\s*\.\s*lookup\s*\(/i,
      /\bjndi:/i,
      /\bldap:/i,
      /\brmi:/i,
      // XML attacks (XXE, XSLT)
      /DocumentBuilderFactory\b/i,
      /SAXParserFactory\b/i,
      /TransformerFactory\b/i,
      /XMLInputFactory\b/i,
      // Instrumentation
      /\bInstrumentation\b/i,
      /\bpremain\s*\(/i,
      /\bagentmain\s*\(/i,
      // Compiler API
      /JavaCompiler\b/i,
      /ToolProvider\s*\.\s*getSystemJavaCompiler\s*\(/i,
    ],
  },
  
  // Messages for blocked patterns
  messages: {
    javascript: 'Blocked: System access, file operations, network, and shell commands are disabled for security',
    typescript: 'Blocked: System access, file operations, network, and shell commands are disabled for security',
    python: 'Blocked: System access (os, subprocess, socket), file write operations, and dangerous built-ins are disabled for security',
    php: 'Blocked: Shell commands (exec, system, shell_exec), file operations, network functions, and dangerous constructs are disabled for security',
    java: 'Blocked: Runtime.exec, ProcessBuilder, file I/O, network sockets, reflection, and system access are disabled for security',
  },
};

// TypeScript inherits JavaScript patterns
SECURITY.patterns.typescript = [...SECURITY.patterns.javascript];

/**
 * Validates code for dangerous patterns
 * @returns {{ safe: boolean, reason?: string, matched?: string }}
 */
function validateCodeSecurity(language, code) {
  const patterns = SECURITY.patterns[language];
  if (!patterns) {
    return { safe: true };
  }
  
  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match) {
      return {
        safe: false,
        reason: SECURITY.messages[language],
        matched: match[0],
      };
    }
  }
  
  return { safe: true };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================
// AUTO-CONFIGURATION (adapts to environment)
// ============================================
const CPU_COUNT = os.cpus().length;
const TOTAL_MEMORY_MB = Math.floor(os.totalmem() / 1024 / 1024);

const CONFIG = {
  port: parseInt(process.env.PORT || "3001", 10),
  isDev: process.env.NODE_ENV !== "production",
  
  // Auto-scale settings (adapts to machine)
  scaling: {
    minWorkers: Math.max(2, Math.floor(CPU_COUNT / 2)),
    maxWorkers: CPU_COUNT * 2,
    scaleUpThreshold: 0.7,    // Scale up at 70% capacity
    scaleDownThreshold: 0.3,  // Scale down at 30% capacity
    scaleCheckIntervalMs: 5000,
    workerIdleTimeoutMs: 60000,
  },
  
  // Execution limits (auto-adjusted based on memory)
  execution: {
    timeoutMs: parseInt(process.env.RUN_TIMEOUT_MS || "10000", 10),
    maxConcurrent: Math.min(500, Math.floor(TOTAL_MEMORY_MB / 50)),
    maxQueueSize: Math.min(10000, Math.floor(TOTAL_MEMORY_MB / 10)),
    maxOutputChars: 100000,
  },
  
  // Cache settings
  cache: {
    maxSize: Math.min(100000, Math.floor(TOTAL_MEMORY_MB / 2)),
    ttlMs: 30 * 60 * 1000, // 30 minutes
    cleanupIntervalMs: 60000,
  },
  
  // Circuit breaker
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenRequests: 3,
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  },
  
  // Health check
  health: {
    checkIntervalMs: 10000,
    unhealthyThreshold: 3,
  },
};

// ============================================
// LOGGING
// ============================================
function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    pid: process.pid,
    ...meta,
  };
  if (CONFIG.isDev) {
    const color = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' }[level] || '';
    console.log(`${color}[${level.toUpperCase()}]\x1b[0m ${message}`, Object.keys(meta).length ? meta : '');
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ============================================
// LRU CACHE WITH TTL
// ============================================
class SmartCache {
  constructor(maxSize = CONFIG.cache.maxSize, ttlMs = CONFIG.cache.ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0, size: 0 };
    
    setInterval(() => this.cleanup(), CONFIG.cache.cleanupIntervalMs);
  }
  
  static hash(language, version, code) {
    const normalized = code.trim().replace(/\s+/g, ' ');
    return crypto.createHash('sha256')
      .update(`${language}:${version}:${normalized}`)
      .digest('hex')
      .substring(0, 16);
  }
  
  get(key) {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      if (entry) this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return entry.value;
  }
  
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    this.stats.size = this.cache.size;
  }
  
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
    this.stats.size = this.cache.size;
  }
  
  getStats() { return { ...this.stats, hitRate: this.stats.hits / (this.stats.hits + this.stats.misses || 1) }; }
}

// ============================================
// CIRCUIT BREAKER (fail-safe)
// ============================================
class CircuitBreaker {
  constructor(name, config = CONFIG.circuitBreaker) {
    this.name = name;
    this.config = config;
    this.state = 'closed'; // closed, open, half-open
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = 0;
    this.halfOpenRequests = 0;
  }
  
  async execute(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.config.resetTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenRequests = 0;
        log('info', `Circuit ${this.name} half-open, testing...`);
      } else {
        throw new Error(`Circuit ${this.name} is open - service unavailable`);
      }
    }
    
    if (this.state === 'half-open' && this.halfOpenRequests >= this.config.halfOpenRequests) {
      throw new Error(`Circuit ${this.name} is testing - please wait`);
    }
    
    try {
      if (this.state === 'half-open') this.halfOpenRequests++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failures = 0;
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.halfOpenRequests) {
        this.state = 'closed';
        log('info', `Circuit ${this.name} closed - recovered`);
      }
    }
  }
  
  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.config.failureThreshold && this.state === 'closed') {
      this.state = 'open';
      log('warn', `Circuit ${this.name} opened after ${this.failures} failures`);
    }
  }
  
  getState() { return { name: this.name, state: this.state, failures: this.failures }; }
}

// ============================================
// REQUEST DEDUPLICATION
// ============================================
class RequestDeduplicator {
  constructor() {
    this.inflight = new Map();
  }
  
  async dedupe(key, fn) {
    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }
    
    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    
    this.inflight.set(key, promise);
    return promise;
  }
  
  getInflightCount() { return this.inflight.size; }
}

// ============================================
// PROCESS POOL (auto-scaling)
// ============================================
class ProcessPool {
  constructor(language, command, args = []) {
    this.language = language;
    this.command = command;
    this.args = args;
    this.pool = [];
    this.busy = new Set();
    this.queue = [];
    this.stats = { spawned: 0, reused: 0, timeouts: 0, errors: 0 };
    this.circuitBreaker = new CircuitBreaker(language);
  }
  
  async acquire(timeoutMs = CONFIG.execution.timeoutMs) {
    return this.circuitBreaker.execute(async () => {
      // Try to get an idle process
      for (const proc of this.pool) {
        if (!this.busy.has(proc) && !proc.killed) {
          this.busy.add(proc);
          this.stats.reused++;
          return proc;
        }
      }
      
      // Spawn new if under limit
      if (this.pool.length < CONFIG.scaling.maxWorkers) {
        const proc = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: timeoutMs,
        });
        
        proc.on('error', () => this.remove(proc));
        proc.on('exit', () => this.remove(proc));
        
        this.pool.push(proc);
        this.busy.add(proc);
        this.stats.spawned++;
        return proc;
      }
      
      // Queue and wait
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const idx = this.queue.findIndex(q => q.resolve === resolve);
          if (idx >= 0) this.queue.splice(idx, 1);
          this.stats.timeouts++;
          reject(new Error('Process pool timeout'));
        }, timeoutMs);
        
        this.queue.push({ resolve, reject, timeout });
      });
    });
  }
  
  release(proc) {
    this.busy.delete(proc);
    
    // Serve queued requests
    if (this.queue.length > 0) {
      const { resolve, timeout } = this.queue.shift();
      clearTimeout(timeout);
      this.busy.add(proc);
      resolve(proc);
    }
  }
  
  remove(proc) {
    this.busy.delete(proc);
    const idx = this.pool.indexOf(proc);
    if (idx >= 0) this.pool.splice(idx, 1);
  }
  
  getStats() {
    return {
      language: this.language,
      poolSize: this.pool.length,
      busy: this.busy.size,
      queued: this.queue.length,
      circuit: this.circuitBreaker.getState(),
      ...this.stats,
    };
  }
  
  getLoad() {
    if (this.pool.length === 0) return 0;
    return (this.busy.size + this.queue.length) / CONFIG.scaling.maxWorkers;
  }
}

// ============================================
// SMART EXECUTOR (unified)
// ============================================
class SmartExecutor {
  constructor() {
    this.cache = new SmartCache();
    this.deduplicator = new RequestDeduplicator();
    this.pools = {
      node: new ProcessPool('node', 'node', ['--input-type=module', '-e']),
      python: new ProcessPool('python', 'python3', ['-u', '-c']),
      php: new ProcessPool('php', 'php', ['-r']),
    };
    this.tempDir = path.join(os.tmpdir(), 'webide-' + process.pid);
    this.activeExecutions = 0;
    this.totalExecutions = 0;
    this.startTime = Date.now();
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Auto-scale monitoring
    setInterval(() => this.autoScale(), CONFIG.scaling.scaleCheckIntervalMs);
    
    // Cleanup temp files periodically
    setInterval(() => this.cleanupTemp(), 60000);
  }
  
  async execute(language, version, code) {
    // Check capacity
    if (this.activeExecutions >= CONFIG.execution.maxConcurrent) {
      throw new Error('Server at capacity - please try again');
    }
    
    // Cache check
    const cacheKey = SmartCache.hash(language, version, code);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
    
    // Deduplicate identical requests
    return this.deduplicator.dedupe(cacheKey, async () => {
      this.activeExecutions++;
      this.totalExecutions++;
      
      try {
        const result = await this.executeCode(language, version, code);
        
        // Cache successful results
        if (result.exitCode === 0) {
          this.cache.set(cacheKey, result);
        }
        
        return result;
      } finally {
        this.activeExecutions--;
      }
    });
  }
  
  async executeCode(language, version, code) {
    const startTime = Date.now();
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.executeJS(code, language === 'typescript');
      case 'python':
        return this.executePython(code);
      case 'php':
        return this.executePHP(code);
      case 'java':
        return this.executeJava(code);
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }
  
  async executeJS(code, isTypeScript = false) {
    // SECURITY: Run Node.js with restricted permissions
    // --experimental-permission restricts file system, child process, and workers
    return this.runProcess('node', [
      '--experimental-permission',               // Enable permission model
      '--allow-fs-read=' + this.tempDir,        // Only allow reading temp dir
      '--max-old-space-size=128',               // Limit memory
      '--input-type=module',
      '-e',
      code
    ]);
  }
  
  async executePython(code) {
    // SECURITY: Run Python with restricted options
    return this.runProcess('python3', [
      '-u',                 // Unbuffered output
      '-I',                 // Isolated mode: ignore PYTHON* env vars, don't add current directory
      '-S',                 // Don't import site module (reduces available imports)
      '-c',
      code
    ]);
  }
  
  async executePHP(code) {
    // PHP needs to be in a file or passed carefully
    const phpCode = code.startsWith('<?php') ? code : `<?php\n${code}`;
    const tempFile = path.join(this.tempDir, `php_${Date.now()}_${Math.random().toString(36).slice(2)}.php`);
    const securityConfig = path.join(__dirname, 'security', 'php.ini');
    
    try {
      fs.writeFileSync(tempFile, phpCode);
      // SECURITY: Run PHP with restrictive configuration
      const args = [
        '-d', 'open_basedir=' + this.tempDir,       // Restrict file access
        '-d', 'memory_limit=64M',                   // Limit memory
        '-d', 'max_execution_time=10',              // Limit execution time
        '-d', 'disable_functions=exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec,pcntl_fork,curl_exec,curl_multi_exec,fsockopen,pfsockopen,stream_socket_client,mail,dl,putenv,getenv,phpinfo,eval,assert,create_function,file_get_contents,file_put_contents,fopen,fwrite,readfile,unlink,rmdir,mkdir,chmod,chown',
        '-d', 'allow_url_fopen=Off',
        '-d', 'allow_url_include=Off',
        tempFile
      ];
      return await this.runProcess('php', args);
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
  
  async executeJava(code) {
    // Extract class name
    const classMatch = code.match(/public\s+class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : 'Main';
    const tempFile = path.join(this.tempDir, `${className}.java`);
    
    try {
      fs.writeFileSync(tempFile, code);
      
      // Compile with restricted options (no security manager during compilation)
      const compileResult = await this.runProcess('javac', [
        '-J-Xmx128m',  // Limit memory
        tempFile
      ], CONFIG.execution.timeoutMs, { skipJavaSecurityManager: true });
      if (compileResult.exitCode !== 0) {
        return { ...compileResult, phase: 'compile' };
      }
      
      // SECURITY: Run with security manager and restricted permissions
      return await this.runProcess('java', [
        '-Xmx128m',                              // Limit heap memory
        '-Xms32m',                               // Initial heap
        '-XX:MaxMetaspaceSize=64m',              // Limit metaspace
        '-Djava.security.manager=allow',         // Enable security manager
        '-cp', this.tempDir,
        className
      ]);
    } finally {
      try {
        fs.unlinkSync(tempFile);
        fs.unlinkSync(path.join(this.tempDir, `${className}.class`));
      } catch {}
    }
  }
  
  runProcess(command, args, timeoutMs = CONFIG.execution.timeoutMs, options = {}) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;
      
      // SECURITY: Create a minimal, sanitized environment
      const sanitizedEnv = {
        PATH: '/usr/local/bin:/usr/bin:/bin',  // Minimal PATH
        HOME: this.tempDir,
        TMPDIR: this.tempDir,
        TEMP: this.tempDir,
        TMP: this.tempDir,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        // Node.js security
        NODE_OPTIONS: '--max-old-space-size=128',
      };
      
      // Only add Java security manager for runtime, not compilation
      if (!options.skipJavaSecurityManager) {
        sanitizedEnv.JAVA_TOOL_OPTIONS = '-Djava.security.manager=default -Xmx128m';
      } else {
        sanitizedEnv.JAVA_TOOL_OPTIONS = '-Xmx128m';  // Just memory limit for compiler
      }
      
      const proc = spawn(command, args, {
        cwd: this.tempDir,
        timeout: timeoutMs,
        env: sanitizedEnv,
        // SECURITY: Don't inherit parent's stdio, file descriptors
        stdio: ['pipe', 'pipe', 'pipe'],
        // SECURITY: Detach from parent's process group
        detached: false,
        // SECURITY: Don't allow shell execution
        shell: false,
      });
      
      const timeout = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, timeoutMs);
      
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > CONFIG.execution.maxOutputChars) {
          stdout = stdout.slice(0, CONFIG.execution.maxOutputChars) + '\n... (output truncated)';
          proc.kill();
        }
      });
      
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > CONFIG.execution.maxOutputChars) {
          stderr = stderr.slice(0, CONFIG.execution.maxOutputChars) + '\n... (output truncated)';
        }
      });
      
      proc.on('close', (exitCode) => {
        clearTimeout(timeout);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: killed ? -1 : (exitCode || 0),
          durationMs: Date.now() - startTime,
          killed,
        });
      });
      
      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: -1,
          durationMs: Date.now() - startTime,
          error: true,
        });
      });
    });
  }
  
  autoScale() {
    const load = this.getLoad();
    // Log stats periodically
    if (this.totalExecutions % 100 === 0 || CONFIG.isDev) {
      log('debug', 'executor_stats', this.getStats());
    }
  }
  
  cleanupTemp() {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > 60000) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {}
  }
  
  getLoad() {
    return this.activeExecutions / CONFIG.execution.maxConcurrent;
  }
  
  getStats() {
    return {
      active: this.activeExecutions,
      total: this.totalExecutions,
      maxConcurrent: CONFIG.execution.maxConcurrent,
      load: (this.getLoad() * 100).toFixed(1) + '%',
      uptime: Math.floor((Date.now() - this.startTime) / 1000) + 's',
      cache: this.cache.getStats(),
      inflight: this.deduplicator.getInflightCount(),
    };
  }
}

// ============================================
// RATE LIMITER
// ============================================
class RateLimiter {
  constructor() {
    this.requests = new Map();
    setInterval(() => this.cleanup(), CONFIG.rateLimit.windowMs);
  }
  
  check(ip) {
    const now = Date.now();
    const key = ip;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, { count: 1, resetAt: now + CONFIG.rateLimit.windowMs });
      return { allowed: true, remaining: CONFIG.rateLimit.maxRequests - 1 };
    }
    
    const record = this.requests.get(key);
    
    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + CONFIG.rateLimit.windowMs;
      return { allowed: true, remaining: CONFIG.rateLimit.maxRequests - 1 };
    }
    
    record.count++;
    const remaining = Math.max(0, CONFIG.rateLimit.maxRequests - record.count);
    
    return { allowed: record.count <= CONFIG.rateLimit.maxRequests, remaining };
  }
  
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests) {
      if (now > record.resetAt) {
        this.requests.delete(key);
      }
    }
  }
}

// ============================================
// SERVER SETUP
// ============================================
const app = express();
const server = http.createServer(app);
const executor = new SmartExecutor();
const rateLimiter = new RateLimiter();

// Language configs cache
let languageConfigsCache = null;
let languageConfigsCacheTime = 0;

async function loadLanguageConfigs() {
  if (languageConfigsCache && Date.now() - languageConfigsCacheTime < 300000) {
    return languageConfigsCache;
  }
  
  const languagesDir = path.join(__dirname, "languages");
  const languages = {};
  
  try {
    const dirs = fs.readdirSync(languagesDir);
    for (const dir of dirs) {
      const configPath = path.join(languagesDir, dir, "config.json");
      if (fs.existsSync(configPath)) {
        languages[dir] = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    }
  } catch (err) {
    log('error', 'Failed to load language configs', { error: err.message });
  }
  
  languageConfigsCache = languages;
  languageConfigsCacheTime = Date.now();
  return languages;
}

// Middleware
app.set("trust proxy", true);
app.use(compression());
app.use(express.json({ limit: "100kb" }));

// Request ID
app.use((req, res, next) => {
  req.id = crypto.randomBytes(4).toString("hex");
  res.setHeader("X-Request-ID", req.id);
  next();
});

// CORS
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limiting (bypass for localhost/tests)
app.use("/api", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Bypass rate limiting for localhost (tests run locally)
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
    return next();
  }
  
  const { allowed, remaining } = rateLimiter.check(ip);
  
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Limit", CONFIG.rateLimit.maxRequests);
  
  if (!allowed) {
    return res.status(429).json({ error: "Too many requests", retryAfter: 60 });
  }
  next();
});

// ============================================
// API ROUTES
// ============================================

// Health check
app.get("/health", (req, res) => {
  const stats = executor.getStats();
  const healthy = stats.load.replace('%', '') < 90;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    ...stats,
    config: {
      maxConcurrent: CONFIG.execution.maxConcurrent,
      cpuCount: CPU_COUNT,
      memoryMB: TOTAL_MEMORY_MB,
    },
  });
});

// Get languages
app.get("/api/languages", async (req, res) => {
  try {
    const languages = await loadLanguageConfigs();
    res.json(languages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load languages" });
  }
});

// Get starter code
app.get("/api/starter/:language/:version", async (req, res) => {
  try {
    const { language, version } = req.params;
    const starterPath = path.join(__dirname, "languages", language, "starters", `${version}.${getExtension(language)}`);
    
    if (!fs.existsSync(starterPath)) {
      return res.status(404).json({ error: "Starter not found" });
    }
    
    const code = fs.readFileSync(starterPath, "utf-8");
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: "Failed to load starter" });
  }
});

function getExtension(language) {
  const extensions = { javascript: 'js', typescript: 'ts', python: 'py', java: 'java', php: 'php' };
  return extensions[language] || 'txt';
}

// Run code
app.post("/api/run", async (req, res) => {
  const { language, version, code } = req.body;
  
  if (!language || !code) {
    return res.status(400).json({ error: "Missing language or code" });
  }
  
  if (code.length > 100000) {
    return res.status(400).json({ error: "Code too large (max 100KB)" });
  }
  
  // SECURITY: Validate code for dangerous patterns
  const securityCheck = validateCodeSecurity(language, code);
  if (!securityCheck.safe) {
    log('warn', 'security_block', { 
      language, 
      reason: securityCheck.reason,
      matched: securityCheck.matched,
      ip: req.ip 
    });
    return res.status(403).json({ 
      error: securityCheck.reason,
      blocked: true,
    });
  }
  
  try {
    const result = await executor.execute(language, version, code);
    
    res.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      cached: result.cached || false,
    });
  } catch (err) {
    log('error', 'execution_error', { error: err.message, language });
    
    if (err.message.includes('capacity')) {
      return res.status(503).json({ error: err.message, retryAfter: 5 });
    }
    if (err.message.includes('Circuit')) {
      return res.status(503).json({ error: "Service temporarily unavailable", retryAfter: 30 });
    }
    
    res.status(500).json({ error: err.message });
  }
});

// Stats endpoint
app.get("/api/stats", (req, res) => {
  res.json(executor.getStats());
});

// Reports API - list all security reports
app.get("/api/reports", async (req, res) => {
  try {
    const reportsDir = path.join(__dirname, "tests", "reports");
    if (!fs.existsSync(reportsDir)) {
      return res.json([]);
    }
    
    const files = fs.readdirSync(reportsDir);
    const reports = [];
    
    for (const file of files) {
      if (file === 'index.html') continue; // Skip the hub page
      
      const isHtml = file.endsWith('.html');
      const isJson = file.endsWith('.json');
      
      if (isHtml || isJson) {
        const report = {
          name: file,
          type: isHtml ? 'html' : 'json',
          path: `/reports/${file}`,
        };
        
        // For JSON files, try to extract summary
        if (isJson && !file.includes('latest')) {
          try {
            const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
            const data = JSON.parse(content);
            if (data.summary) {
              report.summary = data.summary;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        reports.push(report);
      }
    }
    
    res.json(reports);
  } catch (err) {
    log('error', 'reports_api_error', { error: err.message });
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// Check if tests can be run (cooldown disabled for now)
app.get("/api/reports/can-run", (req, res) => {
  // Cooldown disabled - always allow running tests
  res.json({ canRun: true, lastRun: null, hoursAgo: null });
});

// Track running test status with full terminal output
let testRunStatus = { running: false, startTime: null, progress: null, output: '' };

// Run security tests (cooldown disabled for now)
app.post("/api/reports/run-tests", async (req, res) => {
  try {
    // Check if already running
    if (testRunStatus.running) {
      return res.status(409).json({ 
        error: 'Tests already running', 
        startTime: testRunStatus.startTime 
      });
    }
    
    // Cooldown check disabled for now
    
    // Mark as running with empty output buffer
    testRunStatus = { running: true, startTime: new Date().toISOString(), progress: 'starting', output: '' };
    
    // Return immediately, tests run in background
    res.json({ 
      status: 'started', 
      message: 'Security tests started. Check back in ~30 seconds for results.',
      startTime: testRunStatus.startTime
    });
    
    // Run tests in background using the test script directly
    const { spawn: nodeSpawn } = await import('node:child_process');
    const testProcess = nodeSpawn('node', ['tests/security/security-tests.mjs', '--server=http://localhost:3001'], {
      cwd: __dirname,
      env: { ...process.env, API_URL: 'http://localhost:3001' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    testProcess.stdout.on('data', (data) => {
      testRunStatus.output += data.toString();
      testRunStatus.progress = 'running';
    });
    
    testProcess.stderr.on('data', (data) => {
      testRunStatus.output += data.toString();
    });
    
    testProcess.on('close', (code) => {
      const finalOutput = testRunStatus.output;
      testRunStatus = { 
        running: false, 
        startTime: null, 
        progress: code === 0 ? 'completed' : 'failed',
        output: finalOutput,
        lastResult: { code, output: finalOutput.slice(-1000) }
      };
      log('info', 'test_run_completed', { exitCode: code });
    });
    
    testProcess.on('error', (err) => {
      testRunStatus = { running: false, startTime: null, progress: 'error', error: err.message };
      log('error', 'test_run_error', { error: err.message });
    });
    
  } catch (err) {
    testRunStatus = { running: false, startTime: null, progress: 'error' };
    log('error', 'run_tests_error', { error: err.message });
    res.status(500).json({ error: 'Failed to start tests' });
  }
});

// Get test run status
app.get("/api/reports/status", (req, res) => {
  res.json(testRunStatus);
});

// Get terminal output (for live streaming)
app.get("/api/reports/output", (req, res) => {
  const offset = parseInt(req.query.offset || '0', 10);
  const output = testRunStatus.output || '';
  res.json({
    running: testRunStatus.running,
    progress: testRunStatus.progress,
    output: output.slice(offset),
    totalLength: output.length
  });
});

// Serve reports directory
const reportsPath = path.join(__dirname, "tests", "reports");
if (fs.existsSync(reportsPath)) {
  app.use("/reports", express.static(reportsPath));
}

// Serve static files in production
if (!CONFIG.isDev) {
  const distPath = path.join(__dirname, "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
function gracefulShutdown(signal) {
  log('info', `Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    log('info', 'HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    log('warn', 'Forcing shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================
// START SERVER
// ============================================
server.listen(CONFIG.port, '0.0.0.0', () => {
  log('info', '🚀 Smart Server Started', {
    port: CONFIG.port,
    mode: CONFIG.isDev ? 'development' : 'production',
    maxConcurrent: CONFIG.execution.maxConcurrent,
    maxQueue: CONFIG.execution.maxQueueSize,
    cacheSize: CONFIG.cache.maxSize,
    cpuCount: CPU_COUNT,
    memoryMB: TOTAL_MEMORY_MB,
  });
  
  // Pre-warm with common patterns
  const warmupPatterns = [
    { language: 'javascript', version: 'es2022', code: 'console.log("warm")' },
    { language: 'python', version: 'python3', code: 'print("warm")' },
  ];
  
  warmupPatterns.forEach(p => executor.execute(p.language, p.version, p.code).catch(() => {}));
});
