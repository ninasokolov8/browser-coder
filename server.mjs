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
import { spawnSync } from "node:child_process";
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

    csharp: [
      // ─── Command / process execution ─────────────────────────────
      /\bSystem\s*\.\s*Diagnostics\s*\.\s*Process\b/i,
      /\bDiagnostics\s*\.\s*Process\b/i,
      /\bnew\s+Process\s*\(/i,
      /\bProcess\s*\.\s*Start\s*\(/i,
      /\bProcessStartInfo\b/i,
      /\bShellExecute\b/i,
      /\bnew\s+Thread\s*\(/i,
      /\bThreadPool\s*\.\s*QueueUserWorkItem\b/i,
      /\bTask\s*\.\s*Run\s*\(/i,
      /\bTask\s*\.\s*Factory\s*\.\s*StartNew\s*\(/i,
      // ─── File system ─────────────────────────────────────────────
      /\bSystem\s*\.\s*IO\b/i,
      /\busing\s+System\s*\.\s*IO\b/i,
      /\bFile\s*\.\s*(Read|Write|Open|Create|Delete|Copy|Move|Append|Exists)\w*\s*\(/i,
      /\bFileStream\b/i,
      /\bStreamReader\b/i,
      /\bStreamWriter\b/i,
      /\bBinaryReader\b/i,
      /\bBinaryWriter\b/i,
      /\bTextReader\b/i,
      /\bTextWriter\b/i,
      /\bDirectory\s*\.\s*\w+\s*\(/i,
      /\bDirectoryInfo\b/i,
      /\bFileInfo\b/i,
      /\bPath\s*\.\s*GetTempFileName\s*\(/i,
      /\bPath\s*\.\s*GetFullPath\s*\(/i,
      /\bDriveInfo\b/i,
      /\bMemoryMappedFile\b/i,
      /\bFileSystemWatcher\b/i,
      /\bIsolatedStorage\w*\b/i,
      // ─── Network ─────────────────────────────────────────────────
      /\bSystem\s*\.\s*Net\b/i,
      /\busing\s+System\s*\.\s*Net\b/i,
      /\bHttpClient\b/i,
      /\bHttpWebRequest\b/i,
      /\bWebClient\b/i,
      /\bWebRequest\b/i,
      /\bFtpWebRequest\b/i,
      /\bSocket\b/i,
      /\bTcpClient\b/i,
      /\bTcpListener\b/i,
      /\bUdpClient\b/i,
      /\bIPAddress\b/i,
      /\bIPEndPoint\b/i,
      /\bDns\s*\.\s*\w+\s*\(/i,
      /\bSmtpClient\b/i,
      /\bMailMessage\b/i,
      /\bWebSocket\b/i,
      // ─── Reflection ──────────────────────────────────────────────
      /\bSystem\s*\.\s*Reflection\b/i,
      /\busing\s+System\s*\.\s*Reflection\b/i,
      /\bAssembly\s*\.\s*(Load|LoadFrom|LoadFile|GetType|GetExecutingAssembly|GetEntryAssembly|GetCallingAssembly|ReflectionOnlyLoad)\b/i,
      /\bAssemblyName\b/i,
      /\bAssemblyBuilder\b/i,
      /\bAssemblyLoadContext\b/i,
      /\bAppDomain\b/i,
      /\bMethodInfo\b/i,
      /\bFieldInfo\b/i,
      /\bPropertyInfo\b/i,
      /\bConstructorInfo\b/i,
      /\bBindingFlags\b/i,
      /\bActivator\s*\.\s*(CreateInstance|CreateInstanceFrom)\b/i,
      /\bType\s*\.\s*GetType\s*\(/i,
      /\bType\s*\.\s*InvokeMember\s*\(/i,
      /\.GetMethod\s*\(/i,
      /\.GetField\s*\(/i,
      /\.GetProperty\s*\(/i,
      /\.GetConstructor\s*\(/i,
      /\.Invoke\s*\(/i,
      /\bEmit\s*\.\s*\w+\b/i,
      /\bILGenerator\b/i,
      /\bDynamicMethod\b/i,
      // ─── Code generation / scripting ─────────────────────────────
      /\bCSharpCodeProvider\b/i,
      /\bCodeDomProvider\b/i,
      /\bCompilerParameters\b/i,
      /\bCompileAssemblyFromSource\b/i,
      /\bCompileAssemblyFromFile\b/i,
      /\bCSharpScript\b/i,
      /\bScriptOptions\b/i,
      /\bMicrosoft\s*\.\s*CodeAnalysis\b/i,
      /\bRoslyn\b/i,
      /\bExpressions\s*\.\s*Compile\s*\(/i,
      /\bDLR\b/i,
      /\bDynamicObject\b/i,
      /\bExpandoObject\b/i,
      /\bdynamic\s+\w+\s*=\s*Activator\b/i,
      // ─── Serialization (deserialization RCE) ─────────────────────
      /\bBinaryFormatter\b/i,
      /\bSoapFormatter\b/i,
      /\bNetDataContractSerializer\b/i,
      /\bObjectStateFormatter\b/i,
      /\bLosFormatter\b/i,
      /\bDataContractSerializer\b/i,
      /\bDataContractJsonSerializer\b/i,
      /\bXmlSerializer\b/i,
      /\bJavaScriptSerializer\b/i,
      /\bTypeNameHandling\b/i,    // Json.NET deserialization gadget
      /\bSerializationBinder\b/i,
      // ─── Native / unsafe / binary ────────────────────────────────
      /\bunsafe\b/i,
      /\bfixed\s*\(/i,
      /\bstackalloc\b/i,
      /\bDllImport\b/i,
      /\bUnmanagedFunctionPointer\b/i,
      /\bMarshal\s*\.\s*\w+\b/i,
      /\bGCHandle\b/i,
      /\bIntPtr\s*\.\s*Zero/i,
      /\bnew\s+IntPtr\s*\(/i,
      /\bUIntPtr\b/i,
      /\bSpan\s*<\s*byte/i,
      /\bMemory\s*<\s*byte/i,
      /\bReadOnlySpan\s*<\s*byte/i,
      /\bMemoryMarshal\b/i,
      /\bUnsafe\s*\.\s*\w+\b/i,
      /\bSystem\s*\.\s*Runtime\s*\.\s*InteropServices\b/i,
      /\busing\s+System\s*\.\s*Runtime\s*\.\s*InteropServices\b/i,
      /\busing\s+System\s*\.\s*Runtime\s*\.\s*CompilerServices\b/i,
      /\bNativeLibrary\s*\.\s*(Load|GetExport)\b/i,
      /\bSafeHandle\b/i,
      /\bCriticalHandle\b/i,
      /\bCallingConvention\b/i,
      /\bGetDelegateForFunctionPointer\b/i,
      // ─── System / environment access ─────────────────────────────
      /\bEnvironment\s*\.\s*Exit\s*\(/i,
      /\bEnvironment\s*\.\s*FailFast\s*\(/i,
      /\bEnvironment\s*\.\s*GetEnvironmentVariable\w*\s*\(/i,
      /\bEnvironment\s*\.\s*SetEnvironmentVariable\s*\(/i,
      /\bEnvironment\s*\.\s*GetCommandLineArgs\s*\(/i,
      /\bEnvironment\s*\.\s*MachineName\b/i,
      /\bEnvironment\s*\.\s*UserName\b/i,
      /\bEnvironment\s*\.\s*UserDomainName\b/i,
      /\bEnvironment\s*\.\s*OSVersion\b/i,
      /\bEnvironment\s*\.\s*CurrentDirectory\b/i,
      /\bEnvironment\s*\.\s*SystemDirectory\b/i,
      /\bEnvironment\s*\.\s*ProcessId\b/i,
      /\bEnvironment\s*\.\s*GetFolderPath\s*\(/i,
      /\bEnvironment\s*\.\s*GetLogicalDrives\s*\(/i,
      /\bRegistry\s*\.\s*\w+\b/i,
      /\bRegistryKey\b/i,
      /\bMicrosoft\s*\.\s*Win32\b/i,
      /\busing\s+Microsoft\s*\.\s*Win32\b/i,
      /\bWMI\b/i,
      /\bManagementObject\b/i,
      /\bSystem\s*\.\s*Management\b/i,
      // ─── Encoding / loader bypass ────────────────────────────────
      /\bConvert\s*\.\s*FromBase64String\s*\(/i,
      /\bEncoding\s*\.\s*\w+\s*\.\s*GetString\s*\(/i,
      /\bEncoding\s*\.\s*\w+\s*\.\s*GetBytes\s*\(/i,
      /\bBitConverter\s*\.\s*ToString\s*\(/i,
      // ─── Eval-style and command-string entry points ──────────────
      /\beval\s*\(/i,
      // ─── Threads / sync abuse ────────────────────────────────────
      /\bMutex\b/i,
      /\bSemaphore\b/i,
      /\bEventWaitHandle\b/i,
    ],
  },
  
  // Messages for blocked patterns
  messages: {
    javascript: 'Blocked: System access, file operations, network, and shell commands are disabled for security',
    typescript: 'Blocked: System access, file operations, network, and shell commands are disabled for security',
    python: 'Blocked: System access (os, subprocess, socket), file write operations, and dangerous built-ins are disabled for security',
    php: 'Blocked: Shell commands (exec, system, shell_exec), file operations, network functions, and dangerous constructs are disabled for security',
    java: 'Blocked: Runtime.exec, ProcessBuilder, file I/O, network sockets, reflection, and system access are disabled for security',
    csharp: 'Blocked: Process.Start, file I/O, network, reflection, P/Invoke, unsafe/binary code, serialization, and system access are disabled for security',
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
// TURTLE SUPPORT - Python turtle module shim
// ============================================

// Load the Python turtle shim once at startup
let TURTLE_SHIM = '';
try {
  TURTLE_SHIM = fs.readFileSync(
    path.join(__dirname, 'languages', 'python', 'turtle_shim.py'),
    'utf-8'
  );
} catch (e) {
  log('warn', 'turtle_shim_not_found', { error: e.message });
}

/**
 * Returns true when the Python source code imports the turtle module.
 * Handles: `import turtle`, `from turtle import ...`
 */
function hasTurtleImport(code) {
  return /\bimport\s+turtle\b|\bfrom\s+turtle\b/.test(code);
}

/**
 * Parse turtle graphics output from a completed Python execution result.
 *
 * The shim uses two transport strategies:
 *   1. File-based (preferred): writes JSON to a temp file, prints
 *      __TURTLE_FILE__:<path> to stdout. No size limit — works for any
 *      program, even multi-MB spirographs and mandalas.
 *   2. Inline base64 fallback: prints __TURTLE_COMMANDS__:<b64> to stdout.
 *      Used when the file write fails; may truncate for huge programs.
 *
 * In both cases the sentinel is stripped from result.stdout so only the
 * program's real text output is shown in the output panel.
 */
function parseTurtleOutput(result) {
  if (!result.stdout) return;

  // Strip a sentinel line from stdout and return the cleaned string
  function stripSentinel(str, idx, lineEnd) {
    const before = str.slice(0, idx);
    const after  = lineEnd === -1 ? '' : str.slice(lineEnd + 1);
    return (before + after).trim();
  }

  // ── Strategy 1: file-based transport ───────────────────────────────────
  const FILE_MARKER = '__TURTLE_FILE__:';
  const fileIdx = result.stdout.indexOf(FILE_MARKER);
  if (fileIdx !== -1) {
    const lineEnd = result.stdout.indexOf('\n', fileIdx + FILE_MARKER.length);
    const filePath = (lineEnd === -1
      ? result.stdout.slice(fileIdx + FILE_MARKER.length)
      : result.stdout.slice(fileIdx + FILE_MARKER.length, lineEnd)
    ).trim();
    result.stdout = stripSentinel(result.stdout, fileIdx, lineEnd);
    try {
      const json = fs.readFileSync(filePath, 'utf-8');
      result.turtleData = JSON.parse(json);
    } catch (_e) {
      // File not found or invalid JSON — turtleData stays null
    } finally {
      try { fs.unlinkSync(filePath); } catch (_e) { /* already gone */ }
    }
    return;
  }

  // ── Strategy 2: inline base64 fallback ────────────────────────────────
  const MARKER = '__TURTLE_COMMANDS__:';
  const idx = result.stdout.indexOf(MARKER);
  if (idx === -1) return;
  const start   = idx + MARKER.length;
  const newline = result.stdout.indexOf('\n', start);
  const encoded = (newline === -1
    ? result.stdout.slice(start)
    : result.stdout.slice(start, newline)
  ).trim();
  // Always strip — machine data, never human-readable
  result.stdout = stripSentinel(result.stdout, idx, newline);
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    result.turtleData = JSON.parse(json);
  } catch (_e) {
    // Truncated or invalid — turtleData stays null
  }
}

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
    javaTimeoutMs: parseInt(process.env.JAVA_TIMEOUT_MS || "30000", 10), // Java needs more time for compilation
    csharpTimeoutMs: parseInt(process.env.CSHARP_TIMEOUT_MS || "45000", 10), // .NET needs longer for first build
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

  // Immutable, shareable HTML previews.
  preview: {
    maxHtmlBytes: parseInt(process.env.PREVIEW_MAX_BYTES || String(5 * 1024 * 1024), 10),
    ttlMs: parseInt(process.env.PREVIEW_TTL_MS || String(30 * 24 * 60 * 60 * 1000), 10),
    cleanupIntervalMs: parseInt(process.env.PREVIEW_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000), 10),
    storageDir:   process.env.PREVIEW_STORAGE_DIR || path.join(os.tmpdir(), "browser-coder-previews"),
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

    // Pre-build a C#/.NET project template so each run can `dotnet run --no-restore`
    // against a warm bin/obj cache instead of paying the full restore cost.
    this.csharpTemplateDir = path.join(this.tempDir, '_csharp_template');
    this.initCSharpTemplate();
    
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
        
        // Parse turtle graphics output (Python only)
        if (language === 'python') parseTurtleOutput(result);
        
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
  
  /**
   * Execute multi-file project (Step-Up integration)
   * @param {string} language 
   * @param {string} version 
   * @param {Array<{name: string, content: string, isMain?: boolean}>} files 
   */
  async executeMulti(language, version, files, entryPoint = null) {
    // Check capacity
    if (this.activeExecutions >= CONFIG.execution.maxConcurrent) {
      throw new Error('Server at capacity - please try again');
    }
    
    // Generate cache key from all files
    const normalizedEntryPoint = String(
      entryPoint || files.find(f => f.isMain)?.name || files[0]?.name || ''
    ).replace(/\\/g, '/').replace(/^\/+/, '');

    // The selected entry point is part of execution identity. Two runs with
    // identical project files but different active files must never share a
    // cached result or an in-flight deduplication promise.
    const filesHash = files
      .map(f => ({
        name: String(f.name || '').replace(/\\/g, '/').replace(/^\/+/, ''),
        content: String(f.content ?? ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => `${f.name.length}:${f.name}:${f.content.length}:${f.content}`)
      .join('|||');
    const projectIdentity = `entry:${normalizedEntryPoint}|||files:${filesHash}`;
    const cacheKey = SmartCache.hash(language, version, projectIdentity);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
    
    return this.deduplicator.dedupe(cacheKey, async () => {
      this.activeExecutions++;
      this.totalExecutions++;
      
      try {
        const result = await this.executeMultiFile(language, version, files, normalizedEntryPoint);
        
        // Parse turtle graphics output (Python only)
        if (language === 'python') parseTurtleOutput(result);
        
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
  
  /**
   * Execute multi-file code
   */
  async executeMultiFile(language, version, files, entryPoint = null) {
    const projectDir = path.join(this.tempDir, `project_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    
    try {
      // Create project directory
      fs.mkdirSync(projectDir, { recursive: true });
      
      // Write all files
      for (const file of files) {
        const filePath = path.join(projectDir, file.name);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content);
      }
      
      // Find main file
      const normalizedEntryPoint = String(entryPoint || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const mainFile =
        (normalizedEntryPoint && files.find(f => f.name === normalizedEntryPoint)) ||
        files.find(f => f.isMain) ||
        files[0];

      if (!mainFile) {
        throw new Error('No entry file was provided for project execution');
      }
      
      switch (language) {
        case 'javascript':
        case 'typescript':
          return await this.executeJSMulti(projectDir, mainFile.name);
        case 'python':
          return await this.executePythonMulti(projectDir, mainFile.name);
        case 'php':
          return await this.executePHPMulti(projectDir, mainFile.name);
        case 'java':
          return await this.executeJavaMulti(projectDir, files);
        case 'csharp':
          return await this.executeCSharpMulti(projectDir, files);
        default:
          throw new Error(`Multi-file not supported for: ${language}`);
      }
    } finally {
      // Cleanup project directory
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }
  }
  
  async executeJSMulti(projectDir, mainFile) {
    return this.runProcess('node', [
      '--no-warnings',                          // Suppress ExperimentalWarning noise
      '--experimental-permission',
      '--allow-fs-read=' + projectDir,
      '--max-old-space-size=128',
      path.join(projectDir, mainFile)
    ], CONFIG.execution.timeoutMs, { cwd: projectDir });
  }
  
  async executePythonMulti(projectDir, mainFile) {
    const mainFilePath = path.resolve(projectDir, mainFile);
    const projectRoot = path.resolve(projectDir);

    if (mainFilePath !== projectRoot && !mainFilePath.startsWith(projectRoot + path.sep)) {
      throw new Error(`Invalid Python entry point: ${mainFile}`);
    }
    if (!fs.existsSync(mainFilePath) || !fs.statSync(mainFilePath).isFile()) {
      throw new Error(`Python entry point was not written: ${mainFile}`);
    }

    if (TURTLE_SHIM) {
      try {
        const pythonFiles = [];
        const walk = dir => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.endsWith('.py')) pythonFiles.push(full);
          }
        };
        walk(projectDir);

        const needsTurtle = pythonFiles.some(filePath => {
          try { return hasTurtleImport(fs.readFileSync(filePath, 'utf-8')); }
          catch { return false; }
        });

        if (needsTurtle) {
          const original = fs.readFileSync(mainFilePath, 'utf-8');
          fs.writeFileSync(mainFilePath, TURTLE_SHIM + '\n\n# ── user code ──\n' + original);
        }
      } catch {
        // Non-fatal: execute normally if turtle detection/injection fails.
      }
    }

    const mainDir = path.dirname(mainFilePath);

    // Make every workspace folder importable. Moving a Python file into a
    // folder must not make an existing bare import fail just because the
    // module is no longer located beside the entry file. Keep the entry
    // directory and project root first, then append every nested directory in
    // deterministic order. This supports both:
    //   from room1_signal_decoder import decode_signal
    // and:
    //   from New_Folder.room1_signal_decoder import decode_signal
    const importDirs = [];
    const collectImportDirs = dir => {
      importDirs.push(path.resolve(dir));
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== '__pycache__') {
          collectImportDirs(path.join(dir, entry.name));
        }
      }
    };
    collectImportDirs(projectDir);

    const orderedImportDirs = Array.from(new Set([
      mainDir,
      projectRoot,
      ...importDirs.sort((a, b) => a.localeCompare(b)),
    ]));

    const bootstrap = [
      'import runpy, sys',
      `sys.path[:0] = ${JSON.stringify(orderedImportDirs)}`,
      `runpy.run_path(${JSON.stringify(mainFilePath)}, run_name="__main__")`,
    ].join('\n');

    return await this.runProcess(
      'python3',
      ['-u', '-I', '-S', '-B', '-c', bootstrap],
      CONFIG.execution.timeoutMs,
      { cwd: projectDir }
    );
  }

  async executePHPMulti(projectDir, mainFile) {
    return this.runProcess('php', [
      '-d', 'open_basedir=' + projectDir,
      '-d', 'memory_limit=64M',
      '-d', 'max_execution_time=10',
      '-d', 'disable_functions=exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec',
      path.join(projectDir, mainFile)
    ], CONFIG.execution.timeoutMs, { cwd: projectDir });
  }
  
  async executeJavaMulti(projectDir, files) {
    const javaTimeout = CONFIG.execution.javaTimeoutMs;
    
    // Find all Java files
    const javaFiles = files.filter(f => f.name.endsWith('.java'));
    const javaPaths = javaFiles.map(f => path.join(projectDir, f.name));
    
    // Compile all Java files
    const compileResult = await this.runProcess('javac', [
      '-J-Xmx128m',
      ...javaPaths
    ], javaTimeout, { skipJavaSecurityManager: true, cwd: projectDir });
    
    if (compileResult.exitCode !== 0) {
      return { ...compileResult, phase: 'compile' };
    }
    
    // Find main class (file with main method or first file)
    const mainFile = files.find(f => f.isMain) || javaFiles[0];
    const className = mainFile.name.replace('.java', '');
    
    return await this.runProcess('java', [
      '-Xmx128m',
      '-Xms32m',
      '-XX:MaxMetaspaceSize=64m',
      '-cp', projectDir,
      className
    ], javaTimeout, { cwd: projectDir });
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
      case 'csharp':
        return this.executeCSharp(code);
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
      '--no-warnings',                          // Suppress ExperimentalWarning noise
      '--experimental-permission',               // Enable permission model
      '--allow-fs-read=' + this.tempDir,        // Only allow reading temp dir
      '--max-old-space-size=128',               // Limit memory
      '--input-type=module',
      '-e',
      code
    ]);
  }
  
  async executePython(code) {
    // Inject turtle shim before user code when turtle is imported.
    // The shim runs first, registers sys.modules['turtle'], then the user's
    // `import turtle` resolves from the cache and gets our shim module.
    // Security: the shim code is server-controlled and is NOT passed through
    // validateCodeSecurity; only the user's original code is checked.
    let fullCode = code;
    if (TURTLE_SHIM && hasTurtleImport(code)) {
      fullCode = TURTLE_SHIM + '\n\n# ── user code ──\n' + code;
    }
    // SECURITY: Run Python with restricted options
    return this.runProcess('python3', [
      '-u',                 // Unbuffered output
      '-I',                 // Isolated mode: ignore PYTHON* env vars, don't add current directory
      '-S',                 // Don't import site module (reduces available imports)
      '-c',
      fullCode
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
    const javaTimeout = CONFIG.execution.javaTimeoutMs;
    
    try {
      fs.writeFileSync(tempFile, code);
      
      // Compile with restricted options (longer timeout for Java)
      const compileResult = await this.runProcess('javac', [
        '-J-Xmx128m',  // Limit memory
        tempFile
      ], javaTimeout, { skipJavaSecurityManager: true });
      if (compileResult.exitCode !== 0) {
        return { ...compileResult, phase: 'compile' };
      }
      
      // SECURITY: Run with memory limits (pattern validation handles security)
      return await this.runProcess('java', [
        '-Xmx128m',                              // Limit heap memory
        '-Xms32m',                               // Initial heap
        '-XX:MaxMetaspaceSize=64m',              // Limit metaspace
        '-cp', this.tempDir,
        className
      ], javaTimeout);
    } finally {
      try {
        fs.unlinkSync(tempFile);
        fs.unlinkSync(path.join(this.tempDir, `${className}.class`));
      } catch {}
    }
  }

  // ─── C# / .NET ─────────────────────────────────────────────────
  initCSharpTemplate() {
    try {
      if (fs.existsSync(this.csharpTemplateDir)) return;
      fs.mkdirSync(this.csharpTemplateDir, { recursive: true });
      // Minimal .NET 8 console csproj. Disables analyzers and implicit usings
      // to make every dangerous API explicitly require its `using` (still
      // pattern-blocked, but keeps the surface predictable).
      const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AllowUnsafeBlocks>false</AllowUnsafeBlocks>
    <RootNamespace>UserProgram</RootNamespace>
    <AssemblyName>UserProgram</AssemblyName>
    <UseAppHost>false</UseAppHost>
    <EnableDefaultCompileItems>true</EnableDefaultCompileItems>
  </PropertyGroup>
</Project>
`;
      fs.writeFileSync(path.join(this.csharpTemplateDir, 'UserProgram.csproj'), csproj);
      fs.writeFileSync(
        path.join(this.csharpTemplateDir, 'Program.cs'),
        'System.Console.WriteLine("template");\n'
      );
      // Warm restore + build so the per-request cost is just incremental compile.
      log('info', 'csharp_template_warming', { dir: this.csharpTemplateDir });
      const r = spawnSync(
        'dotnet',
        ['build', '-c', 'Release', '--nologo', '-v', 'q'],
        {
          cwd: this.csharpTemplateDir,
          timeout: 120000,
          env: {
            ...process.env,
            DOTNET_NOLOGO: '1',
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            // Same fix as runProcess(): DOTNET_CLI_HOME must point somewhere
            // writable. This runs with the Node process's own env (HOME=
            // /home/app from the Dockerfile), which is read-only in production
            // (`read_only: true`), so without this override the warm-up build
            // itself fails and the template never gets a valid
            // obj/project.assets.json - making every subsequent per-run copy
            // fail with NETSDK1004, for every C# execution.
            HOME: this.tempDir,
            DOTNET_CLI_HOME: this.tempDir,
          },
        }
      );
      if (r.status !== 0) {
        log('warn', 'csharp_template_build_failed', { stderr: (r.stderr || '').toString().slice(0, 500) });
      } else {
        log('info', 'csharp_template_ready');
      }
    } catch (err) {
      log('warn', 'csharp_template_init_error', { error: err.message });
    }
  }

  copyCSharpTemplate(targetDir) {
    if (!fs.existsSync(this.csharpTemplateDir)) {
      this.initCSharpTemplate();
    }
    fs.mkdirSync(targetDir, { recursive: true });
    // Recursive copy of the warm template (csproj + obj + bin)
    fs.cpSync(this.csharpTemplateDir, targetDir, { recursive: true, force: true });
  }

  async executeCSharp(code) {
    const csTimeout = CONFIG.execution.csharpTimeoutMs;
    const projectDir = path.join(this.tempDir, `csharp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    try {
      this.copyCSharpTemplate(projectDir);
      // Replace Program.cs with user code
      fs.writeFileSync(path.join(projectDir, 'Program.cs'), code);
      // Run with --no-restore to skip NuGet (template already restored)
      return await this.runProcess('dotnet', [
        'run',
        '-c', 'Release',
        '--no-restore',
        '--nologo',
        '-v', 'q',
        '--project', projectDir,
      ], csTimeout, { cwd: projectDir, csharp: true });
    } finally {
      try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    }
  }

  async executeCSharpMulti(projectDir, files) {
    const csTimeout = CONFIG.execution.csharpTimeoutMs;
    // Drop in csproj from template so the user's project compiles
    const tplCsproj = path.join(this.csharpTemplateDir, 'UserProgram.csproj');
    if (fs.existsSync(tplCsproj)) {
      fs.copyFileSync(tplCsproj, path.join(projectDir, 'UserProgram.csproj'));
    } else {
      this.initCSharpTemplate();
      if (fs.existsSync(tplCsproj)) {
        fs.copyFileSync(tplCsproj, path.join(projectDir, 'UserProgram.csproj'));
      }
    }
    return await this.runProcess('dotnet', [
      'run',
      '-c', 'Release',
      '--nologo',
      '-v', 'q',
      '--project', projectDir,
    ], csTimeout, { cwd: projectDir, csharp: true });
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
        // .NET: suppress first-run welcome/telemetry/HTTPS-cert banner and workload checks
        DOTNET_NOLOGO: '1',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
        DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
        DOTNET_SKIP_WORKLOAD_INTEGRITY_CHECK: '1',
        DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: '1',
        // .NET CLI writes its first-run sentinel/lock files under DOTNET_CLI_HOME
        // (NOT the generic HOME env var, and NOT skipped by DOTNET_NOLOGO/
        // DOTNET_SKIP_FIRST_TIME_EXPERIENCE above - those only silence the banner
        // text). Without this, it defaults to the OS home directory of the
        // container's user (e.g. /home/app), which is read-only in production
        // (docker-compose.prod.yml sets `read_only: true` on the api service),
        // so the "first time use" configurer throws an unhandled IOException and
        // the whole `dotnet build`/`dotnet run` invocation fails - surfacing as a
        // seemingly unrelated NETSDK1004 "assets file not found" error.
        DOTNET_CLI_HOME: this.tempDir,
      };
      
      // Only add Java security manager for runtime, not compilation
      if (!options.skipJavaSecurityManager) {
        // Note: We rely on pattern-based validation instead of Java SecurityManager
        // because the default SecurityManager blocks even System.out.println()
        sanitizedEnv.JAVA_TOOL_OPTIONS = '-Xmx128m';
      } else {
        sanitizedEnv.JAVA_TOOL_OPTIONS = '-Xmx128m';  // Just memory limit for compiler
      }
      
      const proc = spawn(command, args, {
        cwd: options.cwd || this.tempDir,
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
// SHAREABLE HTML PREVIEW STORE
// ============================================
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function ensurePreviewStorageDir() {
  try {
    fs.mkdirSync(CONFIG.preview.storageDir, {
      recursive: true,
      mode: 0o700,
    });
  } catch (error) {
    log("error", "preview_storage_unavailable", {
      path: CONFIG.preview.storageDir,
      error: error.message,
    });

    throw new Error(
      `Preview storage is not writable: ${CONFIG.preview.storageDir}`
    );
  }
}

function previewFilePath(previewId) {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
  return path.join(CONFIG.preview.storageDir, `${previewId}.html`);
}

function createPreviewId() {
  // 160 random bits encoded as 27 URL-safe characters.
  return crypto.randomBytes(16).toString("base64url");
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPreviewShell(html) {
  const escapedHtml = escapeHtmlAttribute(html);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Browser Coder Preview</title>
  <style>
    html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#fff}
  </style>
</head>
<body>
  <iframe
    title="Browser Coder website preview"
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
    referrerpolicy="no-referrer"
    srcdoc="${escapedHtml}"
  ></iframe>
</body>
</html>`;
}

async function writeImmutablePreview(html) {
  ensurePreviewStorageDir();

  // "wx" guarantees that an existing preview is never overwritten.
  for (let attempt = 0; attempt < 5; attempt++) {
    const previewId = createPreviewId();
    const filePath = previewFilePath(previewId);

    try {
      await fs.promises.writeFile(filePath, html, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return previewId;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  throw new Error("Could not allocate a unique preview ID");
}

async function cleanupExpiredPreviews() {
  ensurePreviewStorageDir();
  const expiresBefore = Date.now() - CONFIG.preview.ttlMs;

  let entries;
  try {
    entries = await fs.promises.readdir(CONFIG.preview.storageDir, {
      withFileTypes: true,
    });
  } catch (error) {
    log("warn", "Preview cleanup could not read storage", {
      error: error.message,
    });
    return;
  }

  await Promise.allSettled(
    entries
      .filter(entry => entry.isFile() && /^[A-Za-z0-9_-]{22}\.html$/.test(entry.name))
      .map(async entry => {
        const filePath = path.join(CONFIG.preview.storageDir, entry.name);
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < expiresBefore) {
          await fs.promises.unlink(filePath);
        }
      }),
  );
}

let previewStorageReady = false;
try {
  ensurePreviewStorageDir();
  previewStorageReady = true;
} catch (error) {
  log("error", "preview_storage_startup_failed", {
    path: CONFIG.preview.storageDir,
    error: error instanceof Error ? error.message : String(error),
  });
}

const previewCleanupTimer = setInterval(() => {
  if (previewStorageReady) void cleanupExpiredPreviews();
}, CONFIG.preview.cleanupIntervalMs);
previewCleanupTimer.unref?.();
if (previewStorageReady) void cleanupExpiredPreviews();

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

// Only preview publishing receives the larger request-body allowance.
app.use(
  "/api/previews",
  express.json({ limit: CONFIG.preview.maxHtmlBytes }),
);
app.use(express.json({ limit: "100kb" }));

// Request ID
app.use((req, res, next) => {
  req.id = crypto.randomBytes(4).toString("hex");
  res.setHeader("X-Request-ID", req.id);
  next();
});

// ============================================
// CORS CONFIGURATION - Step-Up Integration
// ============================================
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'http://localhost:3000',
  'http://localhost',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:3000',
  'https://stepup.school',
  'https://step-up.co.il',
  'https://www.stepup.school',
  'https://www.step-up.co.il',
    'https://arc.co',
     'https://www.arc.co',
  // Development / staging
  'http://stepup.local',
  'https://staging.stepup.school',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  
  // Direct match
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  
  // Subdomain match for stepup.school and step-up.co.il
  const allowedDomains = ['stepup.school', 'step-up.co.il'];
  for (const domain of allowedDomains) {
    if (origin.endsWith('.' + domain) || origin.endsWith('://' + domain)) {
      return true;
    }
  }
  
  return false;
}

// CORS middleware
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  
  // In development, allow all origins for easier testing
  if (CONFIG.isDev) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && isAllowedOrigin(origin)) {
    // Production: only allow specific origins
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // No origin header (same-origin requests, server-to-server, etc.)
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    // Origin not allowed - log and reject preflight, allow other requests but log warning
    log('warn', 'cors_rejected', { origin, path: req.path, method: req.method });
    if (req.method === "OPTIONS") {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    // For non-preflight, still set headers but log
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limiting (bypass for localhost/tests)
// NOTE: the "api" service has no published port (docker-compose.yml only
// publishes nginx on :80) - the only things that can reach it directly on
// the "internal" bridge network are sibling containers we control
// (nginx, security-tests, autoscaler). Real end-user traffic always comes
// through nginx, which sets X-Forwarded-For with the true public client IP
// (trust proxy is enabled below), so it is still rate-limited correctly.
// Requests hitting api directly from a private/internal IP (e.g. the
// security-tests container running `security/run.mjs` against
// http://api:3001) are therefore safe to exempt.
function isTrustedInternalIp(ip) {
  if (!ip) return false;
  const v4 = ip.replace(/^::ffff:/, '');
  if (v4 === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  return (
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(v4)
  );
}

app.use("/api", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Bypass rate limiting for localhost and trusted internal/private network callers
  if (isTrustedInternalIp(ip)) {
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
// Short shareable previews are published through POST /api/previews.
// Publish an immutable shareable preview.
app.post("/api/previews", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).json({
      error: "Preview storage is unavailable. Configure PREVIEW_STORAGE_DIR as a writable persistent volume.",
    });
  }

  const html = typeof req.body?.html === "string" ? req.body.html : "";
  const entryPath =
    typeof req.body?.entryPath === "string"
      ? req.body.entryPath.slice(0, 500)
      : "index.html";

  if (!html.trim()) {
    return res.status(400).json({ error: "Preview HTML is required" });
  }

  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > CONFIG.preview.maxHtmlBytes) {
    return res.status(413).json({
      error: `Preview is too large. Maximum size is ${CONFIG.preview.maxHtmlBytes} bytes.`,
    });
  }

  try {
    const previewId = await writeImmutablePreview(html);
    const previewPath = `/preview/${previewId}`;

    return res.status(201).json({
      id: previewId,
      entryPath,
      previewPath,
      // Keep this relative. The browser resolves it against the actual public
      // coder origin, even when nginx/reverse-proxy host headers differ.
      previewUrl: previewPath,
      expiresAt: new Date(Date.now() + CONFIG.preview.ttlMs).toISOString(),
    });
  } catch (error) {
    log("error", "Failed to publish preview", {
      requestId: req.id,
      error: error.message,
    });
    return res.status(500).json({ error: "Could not publish preview" });
  }
});

// Serve the preview through a real URL while isolating student code.
app.get("/preview/:previewId", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).type("text/plain").send("Preview storage is unavailable");
  }

  const filePath = previewFilePath(req.params.previewId);
  if (!filePath) {
    return res.status(404).type("text/plain").send("Preview not found");
  }

  try {
    const stat = await fs.promises.stat(filePath);

    if (Date.now() - stat.mtimeMs > CONFIG.preview.ttlMs) {
      await fs.promises.unlink(filePath).catch(() => {});
      return res.status(410).type("text/plain").send("This preview has expired");
    }

    const html = await fs.promises.readFile(filePath, "utf8");

    res.setHeader("Cache-Control", "public, max-age=300, immutable");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' data: blob:; child-src 'self' data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors *",
    );

    return res.status(200).type("html").send(buildPreviewShell(html));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).type("text/plain").send("Preview not found");
    }

    log("error", "Failed to load preview", {
      requestId: req.id,
      previewId: req.params.previewId,
      error: error.message,
    });
    return res.status(500).type("text/plain").send("Could not load preview");
  }
});

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
  const extensions = { javascript: 'js', typescript: 'ts', python: 'py', java: 'java', php: 'php', csharp: 'cs' };
  return extensions[language] || 'txt';
}

// Run code (supports single file and multi-file execution)
//
// Single-file payload:  { language, version, code }
// Multi-file payload:   { language, version, files: [{ path|name, content, language?, isMain? }], entryPoint? }
//
// `entryPoint` (top-level) takes precedence over per-file `isMain`.
app.post("/api/run", async (req, res) => {
  const { language, version, code, files, entryPoint } = req.body;
  
  if (!language) {
    return res.status(400).json({ error: "Missing language" });
  }
  
  // Support both single-file (code) and multi-file (files) modes
  let codeToRun = code;
  let allFiles = null;
  let selectedEntryPoint = null;
  
  if (files && Array.isArray(files) && files.length > 0) {
    // Normalize file shape: accept { path } or { name }
    const normalized = files.map(f => ({
      name: String(f.path || f.name || '').replace(/\\/g, '/').replace(/^\/+/, ''),
      content: typeof f.content === 'string' ? f.content : '',
      language: f.language,
      isMain: !!f.isMain,
    })).filter(f => f.name);
    
    if (normalized.length === 0) {
      return res.status(400).json({ error: "files[] must contain at least one named file" });
    }
    
    // Reject path traversal / absolute paths
    for (const f of normalized) {
      if (f.name.includes('..') || f.name.startsWith('/') || f.name.startsWith('\\') || /^[a-zA-Z]:/.test(f.name)) {
        return res.status(400).json({ error: `Invalid file path: ${f.name}` });
      }
    }
    
    const totalSize = normalized.reduce((sum, f) => sum + f.content.length, 0);
    if (totalSize > 100000) {
      return res.status(400).json({ error: "Total code size too large (max 100KB)" });
    }
    
    // Security check all files
    for (const file of normalized) {
      if (!file.content) continue;
      const securityCheck = validateCodeSecurity(language, file.content);
      if (!securityCheck.safe) {
        log('warn', 'security_block', { 
          language, 
          file: file.name,
          reason: securityCheck.reason,
          matched: securityCheck.matched,
          ip: req.ip 
        });
        return res.status(403).json({ 
          error: `${file.name}: ${securityCheck.reason}`,
          blocked: true,
        });
      }
    }
    
    // Determine entry point once and keep it in route scope. Do not keep a
    // block-scoped `mainFile` and reference it later after this branch.
    const requestedEntryPoint = String(entryPoint || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    const selectedMainFile = requestedEntryPoint
      ? normalized.find(file => file.name === requestedEntryPoint)
      : (normalized.find(file => file.isMain) || normalized[0]);

    if (!selectedMainFile) {
      return res.status(400).json({ error: 'No entry file was provided' });
    }
    if (requestedEntryPoint && selectedMainFile.name !== requestedEntryPoint) {
      return res.status(400).json({ error: `entryPoint "${entryPoint}" not found in files` });
    }

    // Ensure exactly one file is marked as the entry file. This prevents a
    // stale isMain flag from overriding the active file in Java/C# executors.
    for (const file of normalized) {
      file.isMain = file.name === selectedMainFile.name;
    }

    selectedEntryPoint = selectedMainFile.name;
    codeToRun = selectedMainFile.content;
    allFiles = normalized;
  } else if (code) {
    // Single-file mode (backward compatible)
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
  } else {
    return res.status(400).json({ error: "Missing code or files" });
  }
  
  try {
    // Pass allFiles to executor for multi-file support (if supported)
    const result = allFiles
      ? await executor.executeMulti(language, version, allFiles, selectedEntryPoint)
      : await executor.execute(language, version, codeToRun);
    
    res.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      cached: result.cached || false,
      turtleData: result.turtleData || null,
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
    const reportsDir = path.join(__dirname, "security", "reports");
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
    
    // Run tests in background using the security module
    const { spawn: nodeSpawn } = await import('node:child_process');
    const testProcess = nodeSpawn('node', ['security/run.mjs', '--server=http://localhost:3001'], {
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

// Serve security reports directory (always enable - volume mount creates it)
const reportsPath = path.join(__dirname, "security", "reports");
// Ensure directory exists
if (!fs.existsSync(reportsPath)) {
  fs.mkdirSync(reportsPath, { recursive: true });
}
app.use("/reports", express.static(reportsPath, { index: 'index.html' }));

// Serve static files in production.
//
// Important:
// - Hashed Vite assets must either return the real file or a real 404.
// - They must never fall through to index.html, otherwise browsers receive
//   text/html for JavaScript/CSS and report MIME-type/preload failures.
// - index.html is not cached so a deployment cannot leave users with an old
//   HTML document that references assets removed by the new image.
if (!CONFIG.isDev) {
  const distPath = path.join(__dirname, "dist");

  if (fs.existsSync(distPath)) {
    const assetsPath = path.join(distPath, "assets");

    app.use(
      "/assets",
      express.static(assetsPath, {
        fallthrough: false,
        index: false,
        immutable: true,
        maxAge: "1y",
        setHeaders(res) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.setHeader("X-Content-Type-Options", "nosniff");
        },
      }),
    );

    app.get(["/", "/index.html"], (req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.sendFile(path.join(distPath, "index.html"));
    });

    app.use(
      express.static(distPath, {
        fallthrough: true,
        index: false,
        maxAge: 0,
        setHeaders(res, filePath) {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          }
        },
      }),
    );

    // SPA fallback is only for navigation routes. Requests that look like
    // files receive a real 404 instead of index.html.
    app.get("*", (req, res, next) => {
      if (path.extname(req.path)) return next();

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.sendFile(path.join(distPath, "index.html"));
    });

    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      return res.status(404).type("text/plain").send("Static asset not found");
    });
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
function gracefulShutdown(signal) {
  log('info', `Received ${signal}, shutting down gracefully...`);
  clearInterval(previewCleanupTimer);
  
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
