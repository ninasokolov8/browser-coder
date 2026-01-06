/**
 * English translations for Security Reports
 */

export const en = {
  // Report metadata
  lang: 'en',
  dir: 'ltr',
  title: '🔒 Security Educational Report - Browser Coder',
  
  // Hero section
  heroTitle: 'Security Test Report',
  heroSubtitle: 'Educational Security Analysis',
  heroTagline: 'Learn how hackers think. Build secure code.',
  timestamp: 'Generated',
  
  // Intro section
  introTitle: 'Welcome to the Hacker\'s Classroom',
  introP1: 'This isn\'t just a test report — it\'s your <strong>interactive security education hub</strong>. Every test below represents a <em>real attack technique</em> that hackers use in the wild.',
  introP2: 'We\'ve <strong>safely executed these attacks</strong> against our sandbox to show you exactly what gets blocked and why. Understanding these patterns is the first step to becoming a security-conscious developer.',
  introHighlight: '💡 <strong>Pro Tip:</strong> Click on any test to see the actual malicious code and learn how the attack works. Knowledge is your best defense!',
  
  // Mini cards
  miniCard1Title: 'Real Attack Patterns',
  miniCard1Text: 'Every test is based on actual vulnerabilities found in production systems',
  miniCard2Title: 'Safe Learning Environment',
  miniCard2Text: 'All attacks are contained in our isolated sandbox — learn without risk',
  miniCard3Title: 'Practical Knowledge',
  miniCard3Text: 'Take these insights to secure your own applications',
  
  // CTA
  ctaText: '🎯 <strong>Your Mission:</strong> Explore each category below, understand the attack vectors, and use this knowledge to write more secure code!',
  
  // Stats
  statPassed: 'Passed',
  statFailed: 'Failed',
  statTotal: 'Total',
  statRate: 'Pass Rate',
  statDuration: 'Duration',
  
  // Tabs
  tabByLanguage: 'By Language',
  tabByCategory: 'By Category',
  tabAllTests: 'All Tests',
  
  // Test cards
  testExpected: 'Expected',
  testBlocked: 'Blocked',
  testExecute: 'Execute',
  testCorrect: 'Correct',
  testWrong: 'Wrong',
  testLearnAttack: 'Learn about this attack',
  testViewCode: 'View Code',
  
  // Categories - using snake_case to match attack definitions
  categories: {
    // Common categories
    'command_execution': 'Command Execution',
    'code_execution': 'Code Execution',
    'code_injection': 'Code Injection',
    'file_system': 'File System',
    'network': 'Network',
    'system_access': 'System Access',
    'safe_code': 'Safe Code',
    'encoding_bypass': 'Encoding Bypass',
    'deserialization': 'Deserialization',
    'prototype_pollution': 'Prototype Pollution',
    
    // JavaScript specific
    'async_exploits': 'Async Exploits',
    'dangerous_modules': 'Dangerous Modules',
    'global_access': 'Global Access',
    'memory_access': 'Memory Access',
    'reflect_proxy': 'Reflect/Proxy',
    'timer_abuse': 'Timer Abuse',
    
    // TypeScript specific
    'type_abuse': 'Type Abuse',
    'decorator_abuse': 'Decorator Abuse',
    
    // Python specific
    'introspection': 'Introspection',
    'code_manipulation': 'Code Manipulation',
    'signal_handling': 'Signal Handling',
    
    // PHP specific
    'superglobal_access': 'Superglobal Access',
    
    // Java specific
    'reflection': 'Reflection',
    'serialization': 'Serialization',
    'classloader': 'Class Loader',
    'jndi_injection': 'JNDI Injection',
    'script_engine': 'Script Engine',
    'native_code': 'Native Code',
    'unsafe_memory': 'Unsafe Memory',
    'security_bypass': 'Security Bypass',
  },
  
  // Language tips (simplified - can be expanded)
  languageTips: {
    javascript: {
      title: 'Use These Powers For Good',
      tips: [
        {
          title: '🔧 Build CLI Tools with child_process',
          content: 'Instead of malicious use, <code>child_process</code> can automate your development workflow! Build your own CLI tools: automated git operations, file processors, deployment scripts. <strong>Pro tip:</strong> Use <code>execSync</code> for simple commands, <code>spawn</code> for streaming large outputs.',
        },
        {
          title: '🌐 Create Powerful Dev Servers',
          content: 'The same <code>http</code> and <code>net</code> modules hackers exploit can build amazing dev tools! Create mock APIs, proxy servers, WebSocket servers for real-time apps. <strong>Did you know?</strong> You can build a full HTTP server in just 5 lines of Node.js code.',
        },
        {
          title: '⚡ Master eval() Safely',
          content: 'While <code>eval()</code> is dangerous with user input, it powers amazing tools! Build expression parsers, formula calculators, or dynamic code playgrounds (like this app!). <strong>Safe pattern:</strong> Always sanitize and never eval user input directly.',
        },
      ],
      facts: [
        {
          emoji: '⚡',
          title: 'V8 Engine Magic',
          content: 'JavaScript can be as fast as C++ when JIT-compiled properly. The same language that runs in browsers can now compete with compiled languages!',
        },
        {
          emoji: '🌍',
          title: 'Prototype Power',
          content: 'The prototype chain you see blocked here is how every JS object inherits methods. Understanding it deeply lets you create elegant, memory-efficient code patterns!',
        },
        {
          emoji: '🔮',
          title: 'Proxy & Reflect',
          content: 'These "dangerous" APIs let you build reactive frameworks like Vue.js! They intercept ALL object operations - reads, writes, function calls, everything!',
        },
      ],
      cheatSheet: [
        { bad: 'eval(userInput)', good: 'JSON.parse(userInput)', why: 'Parse data safely without code execution' },
        { bad: 'innerHTML = userInput', good: 'textContent = userInput', why: 'Prevents XSS attacks in DOM manipulation' },
        { bad: 'new Function(userCode)', good: 'Use a sandboxed iframe or Web Worker', why: 'Isolate dynamic code execution' },
        { bad: 'document.cookie accessible', good: 'Set HttpOnly and Secure flags', why: 'Protect cookies from JS theft' },
        { bad: 'window.location = userUrl', good: 'Validate URL with new URL() + allowlist', why: 'Prevent open redirect attacks' },
        { bad: 'Object.assign(target, userObj)', good: 'Pick specific properties only', why: 'Block prototype pollution via __proto__' },
      ],
      proTips: [
        '<code>Object.freeze()</code> makes objects immutable - great for config!',
        '<code>\'use strict\'</code> catches silent errors and prevents bad patterns',
        'Use <code>crypto.randomUUID()</code> not <code>Math.random()</code> for tokens',
        'CSP headers are your best friend against XSS',
        '<code>Intl.Segmenter</code> handles Unicode safely - no regex for user text!',
      ],
    },
    typescript: {
      title: 'TypeScript Superpowers',
      tips: [
        {
          title: '🛡️ Type Guards as Security',
          content: 'TypeScript\'s type system can <strong>prevent entire classes of bugs</strong> at compile time! Create strict types for user input, API responses, and data validation. <strong>Pro tip:</strong> Use discriminated unions and <code>never</code> to make invalid states unrepresentable.',
        },
        {
          title: '🏗️ Build Your Own DSL',
          content: 'TypeScript\'s advanced types let you create <strong>domain-specific languages</strong> that catch errors at compile time! Build type-safe SQL query builders, API clients, or configuration systems.',
        },
        {
          title: '📦 Safer npm Packages',
          content: 'Publish npm packages with <code>.d.ts</code> files and consumers get autocomplete + type checking. <strong>Did you know?</strong> You can use TypeScript to analyze JavaScript files without converting them!',
        },
      ],
      facts: [
        {
          emoji: '🧠',
          title: 'Turing Complete Types',
          content: 'TypeScript\'s type system is so powerful, you can implement a JSON parser or even simple games entirely within the type system!',
        },
        {
          emoji: '🎭',
          title: 'Type Branding',
          content: 'You can create "branded" types that are impossible to mix up. <code>type USD = number & { __brand: \'USD\' }</code> - Now you can\'t accidentally add USD to EUR!',
        },
      ],
      cheatSheet: [
        { bad: 'any type everywhere', good: 'unknown + type guards', why: 'Forces explicit validation of external data' },
        { bad: 'as Type (type assertion)', good: 'Type predicates: is Type', why: 'Runtime validation, not just compile-time lies' },
        { bad: 'object as Record<string, any>', good: 'Zod/io-ts for runtime validation', why: 'Schema validation at API boundaries' },
        { bad: 'String enums for user input', good: 'const assertions + Set.has()', why: 'Type-safe input validation' },
        { bad: 'Return Promise<any>', good: 'Return Promise<Result<T, Error>>', why: 'Force error handling at compile time' },
        { bad: 'Mutable shared state', good: 'Readonly<T> and readonly arrays', why: 'Immutability prevents side effects' },
      ],
      proTips: [
        '<code>satisfies</code> operator validates without widening types',
        'Template literal types can validate string formats at compile time',
        '<code>NoInfer<T></code> prevents type inference attacks in generics',
        'Use <code>strictNullChecks</code> - it catches SO many bugs',
        'Branded types for IDs: <code>type UserId = string & { readonly __brand: unique symbol }</code>',
      ],
    },
    python: {
      title: 'Python Powers For Good',
      tips: [
        {
          title: '🤖 Automation Master',
          content: 'The same <code>os</code> and <code>subprocess</code> modules hackers exploit can automate your entire workflow! Build backup scripts, file organizers, system monitors, deployment pipelines. <strong>Pro tip:</strong> Use <code>pathlib</code> instead of <code>os.path</code> for cleaner code.',
        },
        {
          title: '🕷️ Web Scraping for Research',
          content: '<code>urllib</code> and <code>requests</code> can ethically gather data for research, price monitoring, or building datasets. Respect <code>robots.txt</code>, add delays, and always check terms of service!',
        },
        {
          title: '🔬 Dynamic Magic Methods',
          content: 'Python\'s <code>__getattr__</code>, <code>__setattr__</code> can build amazing abstractions! Create lazy-loading objects, automatic API wrappers, or debugging proxies. <strong>Example:</strong> Django ORM uses these to make database queries feel like Python objects.',
        },
      ],
      facts: [
        {
          emoji: '🐍',
          title: 'Everything is an Object',
          content: 'Even functions, classes, and modules are objects in Python. You can add attributes to functions: <code>my_func.metadata = "value"</code>!',
        },
        {
          emoji: '⚡',
          title: 'Comprehension Performance',
          content: 'List comprehensions aren\'t just prettier - they\'re faster! They\'re optimized at the bytecode level and avoid function call overhead.',
        },
        {
          emoji: '🎪',
          title: 'Metaclasses',
          content: 'Classes are instances of metaclasses. You can customize how classes themselves work! Django, SQLAlchemy, and many frameworks use this to create intuitive APIs.',
        },
      ],
      cheatSheet: [
        { bad: 'eval(user_input)', good: 'ast.literal_eval(user_input)', why: 'Only parses literals, no code execution' },
        { bad: 'pickle.loads(untrusted_data)', good: 'json.loads() or msgpack', why: 'Pickle can execute arbitrary code!' },
        { bad: 'os.system(f"cmd {user}")', good: 'subprocess.run([cmd, user], shell=False)', why: 'Array args prevent shell injection' },
        { bad: 'yaml.load(data)', good: 'yaml.safe_load(data)', why: 'YAML can execute Python objects!' },
        { bad: 'open(user_path).read()', good: 'Validate path with pathlib.resolve()', why: 'Prevent path traversal ../../../etc/passwd' },
        { bad: 'SQL f-strings: f"WHERE id={id}"', good: 'Parameterized: cursor.execute(sql, (id,))', why: 'Prevents SQL injection attacks' },
      ],
      proTips: [
        '<code>secrets</code> module for crypto-safe random tokens, not <code>random</code>',
        '<code>hashlib.scrypt()</code> for password hashing with salt',
        '<code>defusedxml</code> library prevents XXE attacks in XML parsing',
        'Use <code>bandit</code> to scan your code for security issues',
        '<code>__slots__</code> prevents dynamic attribute injection attacks',
        'Virtual environments isolate dependencies - use them!',
      ],
    },
    php: {
      title: 'PHP Modern Superpowers',
      tips: [
        {
          title: '🚀 PHP 8+ Revolution',
          content: 'Modern PHP is nothing like PHP 4! With JIT compilation, PHP 8 can be <strong>3x faster</strong>. Named arguments, attributes, match expressions - it\'s a completely different language now!',
        },
        {
          title: '🌐 WebSocket Servers in PHP!',
          content: '<strong>Holy shit moment:</strong> PHP wasn\'t designed for long-running processes, but tools like <code>ReactPHP</code> and <code>Swoole</code> let you build async WebSocket servers that rival Node.js! You can handle 100,000+ concurrent connections from PHP.',
        },
        {
          title: '🔐 Security Best Practices',
          content: 'Always use <code>password_hash()</code> (never MD5!), parameterized queries with PDO, and <code>htmlspecialchars()</code> for output. These simple habits prevent 90% of PHP vulnerabilities!',
        },
      ],
      facts: [
        {
          emoji: '💨',
          title: 'PHP Powers 78% of the Web',
          content: 'WordPress, Wikipedia, Facebook (originally), Slack\'s backend - all PHP! The language you love to hate runs most of the internet.',
        },
        {
          emoji: '🔥',
          title: 'Swoole vs Node.js',
          content: 'In benchmarks, PHP with Swoole extension outperforms Node.js in many HTTP scenarios. Yes, really! The async PHP revolution is real.',
        },
        {
          emoji: '🧬',
          title: 'Traits + Anonymous Classes',
          content: 'PHP can do things that feel impossible! Create classes on the fly, compose behaviors with traits, build framework-level magic.',
        },
      ],
      cheatSheet: [
        { bad: 'md5($password)', good: 'password_hash($password, PASSWORD_DEFAULT)', why: 'Bcrypt with salt, auto-upgrades algorithm' },
        { bad: 'mysql_query("SELECT * WHERE id=$id")', good: 'PDO prepared statements', why: 'mysql_* is deprecated AND vulnerable' },
        { bad: 'echo $userInput', good: 'echo htmlspecialchars($input, ENT_QUOTES)', why: 'Prevents XSS in HTML context' },
        { bad: 'include($_GET[\'page\'].\'.php\')', good: 'Allowlist: in_array($page, $allowed)', why: 'LFI/RFI is a top PHP vulnerability' },
        { bad: 'unserialize($userInput)', good: 'json_decode($userInput)', why: 'PHP Object Injection is devastating' },
        { bad: 'header("Location: $url")', good: 'Validate with filter_var($url, FILTER_VALIDATE_URL)', why: 'Open redirect prevention' },
      ],
      proTips: [
        '<code>disable_functions</code> in php.ini: exec, system, shell_exec, passthru',
        '<code>open_basedir</code> restricts file access to specific directories',
        '<code>random_bytes()</code> for crypto-safe random data',
        'Use <code>sodium_*</code> functions for modern encryption',
        'Set <code>session.cookie_httponly = 1</code> to protect sessions',
        'Composer <code>audit</code> command checks for vulnerable dependencies',
      ],
    },
    java: {
      title: 'Java Hidden Powers',
      tips: [
        {
          title: '🪞 Reflection for Testing',
          content: 'The same reflection hackers use for evil powers amazing testing frameworks! JUnit, Mockito, and Spring all use reflection extensively. <strong>Pro tip:</strong> Use <code>setAccessible(true)</code> to test private methods (but only in tests!).',
        },
        {
          title: '🎯 Annotation Processors',
          content: 'Java annotations + reflection = magic! Build your own <code>@Cached</code>, <code>@Retry</code>, or <code>@Benchmark</code> annotations. Lombok generates code at compile time using these techniques!',
        },
        {
          title: '📡 Build Your Own RPC',
          content: 'Serialization (when used safely!) enables distributed computing. gRPC, Apache Kafka, Hazelcast - all use serialization to send objects across networks. <strong>Safe practice:</strong> Use allowlists and never deserialize untrusted data.',
        },
      ],
      facts: [
        {
          emoji: '☕',
          title: 'JVM Languages',
          content: 'The JVM runs Kotlin, Scala, Groovy, Clojure, and more! Learn one runtime, use many languages. Android (Kotlin), Spark (Scala), Gradle (Groovy).',
        },
        {
          emoji: '🚀',
          title: 'GraalVM Native Image',
          content: 'Compile Java to native executables that start in milliseconds! No JVM warmup, tiny memory footprint - perfect for serverless and CLI tools.',
        },
        {
          emoji: '🔮',
          title: 'Project Loom',
          content: 'Virtual threads are here! Handle millions of concurrent tasks with code as simple as sequential programming. Java\'s async revolution.',
        },
      ],
      cheatSheet: [
        { bad: 'new ObjectInputStream(untrusted)', good: 'JSON/Protobuf, or ObjectInputFilter', why: 'Deserialization is Java\'s #1 vulnerability' },
        { bad: 'Runtime.exec(userInput)', good: 'ProcessBuilder with argument arrays', why: 'Prevents shell injection attacks' },
        { bad: 'SQL: "SELECT * WHERE id=" + id', good: 'PreparedStatement with parameters', why: 'SQL injection still happens in 2025' },
        { bad: 'new File(userPath)', good: 'Paths.get(base).resolve(user).normalize()', why: 'Path traversal prevention' },
        { bad: 'DocumentBuilder.parse(untrusted)', good: 'Disable external entities (XXE)', why: 'XXE can read files, make requests' },
        { bad: 'Class.forName(userInput)', good: 'Allowlist of permitted classes', why: 'Reflection can bypass security' },
      ],
      proTips: [
        'Use <code>SecurityManager</code> (deprecated but still works) or custom ClassLoader',
        '<code>java.security.SecureRandom</code> for crypto, not <code>java.util.Random</code>',
        'OWASP Dependency Check scans for vulnerable libraries',
        '<code>sealed</code> classes (Java 17+) prevent unauthorized inheritance',
        '<code>record</code> classes are immutable by default - use them!',
        'JEP 411: Security Manager deprecation - use containers instead',
      ],
    },
  },

  // Category tips
  categoryTips: {
    command_execution: {
      title: 'What is Command Execution?',
      simple: 'Imagine your computer is a restaurant kitchen. Command execution is like having a direct line to the chef - you can order ANYTHING. "Make me a pizza" ✅ or "Set the kitchen on fire" 🔥 - the chef just follows orders blindly.',
      example: 'You type "notepad.exe" in Run dialog - that\'s command execution. Now imagine a website letting you type ANY command and running it on their server. That\'s the danger!',
      tips: [
        { title: '🔧 DevOps & Infrastructure Automation', content: 'Command execution is the backbone of modern DevOps! Terraform, Ansible, Chef, Puppet - they all execute commands to provision servers.' },
        { title: '🔄 Git Hooks & Pre-commit', content: 'Every time you commit code, git hooks can run commands automatically! Lint your code, run tests, check for secrets, format files.' },
        { title: '🐳 Container Orchestration', content: 'Docker, Kubernetes, docker-compose - all execute commands in isolated environments. Build your own container management tool!' },
      ],
      facts: [
        { emoji: '🌍', title: 'The Internet Runs on Bash', content: 'Over 70% of servers worldwide run Linux, and most are managed through shell commands.' },
        { emoji: '🚀', title: 'NASA Uses Shell Scripts', content: 'The Mars rovers were partially controlled by shell scripts! Command execution literally reached another planet.' },
        { emoji: '💰', title: '$1 Billion Bug', content: 'The Shellshock vulnerability (2014) affected every Bash shell since 1989. A single bug threatened the entire internet.' },
      ],
    },
    file_system: {
      title: 'What is File System Access?',
      simple: 'Your computer is like a huge library. File system access is having a library card that lets you read ANY book, write in ANY book, or even burn books 🔥. Now imagine giving that card to a stranger from the internet!',
      example: 'You download a "calculator app" that secretly reads your browser\'s saved passwords file. Or a website trick that lets attackers read /etc/passwd on servers.',
      tips: [
        { title: '📊 Log Aggregation & Analysis', content: 'Build your own Splunk! Parse log files, extract patterns, generate dashboards. Tools like Filebeat, Fluentd, Logstash all read files at massive scale.' },
        { title: '🎨 Static Site Generators', content: 'Jekyll, Hugo, Gatsby, Next.js - they all read markdown files and generate websites! Build your own blog engine or documentation generator.' },
        { title: '🔍 Code Refactoring Tools', content: 'Tools like jscodeshift, ast-grep, and sed transform thousands of files automatically. Rename a function across 500 files? Search-replace on steroids!' },
      ],
      facts: [
        { emoji: '🔮', title: 'Everything is a File', content: 'On Unix/Linux, even your keyboard, monitor, and network are "files"! /dev/null, /dev/random, /proc/cpuinfo - the file abstraction is everywhere.' },
        { emoji: '⚡', title: 'SSDs Changed Everything', content: 'Modern NVMe SSDs can read 7,000MB/sec! Your entire movie collection (100GB) loads in 14 seconds.' },
        { emoji: '📁', title: 'Git is Just Files', content: 'The entire Git version control is just clever file organization in .git folder. Objects, refs, HEAD - all plain files!' },
      ],
    },
    network: {
      title: 'What is Network Access?',
      simple: 'Network access is like having a phone that can call ANYONE in the world, send ANY message, and pretend to be ANYONE. Great for staying connected, dangerous if a bad program can make calls on your behalf!',
      example: 'A compromised server starts secretly sending your customer database to an attacker\'s server in another country, or joins a botnet to attack others.',
      tips: [
        { title: '🎮 Multiplayer Game Servers', content: 'Every online game uses sockets! Build your own game server - real-time position sync, chat, matchmaking. Libraries like Socket.io, Netty, Twisted make it easy.' },
        { title: '📡 IoT & Home Automation', content: 'Smart home devices communicate over networks! Build your own home automation hub, control lights, thermostats, cameras. MQTT protocol powers millions of IoT devices.' },
        { title: '🔄 Real-Time Collaboration', content: 'Google Docs, Figma, VS Code Live Share - all use network sockets for real-time sync. Build collaborative tools where changes appear instantly for all users!' },
      ],
      facts: [
        { emoji: '🌊', title: 'Undersea Cables', content: '99% of international data travels through 380 underwater cables! A shark bite in the Pacific could slow down your Netflix.' },
        { emoji: '⚡', title: 'Light-Speed Limits', content: 'Your ping to a server 10,000km away can never be under 33ms - physics! That\'s why stock traders pay millions to be meters closer to exchanges.' },
        { emoji: '🔢', title: 'Port 80 is Historic', content: 'Tim Berners-Lee chose port 80 for HTTP somewhat randomly in 1991. Now billions of requests flow through this arbitrary number every second!' },
      ],
    },
    code_injection: {
      title: 'What is Code Injection?',
      simple: 'Imagine a fortune teller who reads exactly what you write on a piece of paper. You write "I will be rich" and they read it aloud. But a trickster writes "...rich. Also, give me all your money!" - and the fortune teller reads that too!',
      example: 'A website calculator that uses eval("5+5") works great. But someone enters "5+5; deleteAllUsers()" and the whole database is gone!',
      tips: [
        { title: '📚 Interactive Documentation', content: 'RunKit, Observable, Jupyter Notebooks - execute code examples in docs! Build tutorials where readers can modify and run code instantly.' },
        { title: '🎨 Creative Coding Platforms', content: 'Processing, p5.js, Shadertoy - run user code to create art! Build platforms for generative art, music visualization, or interactive installations.' },
        { title: '📊 Low-Code/No-Code Tools', content: 'Retool, Zapier, Airtable formulas - business logic without traditional coding! Build tools that let non-programmers create complex automation safely.' },
      ],
      facts: [
        { emoji: '📜', title: 'SQL Injection is 25+ Years Old', content: 'First documented in 1998, still #3 on OWASP Top 10 in 2024! We\'ve known the fix for decades, yet breaches keep happening.' },
        { emoji: '🎲', title: 'Bobby Tables', content: 'XKCD\'s famous comic about "Robert\'); DROP TABLE Students;--" is based on real incidents. Schools have actually lost data to this exact attack!' },
        { emoji: '🏆', title: 'Biggest Bug Bounty', content: 'Google paid $31,337 for a single code injection bug! Finding these vulnerabilities ethically can be a career.' },
      ],
    },
  },
  
  // Cheat sheet
  cheatSheetTitle: 'Security Cheat Sheet',
  cheatSheetProTips: 'Pro Security Tips',
  
  // Footer
  footerText: 'Generated by Browser Coder Security Suite',
  footerBack: 'Back to Hack Lab',
};
