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
          content: 'Instead of malicious use, <code>child_process</code> can automate your development workflow! Build your own CLI tools: automated git operations, file processors, deployment scripts.',
        },
        {
          title: '🌐 Create Powerful Dev Servers',
          content: 'The same <code>http</code> and <code>net</code> modules hackers exploit can build amazing dev tools! Create mock APIs, proxy servers, WebSocket servers for real-time apps.',
        },
        {
          title: '⚡ Master eval() Safely',
          content: 'While <code>eval()</code> is dangerous with user input, it powers amazing tools! Build expression parsers, formula calculators, or dynamic code playgrounds.',
        },
      ],
      facts: [
        {
          emoji: '⚡',
          title: 'V8 Engine Magic',
          content: 'JavaScript can be as fast as C++ when JIT-compiled properly.',
        },
        {
          emoji: '🌍',
          title: 'Prototype Power',
          content: 'The prototype chain is how every JS object inherits methods.',
        },
        {
          emoji: '🔮',
          title: 'Proxy & Reflect',
          content: 'These APIs let you build reactive frameworks like Vue.js!',
        },
      ],
    },
    typescript: {
      title: 'TypeScript Superpowers',
      tips: [
        {
          title: '🛡️ Type Guards as Security',
          content: 'Type guards validate data at runtime — your first line of defense against malicious input.',
        },
        {
          title: '🏗️ Strict Mode is Your Friend',
          content: 'Enable strict mode to catch potential security issues at compile time.',
        },
      ],
    },
    python: {
      title: 'Python Security Best Practices',
      tips: [
        {
          title: '🔒 Avoid eval() and exec()',
          content: 'Use <code>ast.literal_eval()</code> for safe expression evaluation.',
        },
        {
          title: '📦 Secure Deserialization',
          content: 'Never use <code>pickle</code> with untrusted data. Use JSON instead.',
        },
      ],
    },
    php: {
      title: 'PHP Security Essentials',
      tips: [
        {
          title: '🚫 Disable Dangerous Functions',
          content: 'In php.ini, disable: exec, shell_exec, system, passthru, popen.',
        },
        {
          title: '🔐 Parameterized Queries',
          content: 'Always use PDO with prepared statements to prevent SQL injection.',
        },
      ],
    },
    java: {
      title: 'Java Security Guidelines',
      tips: [
        {
          title: '🛡️ SecurityManager',
          content: 'Use Java\'s SecurityManager to restrict dangerous operations.',
        },
        {
          title: '📝 Input Validation',
          content: 'Validate all input using established libraries like OWASP ESAPI.',
        },
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
