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
    
    // Python is scanned with comments and string literals removed first (see
    // stripPythonCommentsAndStrings), so a blocked word inside a comment, a
    // docstring, a printed message or a file name can never refuse a program -
    // only real code is inspected.
    //
    // These patterns are case-sensitive, because Python is: a student's own
    // Path() or File() must not collide with pathlib or Python 2's file().
    // Names that are dangerous only as *builtins* carry a (?<![.\w]) guard, so
    // a method call on the student's own object - door.open(), maze.clear() -
    // stays legal, and so does defining one (`def open(self):`). The AST pass in languages/python/preflight.py then makes the
    // fine-grained decision: real imports and real calls only.
    python: [
      // ── Dangerous imports ────────────────────────────────────────────────
      /\b(?:import|from)\s+(?:os|sys|subprocess|socket|ssl|select|signal|shutil|pathlib|io|codecs|base64|binascii|pickle|cPickle|marshal|ctypes|mmap|resource|pty|tty|termios|fcntl|threading|multiprocessing|asyncio|importlib|builtins|inspect|gc|dis|ast|code|types|platform|tempfile|glob|fnmatch|fileinput|getpass|webbrowser|sqlite3|http|urllib|urllib2|requests|ftplib|smtplib|telnetlib|poplib|imaplib|nntplib|xmlrpc|commands|shelve|dbm|anydbm|whichdb|zipfile|tarfile|gzip|bz2|lzma|runpy|pdb|site|sysconfig|venv|distutils|setuptools|posix|nt|pwd|grp|spwd|crypt|curses|pipes|popen2|_thread|_socket|_posixsubprocess)\b/,
      // ── Command / process execution ──────────────────────────────────────
      /\bos\s*\.\s*(?:system|popen|spawn\w*|exec\w*|fork|kill|remove|unlink|rmdir|mkdir|makedirs|rename|chmod|chown|chdir|listdir|walk|environ|getenv|putenv)\b/,
      /\bsubprocess\s*\./,
      /(?<![.\w])(?<!\bdef\s)popen\s*\(/,
      // ── Code execution / import machinery ────────────────────────────────
      /(?<![.\w])(?<!\bdef\s)(?:eval|exec|compile|__import__|breakpoint)\s*\(/,
      /(?<![.\w])(?<!\bdef\s)(?:globals|locals|vars)\s*\(/,
      /(?<![.\w])(?<!\bdef\s)(?:getattr|setattr|delattr)\s*\(/,
      /\bimportlib\s*\./,
      // ── File access ──────────────────────────────────────────────────────
      /(?<![.\w])(?<!\bdef\s)open\s*\(/,
      /\b(?:codecs|io)\s*\.\s*open\s*\(/,
      /\bfileinput\s*\.\s*input\s*\(/,
      /\bgetpass\s*\./,
      // ── Interpreter internals (classic sandbox-escape chains) ────────────
      /\b__builtins__\b/,
      /\b__class__\b/,
      /\b__subclasses__\b/,
      /\b__globals__\b/,
      /\b__code__\b/,
      /\b__bases__\b/,
      /\b__mro__\b/,
      /\bsys\s*\.\s*_getframe\b/,
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
 * Return `code` with every comment and string literal blanked out, keeping all
 * other characters and every newline in place.
 *
 * Python security scanning runs on the result, so a blocked word in a comment, a
 * docstring, a printed message or an SVG file name can never be the reason a
 * program is refused - only real code is inspected.
 *
 * f-string replacement fields are deliberately NOT blanked: they hold real
 * expressions, so code hidden in one must stay visible to the scanner.
 */
function stripPythonCommentsAndStrings(code) {
  const src = String(code);
  let out = '';
  let i = 0;

  // Keep newlines so reported line numbers still line up with the source.
  const blank = (ch) => { out += ch === '\n' ? '\n' : ' '; };

  while (i < src.length) {
    const ch = src[i];

    // ── Comment: blank out the rest of the line ──────────────────────────
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') blank(src[i++]);
      continue;
    }

    // ── String literal, with any prefix (r, b, u, f, rb, …) ──────────────
    const opener = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    const atTokenStart = i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]);
    if (opener && (opener[1].length === 0 || atTokenStart)) {
      const prefix = opener[1];
      const quote = opener[2];
      const isFString = /[fF]/.test(prefix);

      for (const c of prefix + quote) blank(c);
      i += prefix.length + quote.length;

      while (i < src.length) {
        // A backslash escapes the next character - in raw strings too, as far
        // as finding the end of the literal goes.
        if (src[i] === '\\' && i + 1 < src.length) {
          blank(src[i]); blank(src[i + 1]);
          i += 2;
          continue;
        }
        if (src.startsWith(quote, i)) {
          for (const c of quote) blank(c);
          i += quote.length;
          break;
        }
        // f-string replacement field: {...} is code, not text. Keep it verbatim
        // and blank only the literal text around it.
        if (isFString && src[i] === '{') {
          if (src[i + 1] === '{') { blank(src[i]); blank(src[i + 1]); i += 2; continue; }
          let depth = 0;
          while (i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            out += src[i];
            i++;
            if (depth === 0) break;
          }
          continue;
        }
        blank(src[i]);
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Validates code for dangerous patterns
 * @returns {{ safe: boolean, reason?: string, matched?: string }}
 */
function validateCodeSecurity(language, code) {
  const patterns = SECURITY.patterns[language];
  if (!patterns) {
    return { safe: true };
  }

  // Python patterns describe code, so comments and string literals are removed
  // before matching. Every other language is still scanned as written.
  const haystack = language === 'python'
    ? stripPythonCommentsAndStrings(code)
    : code;

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
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

// The exact prefix injected before user code when a turtle program runs.
// Keep this in one place so the line-offset math below always matches what
// executePython / executePythonMulti actually write to disk.
const TURTLE_USER_CODE_SEP = '\n\n# ── user code ──\n';

/**
 * Number of lines the turtle shim + separator occupy before the user's first
 * line. A Python traceback for a turtle program reports line numbers in the
 * combined file, so we subtract this offset to recover the line the user
 * actually wrote in the editor. Returns 0 when the shim is not prepended.
 */
function turtleShimLineOffset() {
  if (!TURTLE_SHIM) return 0;
  const prefix = TURTLE_SHIM + TURTLE_USER_CODE_SEP;
  // Count newlines in the prefix: the char after the last one starts user line 1.
  let n = 0;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] === '\n') n++;
  return n;
}

/**
 * Rewrite a Python traceback so line numbers match the user's editor when the
 * turtle shim was prepended to their code.
 *
 *   • Frames for the shim-carrying file, in the user-code region (line >
 *     offset), are shifted back by the offset so `line 769` becomes the real
 *     `line 6`.
 *   • Shim-internal frames (same file, line <= offset) are dropped together
 *     with their indented source snippet — they are implementation detail the
 *     user never wrote and would only be confusing.
 *   • Frames for any *other* file (imported user modules) are left untouched:
 *     their line numbers are already correct.
 *
 * @param {string} text     the stderr traceback
 * @param {number} offset   turtleShimLineOffset()
 * @param {string} fileMatch substring the File path must contain to be adjusted
 *                            (e.g. 'user.py' or the main file's basename)
 */
function adjustTurtleTraceback(text, offset, fileMatch) {
  if (!text || !offset) return text || '';
  const lines = text.split('\n');
  const out = [];
  // Tolerate a trailing \r so Windows (\r\n) and Linux (\n) both parse.
  const frameRe = /^(\s*File\s+")([^"]*)("\s*,\s+line\s+)(\d+)(.*?)\r?$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(frameRe);
    if (!m) { out.push(lines[i]); continue; }
    const filePath = m[2];
    const lineNo = parseInt(m[4], 10);
    const isTargetFile = !fileMatch || filePath.includes(fileMatch);
    if (!isTargetFile) { out.push(lines[i]); continue; }
    if (lineNo > offset) {
      // User-code frame — shift the number, keep the frame and its snippet.
      out.push(m[1] + m[2] + m[3] + (lineNo - offset) + m[5]);
    } else {
      // Shim-internal frame — drop it, plus every indented snippet line Python
      // printed beneath it (the source line and, on 3.11+, the caret underline),
      // so the trace stays coherent and shows only user code.
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (frameRe.test(next) || !/^\s{2,}\S/.test(next)) break;
        i++;
      }
    }
  }
  return out.join('\n');
}

// Absolute path to the Python pre-run static checker (see preflight.py).
const PYTHON_PREFLIGHT_PATH = path.join(__dirname, 'languages', 'python', 'preflight.py');
const PYTHON_PREFLIGHT_AVAILABLE = fs.existsSync(PYTHON_PREFLIGHT_PATH);

/**
 * Format the JSON problems emitted by preflight.py into a Python-style error
 * block the output panel can show. Each problem becomes:
 *
 *     File "user.py", line 2
 *       prin("test")
 *       ^
 *   NameError: name 'prin' is not defined
 *
 * @param {Array<{line:number,col:number,msg:string,text:string}>} problems
 * @param {string} filename  display name (e.g. 'user.py' or 'main.py')
 */
function formatPreflightProblems(problems, filename) {
  return problems.map((p) => {
    const lines = [`  File "${filename}", line ${p.line}`];
    if (p.text) {
      lines.push('    ' + p.text.replace(/\s+$/, ''));
      const caretCol = Math.max(1, Number(p.col) || 1);
      lines.push(' '.repeat(4 + caretCol - 1) + '^');
    }
    lines.push(p.msg);
    return lines.join('\n');
  }).join('\n\n');
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
// TYPESCRIPT COMPILER SUPPORT
// ============================================
// Loaded lazily on first TypeScript execution. Requires the `typescript`
// package to be installed (it is now listed in production dependencies).
// Falls back gracefully if unavailable (compilation errors won't be caught
// server-side, but Monaco's client-side TS worker still catches them).
let _tsCompiler = null;
let _tsLoadAttempted = false;

async function getTsCompiler() {
  if (_tsLoadAttempted) return _tsCompiler;
  _tsLoadAttempted = true;
  try {
    const mod = await import('typescript');
    _tsCompiler = mod.default || mod;
    log('info', 'ts_compiler_loaded', { version: _tsCompiler.version });
  } catch (e) {
    log('warn', 'ts_compiler_unavailable', { error: e.message });
  }
  return _tsCompiler;
}

/**
 * Remove temp-dir path prefix from compiler/runtime output so users see short,
 * actionable filenames instead of internal sandbox paths.
 */
function stripTempPath(text, dirToStrip) {
  if (!text || !dirToStrip) return text || '';
  const prefix = dirToStrip.endsWith('/') ? dirToStrip : dirToStrip + '/';
  return text.replace(new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
}

/**
 * Remove dotnet temp-dir noise and csproj paths from C# compiler output.
 * Produces a clean multi-line error list suitable for display to the user.
 */
function cleanCSharpErrors(text, projectDir) {
  if (!text) return '';
  return stripTempPath(text, projectDir)
    .replace(/\s*\[[^\]]*\.csproj\]/g, '')                     // remove [/path/X.csproj]
    .replace(/^Build\s+(FAILED|succeeded)\.?\s*$/gim, '')      // remove build summary
    .replace(/^\s*\d+\s+(Error|Warning)\(s\)\s*$/gim, '')      // remove error count line
    .replace(/^Time Elapsed\s.*$/gim, '')                      // remove timing line
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

    // Project size policy enforced by POST /api/run. maxCodeChars applies to
    // BOTH modes: single-file `code` (code.length) AND multi-file `files[]`
    // (the SUM of every file's content across the whole project). These are
    // the ONLY numbers that define "how big a project may be" - the
    // request-body-size limit below is derived from them, so raising a limit
    // here automatically raises the transport allowance too.
    //
    // The default is baked in (not left at 100 KB) on purpose: the prod
    // deploy reliably pulls a fresh image via `docker compose pull`, but the
    // compose file's env block only reaches the container if the droplet's
    // `git pull` succeeded. Relying on the env var alone silently fell back
    // to 100 KB when that pull was skipped. Env vars still override for tuning.
    maxCodeChars: parseInt(process.env.MAX_CODE_CHARS || "750000", 10),
    maxProjectFiles: parseInt(process.env.MAX_PROJECT_FILES || "300", 10),
    maxPathChars: parseInt(process.env.MAX_PATH_CHARS || "300", 10),

    // Interactive stdin sessions (programs that call input()/Scanner/readline).
    // Unlike a normal fire-and-forget run, these stay alive while waiting for
    // the user to type, so they need their OWN kill-switches:
    //   - idle timeout: no output AND no keystroke for this long -> kill (a
    //     process "waiting for input forever" is a resource-hold DoS vector).
    //     Generous by default: a beginner reading a question and typing an
    //     answer can easily pause for a couple of minutes.
    //   - max lifetime: absolute ceiling regardless of activity.
    //   - concurrency caps: total, and per-IP.
    //
    // The per-IP cap must not be tight: a whole classroom (or school) sits
    // behind a single NAT address, so every student would share one budget.
    // It exists to stop one machine opening unbounded sessions, not to ration
    // legitimate simultaneous use.
    interactiveIdleTimeoutMs: parseInt(process.env.INTERACTIVE_IDLE_MS || "300000", 10),
    interactiveMaxLifetimeMs: parseInt(process.env.INTERACTIVE_MAX_MS || "900000", 10),
    maxInteractiveSessions: parseInt(process.env.MAX_INTERACTIVE_SESSIONS || "200", 10),
    maxInteractiveSessionsPerIp: parseInt(process.env.MAX_INTERACTIVE_PER_IP || "50", 10),
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
    maxFileCount: parseInt(process.env.PREVIEW_MAX_FILES || "250", 10),
    maxPathChars: parseInt(process.env.PREVIEW_MAX_PATH_CHARS || "500", 10),
    ttlMs: parseInt(process.env.PREVIEW_TTL_MS || String(30 * 24 * 60 * 60 * 1000), 10),
    cleanupIntervalMs: parseInt(process.env.PREVIEW_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000), 10),
    storageDir: process.env.PREVIEW_STORAGE_DIR || path.join(os.tmpdir(), "browser-coder-previews"),
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
          return await this.executeJSMulti(projectDir, mainFile.name);
        case 'typescript':
          return await this.executeTSMulti(projectDir, mainFile.name);
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

  /**
   * Multi-file TypeScript execution:
   * Transpiles every .ts file in the project to a sibling .js (CommonJS),
   * then runs the entry-point .js with Node.  Compile errors from any file
   * are collected and returned before any execution is attempted.
   */
  async executeTSMulti(projectDir, mainFile) {
    const startTime = Date.now();
    const ts = await getTsCompiler();

    if (!ts) {
      log('warn', 'ts_compiler_missing_multi_fallback', { mainFile });
      // Fallback: will fail for real TS syntax, but lets pure-JS code work
      return this.runProcess('node', [
        '--no-warnings', '--experimental-permission',
        '--allow-fs-read=' + projectDir, '--max-old-space-size=128',
        path.join(projectDir, mainFile),
      ], CONFIG.execution.timeoutMs, { cwd: projectDir });
    }

    // Walk project directory and collect .ts files
    const tsFiles = [];
    const walkTs = (dir) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules') walkTs(full);
          else if (entry.isFile() && entry.name.endsWith('.ts')) tsFiles.push(full);
        }
      } catch { /* ignore unreadable dirs */ }
    };
    walkTs(projectDir);

    // Transpile each .ts → sibling .js (CommonJS so require() resolves correctly)
    const compileErrors = [];
    for (const tsFile of tsFiles) {
      const relPath = path.relative(projectDir, tsFile).replace(/\\/g, '/');
      let src;
      try { src = fs.readFileSync(tsFile, 'utf-8'); } catch { continue; }

      let result;
      try {
        result = ts.transpileModule(src, {
          fileName: relPath,
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            strict: false,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            experimentalDecorators: true,
            sourceMap: false,
          },
          reportDiagnostics: true,
        });
      } catch (e) {
        compileErrors.push(`${relPath}: ${e.message}`);
        continue;
      }

      if (result.diagnostics && result.diagnostics.length > 0) {
        result.diagnostics.forEach(d => {
          const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          if (d.file && d.start !== undefined) {
            const pos = d.file.getLineAndCharacterOfPosition(d.start);
            compileErrors.push(`${relPath}:${pos.line + 1}:${pos.character + 1} - error TS${d.code}: ${msg}`);
          } else {
            compileErrors.push(`error TS${d.code}: ${msg}`);
          }
        });
      }

      try {
        fs.writeFileSync(tsFile.replace(/\.ts$/, '.js'), result.outputText);
      } catch (e) {
        compileErrors.push(`${relPath}: could not write transpiled output: ${e.message}`);
      }
    }

    if (compileErrors.length > 0) {
      return {
        stdout: '',
        stderr: compileErrors.join('\n'),
        exitCode: 1,
        phase: 'compile',
        durationMs: Date.now() - startTime,
      };
    }

    // Run transpiled entry point
    const mainJs = path.join(projectDir, mainFile.replace(/\.ts$/, '.js'));
    return this.runProcess('node', [
      '--no-warnings', '--experimental-permission',
      '--allow-fs-read=' + projectDir, '--max-old-space-size=128',
      mainJs,
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

    // Pre-run static check on the entry file: refuse to run anything if it has
    // a syntax error or undefined name, so nothing executes half-way. Runs
    // before shim injection so it scans the user's original source only.
    try {
      const entrySource = fs.readFileSync(mainFilePath, 'utf-8');
      const preflight = await this.preflightPython(entrySource, path.basename(mainFile));
      if (preflight) return preflight;
    } catch {
      // Non-fatal: fall through to normal execution.
    }

    let shimInjected = false;
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
          fs.writeFileSync(mainFilePath, TURTLE_SHIM + TURTLE_USER_CODE_SEP + original);
          shimInjected = true;
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

    const result = await this.runProcess(
      'python3',
      ['-u', '-I', '-S', '-B', '-c', bootstrap],
      CONFIG.execution.timeoutMs,
      { cwd: projectDir }
    );
    // Always replace project dir paths for readable error messages.
    if (result.exitCode !== 0 && result.stderr) {
      result.stderr = stripTempPath(result.stderr, projectDir).trim();
      // When the turtle shim was prepended to the entry file, shift its
      // traceback line numbers back so they match the user's editor.
      if (shimInjected) {
        result.stderr = adjustTurtleTraceback(
          result.stderr,
          turtleShimLineOffset(),
          path.basename(mainFile)
        ).trim();
      }
    }
    // Detect Python syntax/indentation errors (occur before any execution)
    if (result.exitCode !== 0 && result.stderr && !result.stdout) {
      if (/\n(SyntaxError|IndentationError|TabError):/m.test(result.stderr) &&
          !/^Traceback/m.test(result.stderr)) {
        result.phase = 'compile';
      }
    }
    return result;
  }

  async executePHPMulti(projectDir, mainFile) {
    const mainFilePath = path.join(projectDir, mainFile);

    // ── Syntax check ────────────────────────────────────────────────────────
    const lintResult = await this.runProcess('php', [
      '-d', 'open_basedir=' + projectDir,
      '-l',
      mainFilePath,
    ], 10000, {});

    if (lintResult.exitCode !== 0) {
      const raw = (lintResult.stdout || lintResult.stderr || '').trim();
      const cleaned = stripTempPath(raw, projectDir)
        .replace(/\nErrors parsing[^\n]*$/m, '')
        .trim();
      return {
        stdout: '',
        stderr: cleaned || raw,
        exitCode: 1,
        phase: 'compile',
        durationMs: lintResult.durationMs,
      };
    }

    return this.runProcess('php', [
      '-d', 'open_basedir=' + projectDir,
      '-d', 'memory_limit=64M',
      '-d', 'max_execution_time=10',
      '-d', 'disable_functions=exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec',
      mainFilePath,
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
      // Remove project dir path from javac output so filenames are short
      if (compileResult.stderr) {
        compileResult.stderr = stripTempPath(compileResult.stderr, projectDir);
      }
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
        return this.executeJS(code);
      case 'typescript':
        return this.executeTS(code);
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
    // Large programs cannot be passed via `node -e <code>`: on Linux a single
    // argv entry is capped at 128 KB (MAX_ARG_STRLEN), so anything bigger
    // fails with `spawn E2BIG` before Node even starts. Write the program to a
    // temp file (a .mjs so it's still evaluated as an ES module, matching the
    // previous --input-type=module) and execute the file path instead - the
    // same approach executeJSMulti/PHP/Java/C# already use. tempDir is the only
    // path the permission model allows reading, so --allow-fs-read covers it.
    const tempFile = path.join(
      this.tempDir,
      `js_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`
    );
    try {
      fs.writeFileSync(tempFile, code);
      // SECURITY: Run Node.js with restricted permissions
      // --experimental-permission restricts file system, child process, and workers
      return await this.runProcess('node', [
        '--no-warnings',                          // Suppress ExperimentalWarning noise
        '--experimental-permission',               // Enable permission model
        '--allow-fs-read=' + this.tempDir,        // Only allow reading temp dir
        '--max-old-space-size=128',               // Limit memory
        tempFile
      ]);
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }

  /**
   * TypeScript execution:
   *   1. Transpile TS → JS using the TypeScript compiler API (syntax errors
   *      are caught here and returned with phase:'compile').
   *   2. Run the emitted JavaScript under Node with the same security sandbox
   *      used for plain JavaScript.
   *
   * Semantic / type errors are caught client-side by Monaco's TS language
   * service and block execution before this method is ever called.
   */
  async executeTS(code) {
    const startTime = Date.now();
    const ts = await getTsCompiler();

    let jsCode = code;

    if (ts) {
      // ── Step 1: transpile (catches syntax errors) ────────────────────────
      let transpileResult;
      try {
        transpileResult = ts.transpileModule(code, {
          fileName: 'user.ts',
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            strict: false,
            isolatedModules: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            experimentalDecorators: true,
            sourceMap: false,
            inlineSourceMap: false,
            removeComments: false,
          },
          reportDiagnostics: true,
        });
      } catch (e) {
        return {
          stdout: '',
          stderr: `TypeScript compilation failed: ${e.message}`,
          exitCode: 1,
          phase: 'compile',
          durationMs: Date.now() - startTime,
        };
      }

      if (transpileResult.diagnostics && transpileResult.diagnostics.length > 0) {
        const errors = transpileResult.diagnostics.map(d => {
          const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          if (d.file && d.start !== undefined) {
            const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
            return `user.ts:${line + 1}:${character + 1} - error TS${d.code}: ${msg}`;
          }
          return `error TS${d.code}: ${msg}`;
        });
        return {
          stdout: '',
          stderr: errors.join('\n'),
          exitCode: 1,
          phase: 'compile',
          durationMs: Date.now() - startTime,
        };
      }

      jsCode = transpileResult.outputText;
    }

    // ── Step 2: run transpiled JavaScript ───────────────────────────────────
    const tempFile = path.join(
      this.tempDir,
      `ts_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`
    );
    try {
      fs.writeFileSync(tempFile, jsCode);
      return await this.runProcess('node', [
        '--no-warnings',
        '--experimental-permission',
        '--allow-fs-read=' + this.tempDir,
        '--max-old-space-size=128',
        tempFile,
      ]);
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
  
  /**
   * Run the stdlib-only pre-run checker (languages/python/preflight.py) over
   * the given source. Returns a compile-phase error result when the code has a
   * blocking problem (syntax error or undefined name), or null when the code
   * is clean and should run normally.
   *
   * Fail-open: if the checker is unavailable, errors, or times out, this
   * returns null so valid code is never blocked by a checker hiccup.
   *
   * @param {string} code       user source to scan
   * @param {string} filename   display name used in the error block
   * @returns {Promise<object|null>}
   */
  async preflightPython(code, filename) {
    if (!PYTHON_PREFLIGHT_AVAILABLE) return null;
    const tempFile = path.join(
      this.tempDir,
      `pfck_${Date.now()}_${Math.random().toString(36).slice(2)}.py`
    );
    try {
      fs.writeFileSync(tempFile, code);
      const check = await this.runProcess('python3', [
        '-I', '-S', '-B',
        PYTHON_PREFLIGHT_PATH,
        tempFile,
      ], 8000, {});
      if (!check.stdout) return null;                 // fail-open
      let problems;
      try {
        problems = JSON.parse(check.stdout.trim());
      } catch {
        return null;                                  // fail-open on bad JSON
      }
      if (!Array.isArray(problems) || problems.length === 0) return null;

      // A security problem is a refusal, not a compile error: report it with
      // the same wording and the same `blocked` flag the request-level gate
      // uses, plus the line that caused it.
      const securityProblems = problems.filter((p) => p.kind === 'security');
      if (securityProblems.length > 0) {
        return {
          stdout: '',
          stderr: SECURITY.messages.python + '\n\n'
            + formatPreflightProblems(securityProblems, filename),
          exitCode: 1,
          phase: 'compile',
          blocked: true,
          durationMs: check.durationMs || 0,
        };
      }

      return {
        stdout: '',
        stderr: formatPreflightProblems(problems, filename),
        exitCode: 1,
        phase: 'compile',
        durationMs: check.durationMs || 0,
      };
    } catch {
      return null;                                    // fail-open
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }

  async executePython(code) {
    // Pre-run static check: scan the whole file first and refuse to run
    // anything if it has a syntax error or references an undefined name, so a
    // program never runs half-way and then fails on a broken line.
    const preflight = await this.preflightPython(code, 'user.py');
    if (preflight) return preflight;

    // Inject turtle shim before user code when turtle is imported.
    // The shim runs first, registers sys.modules['turtle'], then the user's
    // `import turtle` resolves from the cache and gets our shim module.
    // Security: the shim code is server-controlled and is NOT passed through
    // validateCodeSecurity; only the user's original code is checked.
    let fullCode = code;
    if (TURTLE_SHIM && hasTurtleImport(code)) {
      fullCode = TURTLE_SHIM + TURTLE_USER_CODE_SEP + code;
    }
    const shimInjected = fullCode !== code;
    // Large programs cannot be passed via `python3 -c <code>`: on Linux a
    // single argv entry is capped at 128 KB (MAX_ARG_STRLEN), so anything
    // bigger fails with `spawn E2BIG`. Write to a temp file and run it - the
    // same file-based approach executePythonMulti/PHP/Java/C# already use.
    const tempFile = path.join(
      this.tempDir,
      `py_${Date.now()}_${Math.random().toString(36).slice(2)}.py`
    );
    try {
      fs.writeFileSync(tempFile, fullCode);
      // SECURITY: Run Python with restricted options
      const result = await this.runProcess('python3', [
        '-u',                 // Unbuffered output
        '-I',                 // Isolated mode: ignore PYTHON* env vars, don't add current directory
        '-S',                 // Don't import site module (reduces available imports)
        '-B',                 // Don't write .pyc bytecode next to the temp file
        tempFile
      ]);
      // Always replace the temp file path for readable error messages.
      if (result.exitCode !== 0 && result.stderr) {
        result.stderr = result.stderr
          .replace(new RegExp(tempFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'user.py')
          .trim();
        // When the turtle shim was prepended, traceback line numbers point at
        // the combined file. Shift them back so they match the user's editor.
        if (shimInjected) {
          result.stderr = adjustTurtleTraceback(result.stderr, turtleShimLineOffset(), 'user.py').trim();
        }
      }
      // Python syntax/indentation errors occur before any code runs (no stdout).
      // Label them as compile-phase so the frontend shows a compile-error header.
      if (result.exitCode !== 0 && result.stderr && !result.stdout) {
        if (/\n(SyntaxError|IndentationError|TabError):/m.test(result.stderr) &&
            !/^Traceback/m.test(result.stderr)) {
          result.phase = 'compile';
        }
      }
      return result;
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
  
  async executePHP(code) {
    // PHP needs to be in a file or passed carefully
    const phpCode = code.startsWith('<?php') ? code : `<?php\n${code}`;
    const tempFile = path.join(this.tempDir, `php_${Date.now()}_${Math.random().toString(36).slice(2)}.php`);
    
    try {
      fs.writeFileSync(tempFile, phpCode);

      // ── Step 1: syntax check (php -l) ──────────────────────────────────────
      const lintResult = await this.runProcess('php', [
        '-d', 'open_basedir=' + this.tempDir,
        '-l',
        tempFile,
      ], 10000, {});

      if (lintResult.exitCode !== 0) {
        const raw = (lintResult.stdout || lintResult.stderr || '').trim();
        const tempName = path.basename(tempFile);
        const cleaned = raw
          .replace(new RegExp(tempFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'user.php')
          .replace(new RegExp(tempName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'user.php')
          .replace(/\nErrors parsing[^\n]*$/m, '')
          .trim();
        return {
          stdout: '',
          stderr: cleaned || raw,
          exitCode: 1,
          phase: 'compile',
          durationMs: lintResult.durationMs,
        };
      }

      // ── Step 2: SECURITY: Run PHP with restrictive configuration ────────────
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
        // Remove temp dir path from javac output so filenames are clean
        if (compileResult.stderr) {
          compileResult.stderr = stripTempPath(compileResult.stderr, this.tempDir);
        }
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
      const result = await this.runProcess('dotnet', [
        'run',
        '-c', 'Release',
        '--no-restore',
        '--nologo',
        '-v', 'q',
        '--project', projectDir,
      ], csTimeout, { cwd: projectDir, csharp: true });

      // Detect C# compile errors: dotnet outputs them to stdout with (line,col) format
      if (result.exitCode !== 0) {
        const combined = (result.stdout || '') + (result.stderr || '');
        if (/\(\d+,\d+\):\s+(?:error|warning)\s+CS\d+/i.test(combined)) {
          result.phase = 'compile';
          result.stderr = cleanCSharpErrors(combined, projectDir);
          result.stdout = '';
        }
      }
      return result;
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
    const result = await this.runProcess('dotnet', [
      'run',
      '-c', 'Release',
      '--nologo',
      '-v', 'q',
      '--project', projectDir,
    ], csTimeout, { cwd: projectDir, csharp: true });

    if (result.exitCode !== 0) {
      const combined = (result.stdout || '') + (result.stderr || '');
      if (/\(\d+,\d+\):\s+(?:error|warning)\s+CS\d+/i.test(combined)) {
        result.phase = 'compile';
        result.stderr = cleanCSharpErrors(combined, projectDir);
        result.stdout = '';
      }
    }
    return result;
  }
  
  /**
   * Build the minimal, sanitized environment used for every sandboxed child
   * process. Extracted so both runProcess() (buffered runs) and the
   * interactive-stdin spawner share the exact same security posture.
   */
  _sandboxEnv(options = {}) {
    // SECURITY: Create a minimal, sanitized environment.
    // In production (Docker/Linux) we lock PATH to the minimal Linux set.
    // In development mode we include the host PATH so tools (node, python,
    // javac, dotnet, …) are discoverable on macOS / Windows dev machines.
    const devPath = CONFIG.isDev ? process.env.PATH || '' : '';
    const prodPath = '/usr/local/bin:/usr/bin:/bin';
    const sanitizedEnv = {
      PATH: devPath ? `${devPath}${process.platform === 'win32' ? ';' : ':'}${prodPath}` : prodPath,
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
      // Java: memory limit for both compiler and runtime. We rely on
      // pattern-based validation instead of Java SecurityManager because the
      // default SecurityManager blocks even System.out.println().
      JAVA_TOOL_OPTIONS: '-Xmx128m',
    };
    return sanitizedEnv;
  }

  runProcess(command, args, timeoutMs = CONFIG.execution.timeoutMs, options = {}) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      const sanitizedEnv = this._sandboxEnv(options);

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
  
  /**
   * Prepare (but do not stream) an interactive run: create the per-session
   * work directory contents, run any synchronous compile/lint step, and return
   * the command/args needed to launch the program with a live stdin pipe.
   *
   * Returns one of:
   *   { compile: {stdout, stderr, exitCode, phase:'compile', durationMs} }
   *       - the program could not even start (syntax/compile/lint error);
   *   { command, args, cwd, stderrTransform? }
   *       - ready to spawn interactively.
   *
   * Handles BOTH single-file (snippet) and multi-file (project/full) runs, and
   * reuses the exact tooling flags of the buffered executeX()/executeXMulti()
   * paths so a program behaves identically whether or not it reads stdin.
   *
   * @param {string} language
   * @param {{code?: string, files?: Array, entryPoint?: string}} payload
   * @param {string} sessionDir
   */
  async prepareInteractiveRun(language, payload, sessionDir) {
    if (payload.files && payload.files.length > 0) {
      return this._prepareInteractiveMulti(language, payload.files, payload.entryPoint, sessionDir);
    }
    return this._prepareInteractiveSingle(language, payload.code, sessionDir);
  }

  async _prepareInteractiveSingle(language, code, sessionDir) {
    switch (language) {
      case 'python': {
        // Same pre-run static check as executePython so a broken program
        // never starts half-way.
        const preflight = await this.preflightPython(code, 'user.py');
        if (preflight) return { compile: preflight };

        let fullCode = code;
        if (TURTLE_SHIM && hasTurtleImport(code)) {
          fullCode = TURTLE_SHIM + TURTLE_USER_CODE_SEP + code;
        }
        const shimInjected = fullCode !== code;
        const tempFile = path.join(sessionDir, 'user.py');
        fs.writeFileSync(tempFile, fullCode);
        const escaped = tempFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          command: 'python3',
          args: ['-u', '-I', '-S', '-B', tempFile],
          cwd: sessionDir,
          stderrTransform: (t) => {
            let out = t.replace(new RegExp(escaped, 'g'), 'user.py');
            if (shimInjected) out = adjustTurtleTraceback(out, turtleShimLineOffset(), 'user.py');
            return out;
          },
        };
      }

      case 'javascript': {
        const tempFile = path.join(sessionDir, 'main.mjs');
        fs.writeFileSync(tempFile, code);
        return {
          command: 'node',
          args: [
            '--no-warnings',
            '--experimental-permission',
            '--allow-fs-read=' + this.tempDir,
            '--max-old-space-size=128',
            tempFile,
          ],
          cwd: sessionDir,
        };
      }

      case 'typescript': {
        const ts = await getTsCompiler();
        let jsCode = code;
        if (ts) {
          let transpileResult;
          try {
            transpileResult = ts.transpileModule(code, {
              fileName: 'user.ts',
              compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
                strict: false,
                isolatedModules: true,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                experimentalDecorators: true,
                sourceMap: false,
                inlineSourceMap: false,
                removeComments: false,
              },
              reportDiagnostics: true,
            });
          } catch (e) {
            return {
              compile: {
                stdout: '',
                stderr: `TypeScript compilation failed: ${e.message}`,
                exitCode: 1,
                phase: 'compile',
                durationMs: 0,
              },
            };
          }
          if (transpileResult.diagnostics && transpileResult.diagnostics.length > 0) {
            const errors = transpileResult.diagnostics.map(d => {
              const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
              if (d.file && d.start !== undefined) {
                const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
                return `user.ts:${line + 1}:${character + 1} - error TS${d.code}: ${msg}`;
              }
              return `error TS${d.code}: ${msg}`;
            });
            return {
              compile: {
                stdout: '',
                stderr: errors.join('\n'),
                exitCode: 1,
                phase: 'compile',
                durationMs: 0,
              },
            };
          }
          jsCode = transpileResult.outputText;
        }
        const tempFile = path.join(sessionDir, 'main.mjs');
        fs.writeFileSync(tempFile, jsCode);
        return {
          command: 'node',
          args: [
            '--no-warnings',
            '--experimental-permission',
            '--allow-fs-read=' + this.tempDir,
            '--max-old-space-size=128',
            tempFile,
          ],
          cwd: sessionDir,
        };
      }

      case 'php': {
        const phpCode = code.startsWith('<?php') ? code : `<?php\n${code}`;
        const tempFile = path.join(sessionDir, 'main.php');
        fs.writeFileSync(tempFile, phpCode);

        // Syntax check first (php -l), same as executePHP.
        const lint = await this.runProcess('php', [
          '-d', 'open_basedir=' + sessionDir,
          '-l',
          tempFile,
        ], 10000, { cwd: sessionDir });
        if (lint.exitCode !== 0) {
          const raw = (lint.stdout || lint.stderr || '').trim();
          const tempName = path.basename(tempFile);
          const cleaned = raw
            .replace(new RegExp(tempFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'user.php')
            .replace(new RegExp(tempName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'user.php')
            .replace(/\nErrors parsing[^\n]*$/m, '')
            .trim();
          return {
            compile: {
              stdout: '',
              stderr: cleaned || raw,
              exitCode: 1,
              phase: 'compile',
              durationMs: lint.durationMs,
            },
          };
        }

        const escaped = tempFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          command: 'php',
          args: [
            '-d', 'open_basedir=' + sessionDir,
            '-d', 'memory_limit=64M',
            // No max_execution_time cap here: an interactive program legitimately
            // blocks on input; the session idle/lifetime timers are the guard.
            '-d', 'disable_functions=exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec,pcntl_fork,curl_exec,curl_multi_exec,fsockopen,pfsockopen,stream_socket_client,mail,dl,putenv,getenv,phpinfo,eval,assert,create_function,file_get_contents,file_put_contents,fopen,fwrite,readfile,unlink,rmdir,mkdir,chmod,chown',
            '-d', 'allow_url_fopen=Off',
            '-d', 'allow_url_include=Off',
            tempFile,
          ],
          cwd: sessionDir,
          stderrTransform: (t) => t.replace(new RegExp(escaped, 'g'), 'user.php'),
        };
      }

      case 'java': {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : 'Main';
        const srcFile = path.join(sessionDir, `${className}.java`);
        fs.writeFileSync(srcFile, code);

        const compile = await this.runProcess('javac', [
          '-J-Xmx128m',
          srcFile,
        ], CONFIG.execution.javaTimeoutMs, { cwd: sessionDir, skipJavaSecurityManager: true });
        if (compile.exitCode !== 0) {
          const stderr = compile.stderr ? stripTempPath(compile.stderr, sessionDir) : compile.stderr;
          return {
            compile: {
              stdout: '',
              stderr,
              exitCode: compile.exitCode,
              phase: 'compile',
              durationMs: compile.durationMs,
            },
          };
        }
        return {
          command: 'java',
          args: [
            '-Xmx128m',
            '-Xms32m',
            '-XX:MaxMetaspaceSize=64m',
            '-cp', sessionDir,
            className,
          ],
          cwd: sessionDir,
        };
      }

      case 'csharp': {
        this.copyCSharpTemplate(sessionDir);
        fs.writeFileSync(path.join(sessionDir, 'Program.cs'), code);
        // Compile errors (if any) surface on stdout when `dotnet run` starts;
        // they will stream to the console like a normal non-zero exit.
        return {
          command: 'dotnet',
          args: [
            'run',
            '-c', 'Release',
            '--no-restore',
            '--nologo',
            '-v', 'q',
            '--project', sessionDir,
          ],
          cwd: sessionDir,
        };
      }

      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }

  /**
   * Multi-file (project/full mode) interactive preparation. Mirrors
   * executeMultiFile()/executeXMulti() exactly, but returns a spawn spec
   * instead of running to completion, so the program can pause for stdin.
   */
  async _prepareInteractiveMulti(language, files, entryPoint, sessionDir) {
    // Write the whole project into the session directory.
    for (const file of files) {
      const filePath = path.join(sessionDir, file.name);
      const fileDir = path.dirname(filePath);
      if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const normalizedEntryPoint = String(entryPoint || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const mainFile =
      (normalizedEntryPoint && files.find(f => f.name === normalizedEntryPoint)) ||
      files.find(f => f.isMain) ||
      files[0];
    if (!mainFile) throw new Error('No entry file was provided for project execution');

    const projectRoot = path.resolve(sessionDir);

    switch (language) {
      case 'javascript': {
        return {
          command: 'node',
          args: [
            '--no-warnings',
            '--experimental-permission',
            '--allow-fs-read=' + sessionDir,
            '--max-old-space-size=128',
            path.join(sessionDir, mainFile.name),
          ],
          cwd: sessionDir,
          stderrTransform: (t) => stripTempPath(t, sessionDir),
        };
      }

      case 'typescript': {
        const ts = await getTsCompiler();
        if (!ts) {
          return {
            command: 'node',
            args: [
              '--no-warnings',
              '--experimental-permission',
              '--allow-fs-read=' + sessionDir,
              '--max-old-space-size=128',
              path.join(sessionDir, mainFile.name),
            ],
            cwd: sessionDir,
            stderrTransform: (t) => stripTempPath(t, sessionDir),
          };
        }

        // Transpile every .ts in the project to a sibling .js (CommonJS).
        const tsFiles = [];
        const walkTs = (dir) => {
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory() && entry.name !== 'node_modules') walkTs(full);
              else if (entry.isFile() && entry.name.endsWith('.ts')) tsFiles.push(full);
            }
          } catch { /* ignore unreadable dirs */ }
        };
        walkTs(sessionDir);

        const compileErrors = [];
        for (const tsFile of tsFiles) {
          const relPath = path.relative(sessionDir, tsFile).replace(/\\/g, '/');
          let src;
          try { src = fs.readFileSync(tsFile, 'utf-8'); } catch { continue; }
          let out;
          try {
            out = ts.transpileModule(src, {
              fileName: relPath,
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                strict: false,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                experimentalDecorators: true,
                sourceMap: false,
              },
              reportDiagnostics: true,
            });
          } catch (e) {
            compileErrors.push(`${relPath}: ${e.message}`);
            continue;
          }
          if (out.diagnostics && out.diagnostics.length > 0) {
            out.diagnostics.forEach(d => {
              const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
              if (d.file && d.start !== undefined) {
                const pos = d.file.getLineAndCharacterOfPosition(d.start);
                compileErrors.push(`${relPath}:${pos.line + 1}:${pos.character + 1} - error TS${d.code}: ${msg}`);
              } else {
                compileErrors.push(`error TS${d.code}: ${msg}`);
              }
            });
          }
          try {
            fs.writeFileSync(tsFile.replace(/\.ts$/, '.js'), out.outputText);
          } catch (e) {
            compileErrors.push(`${relPath}: could not write transpiled output: ${e.message}`);
          }
        }

        if (compileErrors.length > 0) {
          return {
            compile: {
              stdout: '',
              stderr: compileErrors.join('\n'),
              exitCode: 1,
              phase: 'compile',
              durationMs: 0,
            },
          };
        }

        return {
          command: 'node',
          args: [
            '--no-warnings',
            '--experimental-permission',
            '--allow-fs-read=' + sessionDir,
            '--max-old-space-size=128',
            path.join(sessionDir, mainFile.name.replace(/\.ts$/, '.js')),
          ],
          cwd: sessionDir,
          stderrTransform: (t) => stripTempPath(t, sessionDir),
        };
      }

      case 'python': {
        const mainFilePath = path.resolve(sessionDir, mainFile.name);
        if (mainFilePath !== projectRoot && !mainFilePath.startsWith(projectRoot + path.sep)) {
          throw new Error(`Invalid Python entry point: ${mainFile.name}`);
        }
        if (!fs.existsSync(mainFilePath) || !fs.statSync(mainFilePath).isFile()) {
          throw new Error(`Python entry point was not written: ${mainFile.name}`);
        }

        // Pre-run static check on the entry file (before shim injection).
        try {
          const entrySource = fs.readFileSync(mainFilePath, 'utf-8');
          const preflight = await this.preflightPython(entrySource, path.basename(mainFile.name));
          if (preflight) return { compile: preflight };
        } catch { /* non-fatal */ }

        let shimInjected = false;
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
            walk(sessionDir);
            const needsTurtle = pythonFiles.some(filePath => {
              try { return hasTurtleImport(fs.readFileSync(filePath, 'utf-8')); }
              catch { return false; }
            });
            if (needsTurtle) {
              const original = fs.readFileSync(mainFilePath, 'utf-8');
              fs.writeFileSync(mainFilePath, TURTLE_SHIM + TURTLE_USER_CODE_SEP + original);
              shimInjected = true;
            }
          } catch { /* non-fatal */ }
        }

        // Make every workspace folder importable (same ordering as the
        // buffered path) so imports keep working regardless of file moves.
        const importDirs = [];
        const collectImportDirs = dir => {
          importDirs.push(path.resolve(dir));
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name !== '__pycache__') {
              collectImportDirs(path.join(dir, entry.name));
            }
          }
        };
        collectImportDirs(sessionDir);
        const orderedImportDirs = Array.from(new Set([
          path.dirname(mainFilePath),
          projectRoot,
          ...importDirs.sort((a, b) => a.localeCompare(b)),
        ]));

        const bootstrap = [
          'import runpy, sys',
          `sys.path[:0] = ${JSON.stringify(orderedImportDirs)}`,
          `runpy.run_path(${JSON.stringify(mainFilePath)}, run_name="__main__")`,
        ].join('\n');

        const baseName = path.basename(mainFile.name);
        return {
          command: 'python3',
          args: ['-u', '-I', '-S', '-B', '-c', bootstrap],
          cwd: sessionDir,
          stderrTransform: (t) => {
            let out = stripTempPath(t, sessionDir);
            if (shimInjected) out = adjustTurtleTraceback(out, turtleShimLineOffset(), baseName);
            return out;
          },
        };
      }

      case 'php': {
        const mainFilePath = path.join(sessionDir, mainFile.name);
        const lint = await this.runProcess('php', [
          '-d', 'open_basedir=' + sessionDir,
          '-l',
          mainFilePath,
        ], 10000, { cwd: sessionDir });
        if (lint.exitCode !== 0) {
          const raw = (lint.stdout || lint.stderr || '').trim();
          const cleaned = stripTempPath(raw, sessionDir)
            .replace(/\nErrors parsing[^\n]*$/m, '')
            .trim();
          return {
            compile: {
              stdout: '',
              stderr: cleaned || raw,
              exitCode: 1,
              phase: 'compile',
              durationMs: lint.durationMs,
            },
          };
        }
        return {
          command: 'php',
          args: [
            '-d', 'open_basedir=' + sessionDir,
            '-d', 'memory_limit=64M',
            // No max_execution_time: an interactive program legitimately blocks
            // on input; the session idle/lifetime timers are the guard.
            '-d', 'disable_functions=exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec',
            mainFilePath,
          ],
          cwd: sessionDir,
          stderrTransform: (t) => stripTempPath(t, sessionDir),
        };
      }

      case 'java': {
        const javaFiles = files.filter(f => f.name.endsWith('.java'));
        const javaPaths = javaFiles.map(f => path.join(sessionDir, f.name));
        const compile = await this.runProcess('javac', [
          '-J-Xmx128m',
          ...javaPaths,
        ], CONFIG.execution.javaTimeoutMs, { skipJavaSecurityManager: true, cwd: sessionDir });

        if (compile.exitCode !== 0) {
          return {
            compile: {
              stdout: '',
              stderr: compile.stderr ? stripTempPath(compile.stderr, sessionDir) : compile.stderr,
              exitCode: compile.exitCode,
              phase: 'compile',
              durationMs: compile.durationMs,
            },
          };
        }

        const javaMain = files.find(f => f.isMain) || javaFiles[0];
        const className = javaMain.name.replace(/\.java$/, '');
        return {
          command: 'java',
          args: [
            '-Xmx128m',
            '-Xms32m',
            '-XX:MaxMetaspaceSize=64m',
            '-cp', sessionDir,
            className,
          ],
          cwd: sessionDir,
          stderrTransform: (t) => stripTempPath(t, sessionDir),
        };
      }

      case 'csharp': {
        const tplCsproj = path.join(this.csharpTemplateDir, 'UserProgram.csproj');
        if (!fs.existsSync(tplCsproj)) this.initCSharpTemplate();
        if (fs.existsSync(tplCsproj)) {
          fs.copyFileSync(tplCsproj, path.join(sessionDir, 'UserProgram.csproj'));
        }
        return {
          command: 'dotnet',
          args: [
            'run',
            '-c', 'Release',
            '--nologo',
            '-v', 'q',
            '--project', sessionDir,
          ],
          cwd: sessionDir,
          stderrTransform: (t) => stripTempPath(t, sessionDir),
        };
      }

      default:
        throw new Error(`Multi-file not supported for: ${language}`);
    }
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
// SHAREABLE MULTI-FILE WEB PREVIEW STORE
// ============================================
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PREVIEW_MANIFEST_NAME = ".browser-coder-preview.json";
const PREVIEW_TEXT_MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".cjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
]);
const PREVIEW_BINARY_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".avif", "image/avif"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".pdf", "application/pdf"],
]);

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

function previewDirectoryPath(previewId) {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
  return path.join(CONFIG.preview.storageDir, previewId);
}

function previewManifestPath(previewId) {
  const directory = previewDirectoryPath(previewId);
  return directory ? path.join(directory, PREVIEW_MANIFEST_NAME) : null;
}

function legacyPreviewFilePath(previewId) {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
  return path.join(CONFIG.preview.storageDir, `${previewId}.html`);
}

function createPreviewId() {
  // 128 random bits encoded as 22 URL-safe characters.
  return crypto.randomBytes(16).toString("base64url");
}

function normalizePreviewProjectPath(value) {
  if (typeof value !== "string") return null;

  const slashPath = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!slashPath || slashPath.length > CONFIG.preview.maxPathChars) return null;
  if (slashPath.includes("\0")) return null;

  const originalSegments = slashPath.split("/");
  if (originalSegments.some(segment => segment === "..")) return null;

  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../")) return null;
  if (path.posix.isAbsolute(normalized)) return null;

  return normalized;
}

function validatePreviewProject(rawFiles, rawEntryPath) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error("Preview project files are required");
  }

  if (rawFiles.length > CONFIG.preview.maxFileCount) {
    throw new Error(`Preview contains too many files. Maximum is ${CONFIG.preview.maxFileCount}`);
  }

  const filesByPath = new Map();
  let totalBytes = 0;

  for (const rawFile of rawFiles) {
    const filePath = normalizePreviewProjectPath(rawFile?.path);
    if (!filePath) {
      throw new Error(`Invalid preview file path: ${String(rawFile?.path || "")}`);
    }

    if (filesByPath.has(filePath)) {
      throw new Error(`Duplicate preview file path: ${filePath}`);
    }

    const content = typeof rawFile?.content === "string" ? rawFile.content : "";
    totalBytes += Buffer.byteLength(filePath, "utf8");
    totalBytes += Buffer.byteLength(content, "utf8");

    if (totalBytes > CONFIG.preview.maxHtmlBytes) {
      throw new Error(
        `Preview is too large. Maximum project size is ${CONFIG.preview.maxHtmlBytes} bytes`,
      );
    }

    filesByPath.set(filePath, {
      path: filePath,
      content,
      language: typeof rawFile?.language === "string"
        ? rawFile.language.slice(0, 100)
        : undefined,
    });
  }

  const entryPath = normalizePreviewProjectPath(rawEntryPath || "index.html");
  if (!entryPath || !filesByPath.has(entryPath)) {
    throw new Error("The preview entry HTML file was not included in the project");
  }

  if (!/\.html?$/i.test(entryPath)) {
    throw new Error("The preview entry file must be an HTML file");
  }

  return {
    entryPath,
    files: [...filesByPath.values()],
    totalBytes,
  };
}

function safePreviewAssetPath(previewId, requestedPath) {
  const directory = previewDirectoryPath(previewId);
  const normalizedPath = normalizePreviewProjectPath(requestedPath);
  if (!directory || !normalizedPath) return null;

  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(directory, normalizedPath);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) return null;

  return {
    directory,
    normalizedPath,
    filePath: resolvedFile,
  };
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodePreviewProjectPath(filePath) {
  return filePath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function buildPreviewShell(previewId, entryPath) {
  // The shell URL is /preview/:id. Resolving ./<id>/<entry> from that URL
  // preserves any outer mount prefix such as Arc Academy's /coder/.
  const iframeSrc = `./${encodeURIComponent(previewId)}/${encodePreviewProjectPath(entryPath)}`;

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
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"
    referrerpolicy="no-referrer"
    src="${escapeHtmlAttribute(iframeSrc)}"
  ></iframe>
</body>
</html>`;
}

function buildLegacyPreviewShell(html) {
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
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"
    referrerpolicy="no-referrer"
    srcdoc="${escapedHtml}"
  ></iframe>
</body>
</html>`;
}

async function writeImmutablePreviewProject(files, entryPath) {
  ensurePreviewStorageDir();

  for (let attempt = 0; attempt < 5; attempt++) {
    const previewId = createPreviewId();
    const finalDirectory = previewDirectoryPath(previewId);
    const temporaryDirectory = path.join(
      CONFIG.preview.storageDir,
      `.${previewId}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
    );

    try {
      await fs.promises.mkdir(temporaryDirectory, { mode: 0o700 });

      for (const file of files) {
        const destination = path.resolve(temporaryDirectory, file.path);
        const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
        if (!destination.startsWith(`${resolvedTemporaryDirectory}${path.sep}`)) {
          throw new Error(`Unsafe preview file path: ${file.path}`);
        }

        await fs.promises.mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await fs.promises.writeFile(destination, file.content, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }

      const manifest = {
        version: 2,
        entryPath,
        createdAt: Date.now(),
        fileCount: files.length,
      };
      await fs.promises.writeFile(
        path.join(temporaryDirectory, PREVIEW_MANIFEST_NAME),
        JSON.stringify(manifest),
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );

      await fs.promises.rename(temporaryDirectory, finalDirectory);
      return previewId;
    } catch (error) {
      await fs.promises.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      }).catch(() => {});

      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a unique preview ID");
}

async function readPreviewManifest(previewId) {
  const manifestPath = previewManifestPath(previewId);
  if (!manifestPath) return null;

  try {
    const raw = await fs.promises.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    const entryPath = normalizePreviewProjectPath(manifest?.entryPath);
    const createdAt = Number(manifest?.createdAt);

    if (!entryPath || !Number.isFinite(createdAt)) return null;
    return {
      entryPath,
      createdAt,
      fileCount: Number(manifest?.fileCount) || 0,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isPreviewExpired(createdAt) {
  return Date.now() - createdAt > CONFIG.preview.ttlMs;
}

async function removeProjectPreview(previewId) {
  const directory = previewDirectoryPath(previewId);
  if (!directory) return;
  await fs.promises.rm(directory, { recursive: true, force: true });
}

function previewMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return PREVIEW_TEXT_MIME_TYPES.get(ext)
    || PREVIEW_BINARY_MIME_TYPES.get(ext)
    || "application/octet-stream";
}

function setPreviewCommonHeaders(res) {
  res.setHeader("Cache-Control", "public, max-age=300, immutable");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function setPreviewShellHeaders(res) {
  setPreviewCommonHeaders(res);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; child-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors *",
  );
}

function setLegacyPreviewShellHeaders(res) {
  setPreviewCommonHeaders(res);
  // Legacy previews stored only one bundled HTML string and still use srcdoc,
  // so the shell policy must permit the student document inherited by srcdoc.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
      "style-src 'unsafe-inline' data: blob: http: https:",
      "img-src data: blob: http: https:",
      "font-src data: blob: http: https:",
      "media-src data: blob: http: https:",
      "connect-src data: blob: http: https: ws: wss:",
      "worker-src data: blob: http: https:",
      "frame-src 'self' data: blob: http: https:",
      "child-src 'self' data: blob: http: https:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors *",
    ].join("; "),
  );
}

function setPreviewAssetHeaders(res, filePath) {
  setPreviewCommonHeaders(res);
  res.setHeader("Content-Type", previewMimeType(filePath));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (/\.html?$/i.test(filePath)) {
    // Student pages run in an iframe without allow-same-origin, so they receive
    // an opaque origin and cannot read Browser Coder/Arc Academy cookies,
    // storage, or parent DOM. This CSP intentionally permits normal beginner
    // web projects: inline JS/CSS, linked project files, modules, workers,
    // images/fonts/media, and optional CDN/API resources.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
        "style-src 'unsafe-inline' data: blob: http: https:",
        "img-src data: blob: http: https:",
        "font-src data: blob: http: https:",
        "media-src data: blob: http: https:",
        "connect-src data: blob: http: https: ws: wss:",
        "worker-src data: blob: http: https:",
        "frame-src data: blob: http: https:",
        "child-src data: blob: http: https:",
        "manifest-src data: blob: http: https:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors *",
      ].join("; "),
    );
  }
}

async function cleanupExpiredPreviews() {
  ensurePreviewStorageDir();
  const expiresBefore = Date.now() - CONFIG.preview.ttlMs;
  const abandonedTemporaryBefore = Date.now() - 60 * 60 * 1000;

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

  await Promise.allSettled(entries.map(async entry => {
    const itemPath = path.join(CONFIG.preview.storageDir, entry.name);

    if (entry.isFile() && /^[A-Za-z0-9_-]{22}\.html$/.test(entry.name)) {
      const stat = await fs.promises.stat(itemPath);
      if (stat.mtimeMs < expiresBefore) await fs.promises.unlink(itemPath);
      return;
    }

    if (entry.isDirectory() && PREVIEW_ID_PATTERN.test(entry.name)) {
      const manifest = await readPreviewManifest(entry.name).catch(() => null);
      const createdAt = manifest?.createdAt
        || (await fs.promises.stat(itemPath)).mtimeMs;
      if (createdAt < expiresBefore) {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      }
      return;
    }

    if (entry.isDirectory() && /^\.[A-Za-z0-9_-]{22}\..+\.tmp$/.test(entry.name)) {
      const stat = await fs.promises.stat(itemPath);
      if (stat.mtimeMs < abandonedTemporaryBefore) {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      }
    }
  }));
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
  express.json({ limit: CONFIG.preview.maxHtmlBytes * 2 + 1024 * 1024 }),
);

// /api/run carries a whole multi-file project as JSON. JSON-encoding the raw
// code inflates its byte size well past CONFIG.execution.maxCodeChars: every
// newline/quote/backslash in the source doubles when escaped, non-ASCII
// comments/strings cost extra UTF-8 bytes, and each file adds JSON wrapper
// overhead ({"name":...,"content":...,"language":...,"isMain":...}). A body
// limit equal to maxCodeChars therefore rejects legitimate projects that are
// well within the app's own size policy (enforced below in POST /api/run)
// before the handler even runs - that's the previous 413. Size the transport
// limit for the actual worst case allowed by that policy instead of copying
// the same number:
//   - content: up to 3x for escaping + multi-byte overhead
//   - per file: path + ~100 bytes of JSON metadata, up to maxProjectFiles files
//   - a few KB slack for language/version/entryPoint and JSON punctuation
const RUN_BODY_LIMIT_BYTES =
  CONFIG.execution.maxCodeChars * 3 +
  CONFIG.execution.maxProjectFiles * (CONFIG.execution.maxPathChars + 100) +
  4096;
app.use("/api/run", express.json({ limit: RUN_BODY_LIMIT_BYTES }));

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
// Publish an immutable, shareable multi-file web preview.
app.post("/api/previews", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).json({
      error: "Preview storage is unavailable. Configure PREVIEW_STORAGE_DIR as a writable persistent volume.",
    });
  }

  const rawEntryPath = typeof req.body?.entryPath === "string"
    ? req.body.entryPath
    : "index.html";

  // Backward compatibility for an older frontend that sent one bundled HTML
  // string. New clients send the entire workspace in files[].
  const rawFiles = Array.isArray(req.body?.files)
    ? req.body.files
    : typeof req.body?.html === "string"
      ? [{ path: rawEntryPath, content: req.body.html, language: "html" }]
      : [];

  let project;
  try {
    project = validatePreviewProject(rawFiles, rawEntryPath);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid preview project",
    });
  }

  try {
    const previewId = await writeImmutablePreviewProject(
      project.files,
      project.entryPath,
    );
    const previewPath = `/preview/${previewId}`;

    return res.status(201).json({
      id: previewId,
      entryPath: project.entryPath,
      fileCount: project.files.length,
      previewPath,
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

// Public shell. Student code is never executed in this top-level document;
// it runs inside the sandboxed iframe loaded from the immutable project files.
app.get("/preview/:previewId", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).type("text/plain").send("Preview storage is unavailable");
  }

  if (!PREVIEW_ID_PATTERN.test(req.params.previewId)) {
    return res.status(404).type("text/plain").send("Preview not found");
  }

  try {
    const manifest = await readPreviewManifest(req.params.previewId);
    if (manifest) {
      if (isPreviewExpired(manifest.createdAt)) {
        await removeProjectPreview(req.params.previewId).catch(() => {});
        return res.status(410).type("text/plain").send("This preview has expired");
      }

      setPreviewShellHeaders(res);
      return res.status(200).type("html").send(
        buildPreviewShell(req.params.previewId, manifest.entryPath),
      );
    }

    // Preserve already-issued one-file preview URLs from the previous format.
    const legacyPath = legacyPreviewFilePath(req.params.previewId);
    if (!legacyPath) {
      return res.status(404).type("text/plain").send("Preview not found");
    }

    const stat = await fs.promises.stat(legacyPath);
    if (Date.now() - stat.mtimeMs > CONFIG.preview.ttlMs) {
      await fs.promises.unlink(legacyPath).catch(() => {});
      return res.status(410).type("text/plain").send("This preview has expired");
    }

    const html = await fs.promises.readFile(legacyPath, "utf8");
    setLegacyPreviewShellHeaders(res);
    return res.status(200).type("html").send(buildLegacyPreviewShell(html));
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

// Serve every immutable workspace file below the preview ID. Relative links
// such as style.css, ./js/app.js and ../images/logo.svg therefore behave like
// they do in a normal website, including navigation between multiple HTML files.
app.get("/preview/:previewId/*", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).type("text/plain").send("Preview storage is unavailable");
  }

  const previewId = req.params.previewId;
  const requestedPath = req.params[0] || "";
  if (!PREVIEW_ID_PATTERN.test(previewId)) {
    return res.status(404).type("text/plain").send("Preview file not found");
  }

  try {
    const manifest = await readPreviewManifest(previewId);
    if (!manifest) {
      return res.status(404).type("text/plain").send("Preview file not found");
    }

    if (isPreviewExpired(manifest.createdAt)) {
      await removeProjectPreview(previewId).catch(() => {});
      return res.status(410).type("text/plain").send("This preview has expired");
    }

    const asset = safePreviewAssetPath(previewId, requestedPath);
    if (!asset || asset.normalizedPath === PREVIEW_MANIFEST_NAME) {
      return res.status(404).type("text/plain").send("Preview file not found");
    }

    const content = await fs.promises.readFile(asset.filePath);
    setPreviewAssetHeaders(res, asset.normalizedPath);
    return res.status(200).send(content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      return res.status(404).type("text/plain").send("Preview file not found");
    }

    log("error", "Failed to load preview file", {
      requestId: req.id,
      previewId,
      requestedPath,
      error: error.message,
    });
    return res.status(500).type("text/plain").send("Could not load preview file");
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

    // Cap file count independently of total byte size: a project can stay
    // under the size limit below while still containing an enormous number
    // of files/directories, which is its own cost (disk I/O, inode churn,
    // JSON parsing overhead) regardless of how small each file is.
    if (normalized.length > CONFIG.execution.maxProjectFiles) {
      return res.status(400).json({
        error: `Too many files (max ${CONFIG.execution.maxProjectFiles})`,
      });
    }

    // Reject path traversal / absolute paths / unreasonably long paths
    for (const f of normalized) {
      if (f.name.includes('..') || f.name.startsWith('/') || f.name.startsWith('\\') || /^[a-zA-Z]:/.test(f.name)) {
        return res.status(400).json({ error: `Invalid file path: ${f.name}` });
      }
      if (f.name.length > CONFIG.execution.maxPathChars) {
        return res.status(400).json({ error: `File path too long: ${f.name}` });
      }
    }

    const totalSize = normalized.reduce((sum, f) => sum + f.content.length, 0);
    if (totalSize > CONFIG.execution.maxCodeChars) {
      return res.status(400).json({
        error: `Total code size too large (max ${CONFIG.execution.maxCodeChars / 1000}KB)`,
      });
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
    if (code.length > CONFIG.execution.maxCodeChars) {
      return res.status(400).json({
        error: `Code too large (max ${CONFIG.execution.maxCodeChars / 1000}KB)`,
      });
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
      blocked: result.blocked === true,
      phase: result.phase || 'run',
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

// ============================================
// INTERACTIVE STDIN RUNS (input() / Scanner / readline / Console.ReadLine)
// ============================================
// A normal /api/run is fire-and-forget: it buffers stdout/stderr and returns a
// single JSON result. That model cannot support a program that PAUSES waiting
// for keyboard input. These endpoints add a live session:
//
//   POST /api/run/interactive            -> STREAMING NDJSON response:
//                                           {"type":"session",...} then
//                                           stdout/stderr/ping/exit lines
//   POST /api/run/interactive/:id/stdin  -> write one line to the program's stdin
//   POST /api/run/interactive/:id/close  -> terminate the program
//
// The output stream is the response body of the SAME request that starts the
// program. An earlier design used a separate GET + EventSource to attach to a
// pre-created session; when that second request failed to arrive (proxy
// buffering, routing, or a dropped connection) the program was already running
// with nobody reading it, so the user saw "connection lost" while the orphaned
// session held its per-IP slot until the idle timeout - quickly exhausting the
// concurrency cap. One request cannot desynchronise from itself.
//
// SECURITY: same code validation + sandbox env as /api/run, PLUS session-only
// guards (idle timeout, absolute lifetime, total + per-IP concurrency caps)
// because a process "waiting for input forever" is a resource-hold DoS vector.
const interactiveSessions = new Map();      // id -> session
const interactiveIpCounts = new Map();      // ip -> active count
const INTERACTIVE_LANGS = ['python', 'javascript', 'typescript', 'php', 'java', 'csharp'];

function interactiveIpOf(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function interactiveSend(session, obj) {
  const res = session.res;
  if (!res || res.writableEnded) return;
  try {
    res.write(JSON.stringify(obj) + '\n');
    // compression() is bypassed for this response via Cache-Control:
    // no-transform, but it still decorates res with flush(); calling it (and
    // the raw socket flush) keeps tiny writes - like a bare "Enter number: "
    // prompt with no trailing newline - from sitting in a buffer.
    if (typeof res.flush === 'function') res.flush();
  } catch { /* client went away */ }
}

function interactiveResetIdle(session) {
  if (session.finished) return;
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    session.idleTimedOut = true;
    try { session.proc.kill('SIGKILL'); } catch {}
  }, CONFIG.execution.interactiveIdleTimeoutMs);
}

// Announce "the program is now waiting for you to type".
//
// Without a pseudo-terminal there is no way to observe a blocked read(2)
// directly, so we infer it: a live process that has gone quiet is either
// waiting on stdin or doing slow work, and in both cases the user may type.
// The delay matters for correctness of what the user SEES - revealing the
// input box before the program has printed its prompt makes the caret appear
// with no context, and anything typed early gets echoed above the prompt.
//
// Two different delays, because the two situations are not the same:
//   - after some output: the prompt (e.g. "Enter number: ") has already been
//     written, so a short pause is enough and feels instant.
//   - before any output: the interpreter may still be starting up (Python
//     cold start, turtle shim), so wait longer before assuming a bare
//     input() with no prompt.
const INTERACTIVE_WAIT_AFTER_OUTPUT_MS = 250;
const INTERACTIVE_WAIT_INITIAL_MS = 1200;

function interactiveArmWaiting(session) {
  if (session.finished) return;
  clearTimeout(session.waitTimer);
  const delay = session.sawOutput
    ? INTERACTIVE_WAIT_AFTER_OUTPUT_MS
    : INTERACTIVE_WAIT_INITIAL_MS;
  session.waitTimer = setTimeout(() => {
    if (session.finished) return;
    interactiveSend(session, { type: 'waiting' });
  }, delay);
}

// Turtle programs print a machine-readable sentinel line to stdout
// (__TURTLE_FILE__:<path> or __TURTLE_COMMANDS__:<base64>). In a buffered run
// parseTurtleOutput() strips it at the end; in a live stream we must strip it
// as it flows past so the user never sees it, while still emitting ordinary
// output immediately - including a prompt like "Enter number: " that has NO
// trailing newline and therefore cannot be line-buffered.
const TURTLE_SENTINEL_PREFIX = '__TURTLE_';

function interactiveFilterTurtle(session, text) {
  session.pending += text;
  let emit = '';

  for (;;) {
    const idx = session.pending.indexOf(TURTLE_SENTINEL_PREFIX);

    if (idx === -1) {
      // No sentinel. Emit everything except a trailing fragment that could
      // still turn into one once the next chunk arrives.
      let hold = 0;
      const max = Math.min(TURTLE_SENTINEL_PREFIX.length - 1, session.pending.length);
      for (let n = max; n > 0; n--) {
        if (TURTLE_SENTINEL_PREFIX.startsWith(session.pending.slice(session.pending.length - n))) {
          hold = n;
          break;
        }
      }
      emit += session.pending.slice(0, session.pending.length - hold);
      session.pending = session.pending.slice(session.pending.length - hold);
      break;
    }

    emit += session.pending.slice(0, idx);
    const rest = session.pending.slice(idx);
    const nl = rest.indexOf('\n');
    if (nl === -1) {
      // Sentinel line is still incomplete - wait for the rest of it.
      session.pending = rest;
      break;
    }
    session.turtleLines.push(rest.slice(0, nl));
    session.pending = rest.slice(nl + 1);
  }

  return emit;
}

function interactiveOnOutput(session, kind, data) {
  if (session.finished) return;
  let text = data.toString();
  if (kind === 'stderr' && session.stderrTransform) {
    try { text = session.stderrTransform(text); } catch {}
  }
  if (kind === 'stdout' && session.language === 'python') {
    text = interactiveFilterTurtle(session, text);
    if (!text) { interactiveResetIdle(session); return; }
  }
  const remaining = CONFIG.execution.maxOutputChars - session.outputLen;
  if (remaining <= 0) return;
  if (text.length > remaining) {
    interactiveSend(session, { type: kind, data: text.slice(0, remaining) });
    session.outputLen += remaining;
    session.truncated = true;
    interactiveSend(session, { type: 'stderr', data: '\n... (output truncated)\n' });
    try { session.proc.kill('SIGKILL'); } catch {}
    return;
  }
  session.outputLen += text.length;
  interactiveSend(session, { type: kind, data: text });
  session.sawOutput = true;
  interactiveResetIdle(session);
  interactiveArmWaiting(session);
}

function interactiveFinish(session, exitCode) {
  if (session.finished) return;
  session.finished = true;
  clearTimeout(session.idleTimer);
  clearTimeout(session.maxTimer);
  clearTimeout(session.waitTimer);
  clearInterval(session.pingTimer);

  // Flush any held-back text that never became a sentinel.
  if (session.pending) {
    const tail = session.pending;
    session.pending = '';
    if (!tail.startsWith(TURTLE_SENTINEL_PREFIX)) {
      interactiveSend(session, { type: 'stdout', data: tail });
    }
  }

  // Decode captured turtle sentinel lines using the shared parser.
  let turtleData = null;
  if (session.turtleLines.length > 0) {
    const probe = { stdout: session.turtleLines.join('\n') + '\n' };
    try {
      parseTurtleOutput(probe);
      turtleData = probe.turtleData || null;
    } catch { /* leave null */ }
  }

  const note = session.idleTimedOut ? 'idle-timeout'
    : session.truncated ? 'output-limit'
    : session.maxedOut ? 'time-limit'
    : null;
  interactiveSend(session, {
    type: 'exit',
    exitCode,
    durationMs: Date.now() - session.startTime,
    note,
    turtleData,
  });
  if (session.res && !session.res.writableEnded) {
    try { session.res.end(); } catch {}
  }
  // Release per-IP slot and wipe the session's working directory.
  const c = interactiveIpCounts.get(session.ip) || 0;
  if (c <= 1) interactiveIpCounts.delete(session.ip);
  else interactiveIpCounts.set(session.ip, c - 1);
  try { fs.rmSync(session.sessionDir, { recursive: true, force: true }); } catch {}
  interactiveSessions.delete(session.id);
}

app.post("/api/run/interactive", async (req, res) => {
  const { language, code, files, entryPoint } = req.body || {};

  if (!language) return res.status(400).json({ error: "Missing language" });
  if (!INTERACTIVE_LANGS.includes(language)) {
    return res.status(400).json({ error: `Unsupported language: ${language}` });
  }

  // ── Validate payload: single-file `code` or multi-file `files[]` ──────────
  // Mirrors POST /api/run exactly so both paths enforce the same policy.
  let payload;
  if (files && Array.isArray(files) && files.length > 0) {
    const normalized = files.map(f => ({
      name: String(f.path || f.name || '').replace(/\\/g, '/').replace(/^\/+/, ''),
      content: typeof f.content === 'string' ? f.content : '',
      language: f.language,
      isMain: !!f.isMain,
    })).filter(f => f.name);

    if (normalized.length === 0) {
      return res.status(400).json({ error: "files[] must contain at least one named file" });
    }
    if (normalized.length > CONFIG.execution.maxProjectFiles) {
      return res.status(400).json({ error: `Too many files (max ${CONFIG.execution.maxProjectFiles})` });
    }
    for (const f of normalized) {
      if (f.name.includes('..') || f.name.startsWith('/') || f.name.startsWith('\\') || /^[a-zA-Z]:/.test(f.name)) {
        return res.status(400).json({ error: `Invalid file path: ${f.name}` });
      }
      if (f.name.length > CONFIG.execution.maxPathChars) {
        return res.status(400).json({ error: `File path too long: ${f.name}` });
      }
    }
    const totalSize = normalized.reduce((sum, f) => sum + f.content.length, 0);
    if (totalSize > CONFIG.execution.maxCodeChars) {
      return res.status(400).json({
        error: `Total code size too large (max ${CONFIG.execution.maxCodeChars / 1000}KB)`,
      });
    }
    // SECURITY: dangerous-pattern check on every file.
    for (const file of normalized) {
      if (!file.content) continue;
      const check = validateCodeSecurity(language, file.content);
      if (!check.safe) {
        log('warn', 'security_block', {
          language, file: file.name, reason: check.reason, matched: check.matched, ip: req.ip,
        });
        return res.status(403).json({ error: `${file.name}: ${check.reason}`, blocked: true });
      }
    }

    const requestedEntryPoint = String(entryPoint || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const selectedMainFile = requestedEntryPoint
      ? normalized.find(f => f.name === requestedEntryPoint)
      : (normalized.find(f => f.isMain) || normalized[0]);
    if (!selectedMainFile) {
      return res.status(400).json({ error: 'No entry file was provided' });
    }
    for (const file of normalized) file.isMain = file.name === selectedMainFile.name;

    payload = { files: normalized, entryPoint: selectedMainFile.name };
  } else if (typeof code === 'string' && code) {
    if (code.length > CONFIG.execution.maxCodeChars) {
      return res.status(400).json({
        error: `Code too large (max ${CONFIG.execution.maxCodeChars / 1000}KB)`,
      });
    }
    // SECURITY: identical dangerous-pattern check as /api/run.
    const security = validateCodeSecurity(language, code);
    if (!security.safe) {
      log('warn', 'security_block', {
        language, reason: security.reason, matched: security.matched, ip: req.ip,
      });
      return res.status(403).json({ error: security.reason, blocked: true });
    }
    payload = { code };
  } else {
    return res.status(400).json({ error: "Missing code or files" });
  }

  // Concurrency guards.
  if (interactiveSessions.size >= CONFIG.execution.maxInteractiveSessions) {
    return res.status(503).json({ error: "Too many interactive sessions - try again shortly", retryAfter: 5 });
  }
  const ip = interactiveIpOf(req);
  const ipCount = interactiveIpCounts.get(ip) || 0;
  if (ipCount >= CONFIG.execution.maxInteractiveSessionsPerIp) {
    return res.status(429).json({ error: "Too many concurrent interactive runs from your connection" });
  }

  const id = crypto.randomBytes(16).toString('hex');
  const sessionDir = path.join(executor.tempDir, `isess_${id}`);
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (err) {
    return res.status(500).json({ error: `Failed to create session: ${err.message}` });
  }

  // Compile / lint synchronously; a compile error never becomes a live session.
  let spec;
  try {
    spec = await executor.prepareInteractiveRun(language, payload, sessionDir);
  } catch (err) {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    log('error', 'interactive_prepare_error', { error: err.message, language });
    return res.status(500).json({ error: err.message });
  }

  if (spec.compile) {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    return res.json({ compile: spec.compile });
  }

  let proc;
  try {
    proc = spawn(spec.command, spec.args, {
      cwd: spec.cwd || sessionDir,
      env: executor._sandboxEnv({}),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      shell: false,
    });
  } catch (err) {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    return res.status(500).json({ error: `Failed to start program: ${err.message}` });
  }

  const session = {
    id, proc, ip, sessionDir, language,
    stderrTransform: spec.stderrTransform || null,
    res,
    finished: false, outputLen: 0, truncated: false,
    idleTimedOut: false, maxedOut: false,
    pending: '', turtleLines: [], sawOutput: false,
    startTime: Date.now(), idleTimer: null, maxTimer: null, pingTimer: null, waitTimer: null,
  };
  interactiveSessions.set(id, session);
  interactiveIpCounts.set(ip, ipCount + 1);

  // Switch this response into a streaming NDJSON body. Everything from here on
  // is written incrementally; no res.json() may be used after this point.
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    // no-transform tells compression() to leave the stream alone, so small
    // writes are not held back waiting for a compression buffer to fill.
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Disable proxy response buffering (nginx) so output reaches the browser
    // the instant the program prints it.
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  interactiveSend(session, { type: 'session', sessionId: id });

  proc.stdout.on('data', (d) => interactiveOnOutput(session, 'stdout', d));
  proc.stderr.on('data', (d) => interactiveOnOutput(session, 'stderr', d));
  proc.on('error', (err) => {
    interactiveSend(session, { type: 'stderr', data: `\n[failed to start: ${err.message}]\n` });
    interactiveFinish(session, -1);
  });
  proc.on('close', (exitCode) => {
    const code = (session.idleTimedOut || session.truncated || session.maxedOut)
      ? -1
      : (exitCode ?? 0);
    interactiveFinish(session, code);
  });

  // The browser holds this connection open while the user thinks about what to
  // type, which can easily exceed a proxy's idle-read timeout (nginx defaults
  // to 60s). A periodic keep-alive line makes the connection provably active.
  session.pingTimer = setInterval(() => {
    interactiveSend(session, { type: 'ping' });
  }, 15000);

  // Client navigated away / closed the tab / aborted the fetch: kill the
  // sandbox so it does not sit waiting for input that will never come.
  //
  // This must listen on the RESPONSE, not the request. For a POST whose body
  // has already been consumed, `req` emits 'close' as soon as the request is
  // complete - long before the client goes away - so using it would either
  // kill the program instantly or (as observed) never fire at the right time.
  // `res` emits 'close' when the response stream is torn down, which is
  // exactly "this client is gone". Sessions that leak here are what exhausts
  // the concurrency cap and produce spurious "too many concurrent runs".
  res.on('close', () => {
    if (!session.finished) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  });

  interactiveResetIdle(session);
  interactiveArmWaiting(session);
  session.maxTimer = setTimeout(() => {
    session.maxedOut = true;
    try { proc.kill('SIGKILL'); } catch {}
  }, CONFIG.execution.interactiveMaxLifetimeMs);
});

app.post("/api/run/interactive/:id/stdin", (req, res) => {
  const session = interactiveSessions.get(req.params.id);
  if (!session || session.finished) {
    return res.status(410).json({ error: "Session is not running" });
  }
  const raw = typeof req.body?.data === 'string' ? req.body.data : '';
  // Cap a single input line; strip embedded newlines so one submit == one line.
  const line = raw.replace(/[\r\n]+/g, ' ').slice(0, 10000);
  try {
    session.proc.stdin.write(line + '\n');
  } catch { /* stdin may have closed as the program exited */ }
  interactiveResetIdle(session);
  // The program is now consuming that line. Re-arm waiting detection so a
  // second prompt ("Enter age: ") reveals the input box again once it appears.
  interactiveArmWaiting(session);
  res.json({ ok: true });
});

app.post("/api/run/interactive/:id/close", (req, res) => {
  const session = interactiveSessions.get(req.params.id);
  if (session && !session.finished) {
    try { session.proc.kill('SIGKILL'); } catch {}
  }
  res.json({ ok: true });
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
