/**
 * Dangerous-pattern corpus for the pre-execution policy check.
 *
 * MOVED VERBATIM from server.mjs (lines 33-543 of the pre-refactor file) by
 * script, not by retyping. Every regex here decides whether a student's program
 * is allowed to run, so a single transcription slip would silently change which
 * programs are accepted or refused.
 *
 * IMPORTANT - what this is and is not:
 * These patterns are a POLICY signal, not a security boundary. The blueprint is
 * explicit about this (principle 5, "isolation, not regex, is the security
 * boundary"): containment must come from the sandbox. The corpus exists to give
 * a student a fast, readable "this is not allowed here" instead of an obscure
 * runtime failure, and to raise the cost of casual probing. It is not, and
 * cannot be, complete - see V-06, where MSBuild XML passes the C# corpus because
 * the corpus models C# source rather than project files.
 */

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
      //
      // `sys` is absent deliberately: it is permitted, with its dangerous
      // attributes named individually below and enforced precisely by the AST
      // pass in languages/python/preflight.py. Keeping it here would refuse
      // `sys.exit()` before the AST pass ever ran.
      //
      // `base64` and `binascii` are absent: they are pure computation and a real
      // exercise topic. The attack that used to justify blocking them is
      // `exec(base64.b64decode(...))`, and it is `exec` that stops it - blocking
      // the codec as well only cost the curriculum.
      //
      // `platform` and `ast` were removed here and then put back. Neither has a
      // curriculum use, and "harmless" is not the test being applied: a module
      // comes off this list when the course needs it AND containment covers the
      // risk, not merely when the risk looks small.
      /\b(?:import|from)\s+(?:os|subprocess|socket|ssl|select|signal|shutil|pathlib|io|codecs|pickle|cPickle|marshal|ctypes|mmap|resource|pty|tty|termios|fcntl|threading|multiprocessing|asyncio|importlib|builtins|inspect|gc|dis|ast|code|types|platform|tempfile|glob|fnmatch|fileinput|getpass|webbrowser|sqlite3|http|urllib|urllib2|requests|ftplib|smtplib|telnetlib|poplib|imaplib|nntplib|xmlrpc|commands|shelve|dbm|anydbm|whichdb|zipfile|tarfile|gzip|bz2|lzma|runpy|pdb|site|sysconfig|venv|distutils|setuptools|posix|nt|pwd|grp|spwd|crypt|curses|pipes|popen2|_thread|_socket|_posixsubprocess)\b/,
      // sys, restricted rather than refused. Only the attributes that reach the
      // import machinery or the interpreter's stack.
      // Kept in step with _ALLOWED_SYS_ATTRIBUTES in preflight.py: a name that is
      // refused here but allowed there (or the reverse) means the two gates
      // disagree about the same program.
      /\bsys\s*\.\s*(?:modules|path|_getframe|settrace|setprofile|_current_frames|__stdout__|__stderr__|__stdin__|meta_path|path_hooks|path_importer_cache)\b/,
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
      //
      // Plain `open(...)` is NOT refused any more. It is allowed and confined to
      // the run's own workspace directory at runtime by languages/python/
      // fs_guard.py, which is a boundary the regex could never be: the regex
      // cannot tell "data.txt" from "../other-job/main.py" once the path is
      // computed rather than written literally.
      //
      // The routes that do NOT pass through the guarded builtin are still
      // refused, here and by the module list above.
      /\b(?:codecs|io)\s*\.\s*open\s*\(/,
      /\bio\s*\.\s*FileIO\s*\(/,
      /\bos\s*\.\s*(?:open|fdopen|scandir)\s*\(/,
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

export { SECURITY };
export default SECURITY;
