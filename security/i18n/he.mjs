/**
 * Hebrew translations for Security Reports
 */

export const he = {
  // Report metadata
  lang: 'he',
  dir: 'rtl',
  title: '🔒 דוח אבטחה חינוכי - Browser Coder',
  
  // Hero section
  heroTitle: 'דוח בדיקות אבטחה',
  heroSubtitle: 'ניתוח אבטחה חינוכי',
  heroTagline: 'למד איך האקרים חושבים. כתוב קוד מאובטח.',
  timestamp: 'נוצר',
  
  // Intro section
  introTitle: 'ברוכים הבאים לכיתת ההאקרים',
  introP1: 'זה לא סתם דוח בדיקות — זה <strong>מרכז הלמידה האינטראקטיבי שלך לאבטחה</strong>. כל בדיקה למטה מייצגת <em>טכניקת תקיפה אמיתית</em> שהאקרים משתמשים בה בעולם האמיתי.',
  introP2: '<strong>הרצנו את ההתקפות האלה בבטחה</strong> נגד ה-sandbox שלנו כדי להראות לך בדיוק מה נחסם ולמה. הבנת הדפוסים האלה היא הצעד הראשון להפוך למפתח מודע לאבטחה.',
  introHighlight: '💡 <strong>טיפ מקצועי:</strong> לחץ על כל בדיקה כדי לראות את הקוד הזדוני האמיתי וללמוד איך ההתקפה עובדת. ידע הוא ההגנה הטובה ביותר שלך!',
  
  // Mini cards
  miniCard1Title: 'דפוסי תקיפה אמיתיים',
  miniCard1Text: 'כל בדיקה מבוססת על פרצות אמיתיות שנמצאו במערכות פעילות',
  miniCard2Title: 'סביבת למידה בטוחה',
  miniCard2Text: 'כל ההתקפות מבודדות ב-sandbox שלנו — למד ללא סיכון',
  miniCard3Title: 'ידע מעשי',
  miniCard3Text: 'קח את התובנות האלה כדי לאבטח את היישומים שלך',
  
  // CTA
  ctaText: '🎯 <strong>המשימה שלך:</strong> חקור כל קטגוריה למטה, הבן את וקטורי התקיפה, והשתמש בידע הזה כדי לכתוב קוד מאובטח יותר!',
  
  // Stats
  statPassed: 'עברו',
  statFailed: 'נכשלו',
  statTotal: 'סה״כ',
  statRate: 'אחוז הצלחה',
  statDuration: 'משך',
  
  // Tabs
  tabByLanguage: 'לפי שפה',
  tabByCategory: 'לפי קטגוריה',
  tabAllTests: 'כל הבדיקות',
  
  // Test cards
  testExpected: 'צפוי',
  testBlocked: 'נחסם',
  testExecute: 'הרצה',
  testCorrect: 'נכון',
  testWrong: 'שגוי',
  testLearnAttack: 'למד על התקיפה הזו',
  testViewCode: 'הצג קוד',
  
  // Categories - using snake_case to match attack definitions
  categories: {
    // Common categories
    'command_execution': 'הרצת פקודות',
    'code_execution': 'הרצת קוד',
    'code_injection': 'הזרקת קוד',
    'file_system': 'מערכת קבצים',
    'network': 'רשת',
    'system_access': 'גישת מערכת',
    'safe_code': 'קוד בטוח',
    'encoding_bypass': 'עקיפת קידוד',
    'deserialization': 'דה-סריאליזציה',
    'prototype_pollution': 'זיהום פרוטוטייפ',
    
    // JavaScript specific
    'async_exploits': 'ניצול אסינכרוני',
    'dangerous_modules': 'מודולים מסוכנים',
    'global_access': 'גישה גלובלית',
    'memory_access': 'גישת זיכרון',
    'reflect_proxy': 'Reflect/Proxy',
    'timer_abuse': 'ניצול טיימרים',
    
    // TypeScript specific
    'type_abuse': 'ניצול טיפוסים',
    'decorator_abuse': 'ניצול דקורטורים',
    
    // Python specific
    'introspection': 'אינטרוספקציה',
    'code_manipulation': 'מניפולציית קוד',
    'signal_handling': 'טיפול באותות',
    
    // PHP specific
    'superglobal_access': 'גישה ל-Superglobals',
    
    // Java specific
    'reflection': 'רפלקציה',
    'serialization': 'סריאליזציה',
    'classloader': 'טעינת מחלקות',
    'jndi_injection': 'הזרקת JNDI',
    'script_engine': 'מנוע סקריפטים',
    'native_code': 'קוד נייטיב',
    'unsafe_memory': 'זיכרון לא בטוח',
    'security_bypass': 'עקיפת אבטחה',
  },
  
  // Language tips
  languageTips: {
    javascript: {
      title: 'השתמש בכוחות האלה לטובה',
      tips: [
        {
          title: '🔧 בנה כלי CLI עם child_process',
          content: 'במקום שימוש זדוני, <code>child_process</code> יכול לאוטמט את תהליך הפיתוח שלך! בנה כלי CLI משלך: פעולות git אוטומטיות, מעבדי קבצים, סקריפטי פריסה. <strong>טיפ:</strong> השתמש ב-<code>execSync</code> לפקודות פשוטות, <code>spawn</code> לזרימת פלטים גדולים.',
        },
        {
          title: '🌐 צור שרתי פיתוח חזקים',
          content: 'אותם מודולים של <code>http</code> ו-<code>net</code> שהאקרים מנצלים יכולים לבנות כלי פיתוח מדהימים! צור Mock APIs, שרתי proxy, שרתי WebSocket לאפליקציות בזמן אמת. <strong>הידעת?</strong> אפשר לבנות שרת HTTP מלא ב-5 שורות בלבד!',
        },
        {
          title: '⚡ שלוט ב-eval() בבטחה',
          content: 'בעוד <code>eval()</code> מסוכן עם קלט משתמש, הוא מפעיל כלים מדהימים! בנה מנתחי ביטויים, מחשבוני נוסחאות, או מגרשי קוד דינמיים (כמו האפליקציה הזו!). <strong>דפוס בטוח:</strong> תמיד נקה ולעולם אל תעשה eval לקלט ישירות.',
        },
      ],
      facts: [
        {
          emoji: '⚡',
          title: 'קסם מנוע V8',
          content: 'JavaScript יכול להיות מהיר כמו C++ כאשר הוא מקומפל נכון עם JIT. אותה שפה שרצה בדפדפנים יכולה עכשיו להתחרות בשפות מקומפלות!',
        },
        {
          emoji: '🌍',
          title: 'כוח הפרוטוטייפ',
          content: 'שרשרת הפרוטוטייפ שנחסמת כאן היא איך כל אובייקט JS יורש מתודות. הבנה עמוקה מאפשרת ליצור דפוסי קוד אלגנטיים ויעילים בזיכרון!',
        },
        {
          emoji: '🔮',
          title: 'Proxy & Reflect',
          content: 'ה-APIs ה"מסוכנים" האלה מאפשרים לבנות frameworks ריאקטיביים כמו Vue.js! הם מיירטים את כל פעולות האובייקט - קריאות, כתיבות, קריאות לפונקציות, הכל!',
        },
      ],
      cheatSheet: [
        { bad: 'eval(userInput)', good: 'JSON.parse(userInput)', why: 'ניתוח נתונים בטוח ללא הרצת קוד' },
        { bad: 'innerHTML = userInput', good: 'textContent = userInput', why: 'מונע התקפות XSS במניפולציית DOM' },
        { bad: 'new Function(userCode)', good: 'השתמש ב-iframe או Web Worker מבודד', why: 'בודד הרצת קוד דינמית' },
        { bad: 'document.cookie נגיש', good: 'הגדר דגלי HttpOnly ו-Secure', why: 'הגן על עוגיות מגניבת JS' },
        { bad: 'window.location = userUrl', good: 'אמת URL עם new URL() + רשימה מאושרת', why: 'מנע התקפות הפניה פתוחה' },
        { bad: 'Object.assign(target, userObj)', good: 'בחר מאפיינים ספציפיים בלבד', why: 'חסום זיהום פרוטוטייפ דרך __proto__' },
      ],
      proTips: [
        '<code>Object.freeze()</code> הופך אובייקטים לבלתי ניתנים לשינוי - מעולה להגדרות!',
        '<code>\'use strict\'</code> תופס שגיאות שקטות ומונע דפוסים רעים',
        'השתמש ב-<code>crypto.randomUUID()</code> ולא ב-<code>Math.random()</code> לטוקנים',
        'כותרות CSP הן החבר הכי טוב שלך נגד XSS',
        '<code>Intl.Segmenter</code> מטפל ב-Unicode בבטחה - בלי regex לטקסט משתמש!',
      ],
    },
    typescript: {
      title: 'כוחות העל של TypeScript',
      tips: [
        {
          title: '🛡️ Type Guards כאבטחה',
          content: 'מערכת הטיפוסים של TypeScript יכולה <strong>למנוע סוגים שלמים של באגים</strong> בזמן קומפילציה! צור טיפוסים קפדניים לקלט משתמש, תגובות API, ואימות נתונים. <strong>טיפ:</strong> השתמש ב-discriminated unions ו-<code>never</code> כדי להפוך מצבים לא חוקיים לבלתי ייצוגיים.',
        },
        {
          title: '🏗️ בנה DSL משלך',
          content: 'הטיפוסים המתקדמים של TypeScript מאפשרים ליצור <strong>שפות ספציפיות לתחום</strong> שתופסות שגיאות בזמן קומפילציה! בנה בוני שאילתות SQL בטוחי טיפוס, לקוחות API, או מערכות הגדרות.',
        },
        {
          title: '📦 חבילות npm בטוחות יותר',
          content: 'פרסם חבילות npm עם קבצי <code>.d.ts</code> וצרכנים מקבלים השלמה אוטומטית + בדיקת טיפוסים. <strong>הידעת?</strong> אפשר להשתמש ב-TypeScript לניתוח קבצי JavaScript בלי להמיר אותם!',
        },
      ],
      facts: [
        {
          emoji: '🧠',
          title: 'טיפוסים שלמי טיורינג',
          content: 'מערכת הטיפוסים של TypeScript כל כך חזקה, שאפשר לממש מנתח JSON או אפילו משחקים פשוטים כולם במערכת הטיפוסים!',
        },
        {
          emoji: '🎭',
          title: 'מיתוג טיפוסים',
          content: 'אפשר ליצור טיפוסים "ממותגים" שאי אפשר לבלבל. <code>type USD = number & { __brand: \'USD\' }</code> - עכשיו אי אפשר לחבר בטעות USD ל-EUR!',
        },
      ],
      cheatSheet: [
        { bad: 'any בכל מקום', good: 'unknown + type guards', why: 'מכריח אימות מפורש של נתונים חיצוניים' },
        { bad: 'as Type (הצהרת טיפוס)', good: 'פרדיקטי טיפוס: is Type', why: 'אימות בזמן ריצה, לא רק שקרים בזמן קומפילציה' },
        { bad: 'object as Record<string, any>', good: 'Zod/io-ts לאימות בזמן ריצה', why: 'אימות סכמה בגבולות API' },
        { bad: 'String enums לקלט משתמש', good: 'const assertions + Set.has()', why: 'אימות קלט בטוח טיפוסית' },
        { bad: 'Return Promise<any>', good: 'Return Promise<Result<T, Error>>', why: 'מכריח טיפול בשגיאות בזמן קומפילציה' },
        { bad: 'מצב משותף ניתן לשינוי', good: 'Readonly<T> ומערכים readonly', why: 'אי-שינויות מונעת תופעות לוואי' },
      ],
      proTips: [
        'האופרטור <code>satisfies</code> מאמת בלי להרחיב טיפוסים',
        'טיפוסי template literal יכולים לאמת פורמטי מחרוזת בזמן קומפילציה',
        '<code>NoInfer<T></code> מונע התקפות הסקת טיפוס בגנריקס',
        'השתמש ב-<code>strictNullChecks</code> - זה תופס כל כך הרבה באגים',
        'טיפוסים ממותגים למזהים: <code>type UserId = string & { readonly __brand: unique symbol }</code>',
      ],
    },
    python: {
      title: 'כוחות Python לטובה',
      tips: [
        {
          title: '🤖 אדון האוטומציה',
          content: 'אותם מודולי <code>os</code> ו-<code>subprocess</code> שהאקרים מנצלים יכולים לאוטמט את כל תהליך העבודה שלך! בנה סקריפטי גיבוי, מארגני קבצים, מוניטורי מערכת, צינורות פריסה. <strong>טיפ:</strong> השתמש ב-<code>pathlib</code> במקום <code>os.path</code> לקוד נקי יותר.',
        },
        {
          title: '🕷️ גירוד אתרים למחקר',
          content: '<code>urllib</code> ו-<code>requests</code> יכולים לאסוף נתונים באופן אתי למחקר, מעקב מחירים, או בניית מערכי נתונים. כבד את <code>robots.txt</code>, הוסף השהיות, ותמיד בדוק תנאי שירות!',
        },
        {
          title: '🔬 מתודות קסם דינמיות',
          content: 'ה-<code>__getattr__</code>, <code>__setattr__</code> של Python יכולים לבנות הפשטות מדהימות! צור אובייקטים עם טעינה עצלה, עוטפי API אוטומטיים, או פרוקסי דיבוג. <strong>דוגמה:</strong> Django ORM משתמש באלה כדי להפוך שאילתות מסד נתונים לתחושה של אובייקטי Python.',
        },
      ],
      facts: [
        {
          emoji: '🐍',
          title: 'הכל הוא אובייקט',
          content: 'אפילו פונקציות, מחלקות, ומודולים הם אובייקטים בפייתון. אפשר להוסיף תכונות לפונקציות: <code>my_func.metadata = "value"</code>!',
        },
        {
          emoji: '⚡',
          title: 'ביצועי Comprehension',
          content: 'List comprehensions לא רק יפים יותר - הם מהירים יותר! הם מותאמים ברמת ה-bytecode ומונעים תקורה של קריאות לפונקציות.',
        },
        {
          emoji: '🎪',
          title: 'מטא-מחלקות',
          content: 'מחלקות הן מופעים של מטא-מחלקות. אפשר להתאים אישית איך מחלקות עצמן עובדות! Django, SQLAlchemy, והרבה frameworks משתמשים בזה ליצירת APIs אינטואיטיביים.',
        },
      ],
      cheatSheet: [
        { bad: 'eval(user_input)', good: 'ast.literal_eval(user_input)', why: 'מנתח רק ליטרלים, ללא הרצת קוד' },
        { bad: 'pickle.loads(untrusted_data)', good: 'json.loads() או msgpack', why: 'Pickle יכול להריץ קוד שרירותי!' },
        { bad: 'os.system(f"cmd {user}")', good: 'subprocess.run([cmd, user], shell=False)', why: 'ארגומנטי מערך מונעים הזרקת shell' },
        { bad: 'yaml.load(data)', good: 'yaml.safe_load(data)', why: 'YAML יכול להריץ אובייקטי Python!' },
        { bad: 'open(user_path).read()', good: 'אמת נתיב עם pathlib.resolve()', why: 'מנע מעבר נתיב ../../../etc/passwd' },
        { bad: 'SQL f-strings: f"WHERE id={id}"', good: 'פרמטרי: cursor.execute(sql, (id,))', why: 'מונע התקפות SQL injection' },
      ],
      proTips: [
        'מודול <code>secrets</code> לטוקנים אקראיים קריפטוגרפיים, לא <code>random</code>',
        '<code>hashlib.scrypt()</code> לגיבוב סיסמאות עם מלח',
        'ספריית <code>defusedxml</code> מונעת התקפות XXE בניתוח XML',
        'השתמש ב-<code>bandit</code> לסריקת הקוד שלך לבעיות אבטחה',
        '<code>__slots__</code> מונע התקפות הזרקת תכונות דינמיות',
        'סביבות וירטואליות מבודדות תלויות - השתמש בהן!',
      ],
    },
    php: {
      title: 'כוחות העל המודרניים של PHP',
      tips: [
        {
          title: '🚀 מהפכת PHP 8+',
          content: 'PHP מודרני שונה לחלוטין מ-PHP 4! עם קומפילציית JIT, PHP 8 יכול להיות <strong>מהיר פי 3</strong>. ארגומנטים מכונים, תכונות, ביטויי match - זו שפה אחרת לגמרי עכשיו!',
        },
        {
          title: '🌐 שרתי WebSocket ב-PHP!',
          content: '<strong>רגע מדהים:</strong> PHP לא תוכנן לתהליכים ארוכי טווח, אבל כלים כמו <code>ReactPHP</code> ו-<code>Swoole</code> מאפשרים לבנות שרתי WebSocket אסינכרוניים שמתחרים ב-Node.js! אפשר לטפל ב-100,000+ חיבורים מקבילים מ-PHP.',
        },
        {
          title: '🔐 שיטות עבודה מומלצות לאבטחה',
          content: 'תמיד השתמש ב-<code>password_hash()</code> (לעולם לא MD5!), שאילתות פרמטריות עם PDO, ו-<code>htmlspecialchars()</code> לפלט. ההרגלים הפשוטים האלה מונעים 90% מפרצות PHP!',
        },
      ],
      facts: [
        {
          emoji: '💨',
          title: 'PHP מפעיל 78% מהאינטרנט',
          content: 'WordPress, ויקיפדיה, פייסבוק (במקור), הבאקאנד של Slack - הכל PHP! השפה שאתם אוהבים לשנוא מריצה את רוב האינטרנט.',
        },
        {
          emoji: '🔥',
          title: 'Swoole מול Node.js',
          content: 'בבנצ\'מרקים, PHP עם הרחבת Swoole עולה על Node.js בהרבה תרחישי HTTP. כן, באמת! מהפכת ה-PHP האסינכרונית אמיתית.',
        },
        {
          emoji: '🧬',
          title: 'Traits + מחלקות אנונימיות',
          content: 'PHP יכול לעשות דברים שמרגישים בלתי אפשריים! צור מחלקות תוך כדי תנועה, הרכב התנהגויות עם traits, בנה קסם ברמת framework.',
        },
      ],
      cheatSheet: [
        { bad: 'md5($password)', good: 'password_hash($password, PASSWORD_DEFAULT)', why: 'Bcrypt עם מלח, משדרג אלגוריתם אוטומטית' },
        { bad: 'mysql_query("SELECT * WHERE id=$id")', good: 'הצהרות מוכנות PDO', why: 'mysql_* מיושן וגם פגיע' },
        { bad: 'echo $userInput', good: 'echo htmlspecialchars($input, ENT_QUOTES)', why: 'מונע XSS בהקשר HTML' },
        { bad: 'include($_GET[\'page\'].\'.php\')', good: 'רשימה מאושרת: in_array($page, $allowed)', why: 'LFI/RFI היא פרצת PHP מובילה' },
        { bad: 'unserialize($userInput)', good: 'json_decode($userInput)', why: 'הזרקת אובייקטי PHP הורסת' },
        { bad: 'header("Location: $url")', good: 'אמת עם filter_var($url, FILTER_VALIDATE_URL)', why: 'מניעת הפניה פתוחה' },
      ],
      proTips: [
        '<code>disable_functions</code> ב-php.ini: exec, system, shell_exec, passthru',
        '<code>open_basedir</code> מגביל גישה לקבצים לספריות ספציפיות',
        '<code>random_bytes()</code> לנתונים אקראיים קריפטוגרפיים',
        'השתמש בפונקציות <code>sodium_*</code> להצפנה מודרנית',
        'הגדר <code>session.cookie_httponly = 1</code> להגנה על sessions',
        'פקודת <code>audit</code> של Composer בודקת תלויות פגיעות',
      ],
    },
    java: {
      title: 'הכוחות הנסתרים של Java',
      tips: [
        {
          title: '🪞 רפלקציה לבדיקות',
          content: 'אותה רפלקציה שהאקרים משתמשים לרוע מפעילה frameworks בדיקות מדהימים! JUnit, Mockito, ו-Spring כולם משתמשים ברפלקציה באופן נרחב. <strong>טיפ:</strong> השתמש ב-<code>setAccessible(true)</code> לבדיקת מתודות פרטיות (רק בבדיקות!).',
        },
        {
          title: '🎯 מעבדי הערות',
          content: 'הערות Java + רפלקציה = קסם! בנה הערות <code>@Cached</code>, <code>@Retry</code>, או <code>@Benchmark</code> משלך. Lombok מייצר קוד בזמן קומפילציה באמצעות הטכניקות האלה!',
        },
        {
          title: '📡 בנה RPC משלך',
          content: 'סריאליזציה (כשמשתמשים בה בבטחה!) מאפשרת מחשוב מבוזר. gRPC, Apache Kafka, Hazelcast - כולם משתמשים בסריאליזציה לשליחת אובייקטים ברשתות. <strong>שיטה בטוחה:</strong> השתמש ברשימות מאושרות ולעולם אל תעשה דה-סריאליזציה לנתונים לא מהימנים.',
        },
      ],
      facts: [
        {
          emoji: '☕',
          title: 'שפות JVM',
          content: 'ה-JVM מריץ Kotlin, Scala, Groovy, Clojure, ועוד! למד סביבת ריצה אחת, השתמש בהרבה שפות. אנדרואיד (Kotlin), Spark (Scala), Gradle (Groovy).',
        },
        {
          emoji: '🚀',
          title: 'GraalVM Native Image',
          content: 'קמפל Java לקבצים מקוריים שמתחילים במילישניות! ללא חימום JVM, טביעת רגל זיכרון זעירה - מושלם ל-serverless וכלי CLI.',
        },
        {
          emoji: '🔮',
          title: 'Project Loom',
          content: 'תהליכונים וירטואליים כאן! טפל במיליוני משימות מקבילות עם קוד פשוט כמו תכנות סדרתי. מהפכת ה-async של Java.',
        },
      ],
      cheatSheet: [
        { bad: 'new ObjectInputStream(untrusted)', good: 'JSON/Protobuf, או ObjectInputFilter', why: 'דה-סריאליזציה היא הפגיעות מספר 1 של Java' },
        { bad: 'Runtime.exec(userInput)', good: 'ProcessBuilder עם מערכי ארגומנטים', why: 'מונע התקפות הזרקת shell' },
        { bad: 'SQL: "SELECT * WHERE id=" + id', good: 'PreparedStatement עם פרמטרים', why: 'SQL injection עדיין קורה ב-2025' },
        { bad: 'new File(userPath)', good: 'Paths.get(base).resolve(user).normalize()', why: 'מניעת מעבר נתיב' },
        { bad: 'DocumentBuilder.parse(untrusted)', good: 'השבת ישויות חיצוניות (XXE)', why: 'XXE יכול לקרוא קבצים, לשלוח בקשות' },
        { bad: 'Class.forName(userInput)', good: 'רשימה מאושרת של מחלקות מותרות', why: 'רפלקציה יכולה לעקוף אבטחה' },
      ],
      proTips: [
        'השתמש ב-<code>SecurityManager</code> (מיושן אבל עדיין עובד) או ClassLoader מותאם',
        '<code>java.security.SecureRandom</code> לקריפטו, לא <code>java.util.Random</code>',
        'OWASP Dependency Check סורק ספריות פגיעות',
        'מחלקות <code>sealed</code> (Java 17+) מונעות ירושה לא מורשית',
        'מחלקות <code>record</code> בלתי ניתנות לשינוי כברירת מחדל - השתמש בהן!',
        'JEP 411: הוצאה משימוש של Security Manager - השתמש בקונטיינרים במקום',
      ],
    },
  },

  // Category tips
  categoryTips: {
    command_execution: {
      title: 'מה זה הרצת פקודות?',
      simple: 'דמיין שהמחשב שלך הוא מטבח במסעדה. הרצת פקודות היא כמו שיש לך קו ישיר לשף - אתה יכול להזמין כל דבר. "תכין לי פיצה" ✅ או "תשרוף את המטבח" 🔥 - השף פשוט מציית בעיוורון.',
      example: 'אתה מקליד "notepad.exe" בתיבת הפעלה - זו הרצת פקודות. עכשיו דמיין אתר שנותן לך להקליד כל פקודה ולהריץ אותה על השרת שלהם. זו הסכנה!',
      tips: [
        { title: '🔧 אוטומציית DevOps ותשתית', content: 'הרצת פקודות היא עמוד השדרה של DevOps מודרני! Terraform, Ansible, Chef, Puppet - כולם מריצים פקודות לאספקת שרתים.' },
        { title: '🔄 Git Hooks ו-Pre-commit', content: 'כל פעם שאתה עושה commit, git hooks יכולים להריץ פקודות אוטומטית! בדוק את הקוד שלך, הרץ בדיקות, חפש סודות, פרמט קבצים.' },
        { title: '🐳 תזמור קונטיינרים', content: 'Docker, Kubernetes, docker-compose - כולם מריצים פקודות בסביבות מבודדות. בנה כלי ניהול קונטיינרים משלך!' },
      ],
      facts: [
        { emoji: '🌍', title: 'האינטרנט רץ על Bash', content: 'מעל 70% מהשרתים בעולם מריצים Linux, ורובם מנוהלים דרך פקודות shell.' },
        { emoji: '🚀', title: 'NASA משתמשת בסקריפטי Shell', content: 'הרוברים של מאדים נשלטו חלקית על ידי סקריפטי shell! הרצת פקודות ממש הגיעה לכוכב אחר.' },
        { emoji: '💰', title: 'באג של מיליארד דולר', content: 'פרצת Shellshock (2014) השפיעה על כל shell של Bash מאז 1989. באג בודד איים על כל תשתית האינטרנט.' },
      ],
    },
    file_system: {
      title: 'מה זה גישה למערכת קבצים?',
      simple: 'המחשב שלך הוא כמו ספרייה ענקית. גישה למערכת קבצים היא כמו שיש לך כרטיס ספרייה שמאפשר לך לקרוא כל ספר, לכתוב בכל ספר, או אפילו לשרוף ספרים 🔥. עכשיו דמיין לתת את הכרטיס הזה לזר מהאינטרנט!',
      example: 'אתה מוריד "אפליקציית מחשבון" שבסתר קוראת את קובץ הסיסמאות השמורות של הדפדפן שלך. או טריק באתר שנותן לתוקפים לקרוא /etc/passwd בשרתים.',
      tips: [
        { title: '📊 איסוף וניתוח לוגים', content: 'בנה Splunk משלך! נתח קבצי לוג, חלץ דפוסים, ייצר לוחות מחוונים. כלים כמו Filebeat, Fluentd, Logstash קוראים קבצים בקנה מידה עצום.' },
        { title: '🎨 מחוללי אתרים סטטיים', content: 'Jekyll, Hugo, Gatsby, Next.js - כולם קוראים קבצי markdown ומייצרים אתרים! בנה מנוע בלוג או מחולל תיעוד משלך.' },
        { title: '🔍 כלי שכתוב קוד', content: 'כלים כמו jscodeshift, ast-grep, ו-sed מעבירים אלפי קבצים אוטומטית. לשנות שם לפונקציה ב-500 קבצים? החלפה-חיפוש על סטרואידים!' },
      ],
      facts: [
        { emoji: '🔮', title: 'הכל הוא קובץ', content: 'ב-Unix/Linux, אפילו המקלדת, המסך, והרשת הם "קבצים"! /dev/null, /dev/random, /proc/cpuinfo - ההפשטה של קבצים נמצאת בכל מקום.' },
        { emoji: '⚡', title: 'SSDs שינו הכל', content: 'כונני NVMe SSD מודרניים יכולים לקרוא 7,000MB/שנייה! כל אוסף הסרטים שלך (100GB) נטען ב-14 שניות.' },
        { emoji: '📁', title: 'Git הוא רק קבצים', content: 'כל בקרת הגרסאות של Git היא רק ארגון חכם של קבצים בתיקיית .git. אובייקטים, refs, HEAD - הכל קבצים פשוטים!' },
      ],
    },
    network: {
      title: 'מה זה גישת רשת?',
      simple: 'גישת רשת היא כמו שיש לך טלפון שיכול להתקשר לכל אחד בעולם, לשלוח כל הודעה, ולהתחזות לכל אחד. מעולה לשמירה על קשר, מסוכן אם תוכנה רעה יכולה להתקשר בשמך!',
      example: 'שרת שנפגע מתחיל בסתר לשלוח את מסד נתוני הלקוחות שלך לשרת של תוקף במדינה אחרת, או מצטרף לבוטנט לתקוף אחרים.',
      tips: [
        { title: '🎮 שרתי משחקים מרובי משתתפים', content: 'כל משחק מקוון משתמש ב-sockets! בנה שרת משחק משלך - סנכרון מיקום בזמן אמת, צ\'אט, התאמה. ספריות כמו Socket.io, Netty, Twisted מקלות על זה.' },
        { title: '📡 IoT ואוטומציה ביתית', content: 'מכשירי בית חכם מתקשרים דרך רשתות! בנה מרכז אוטומציה ביתית משלך, שלוט באורות, תרמוסטטים, מצלמות. פרוטוקול MQTT מפעיל מיליוני מכשירי IoT.' },
        { title: '🔄 שיתוף פעולה בזמן אמת', content: 'Google Docs, Figma, VS Code Live Share - כולם משתמשים ב-sockets רשת לסנכרון בזמן אמת. בנה כלי שיתופיים שבהם שינויים מופיעים מיד לכל המשתמשים!' },
      ],
      facts: [
        { emoji: '🌊', title: 'כבלים תת-ימיים', content: '99% מהנתונים הבינלאומיים עוברים דרך 380 כבלים תת-מימיים! נשיכת כריש באוקיינוס השקט יכולה להאט את הנטפליקס שלך.' },
        { emoji: '⚡', title: 'מגבלות מהירות האור', content: 'הפינג שלך לשרת במרחק 10,000 ק"מ לעולם לא יכול להיות מתחת ל-33ms - פיזיקה! לכן סוחרי מניות משלמים מיליונים להיות מטרים קרובים יותר לבורסות.' },
        { emoji: '🔢', title: 'פורט 80 הוא היסטורי', content: 'טים ברנרס-לי בחר פורט 80 ל-HTTP באופן קצת אקראי ב-1991. עכשיו מיליארדי בקשות זורמות דרך המספר השרירותי הזה כל שנייה!' },
      ],
    },
    code_injection: {
      title: 'מה זה הזרקת קוד?',
      simple: 'דמיין קוראת בקלפים שקוראת בדיוק מה שאתה כותב על פיסת נייר. אתה כותב "אהיה עשיר" והיא קוראת בקול. אבל טריקאי כותב "...עשיר. גם, תני לי את כל הכסף שלך!" - וקוראת הקלפים קוראת גם את זה!',
      example: 'מחשבון באתר שמשתמש ב-eval("5+5") עובד מעולה. אבל מישהו מכניס "5+5; deleteAllUsers()" וכל מסד הנתונים נמחק!',
      tips: [
        { title: '📚 תיעוד אינטראקטיבי', content: 'RunKit, Observable, Jupyter Notebooks - להריץ דוגמאות קוד בתיעוד! בנה מדריכים שבהם קוראים יכולים לשנות ולהריץ קוד מיד.' },
        { title: '🎨 פלטפורמות קידוד יצירתי', content: 'Processing, p5.js, Shadertoy - להריץ קוד משתמש ליצירת אמנות! בנה פלטפורמות לאמנות גנרטיבית, ויזואליזציית מוזיקה, או מיצבים אינטראקטיביים.' },
        { title: '📊 כלי Low-Code/No-Code', content: 'Retool, Zapier, נוסחאות Airtable - לוגיקה עסקית ללא קידוד מסורתי! בנה כלים שנותנים למי שלא מתכנתים ליצור אוטומציה מורכבת בבטחה.' },
      ],
      facts: [
        { emoji: '📜', title: 'SQL Injection בן 25+ שנים', content: 'תועד לראשונה ב-1998, עדיין מספר 3 ב-OWASP Top 10 ב-2024! ידענו את התיקון עשרות שנים, ופריצות עדיין קורות.' },
        { emoji: '🎲', title: 'Bobby Tables', content: 'הקומיקס המפורסם של XKCD על "Robert\'); DROP TABLE Students;--" מבוסס על תקריות אמיתיות. בתי ספר באמת איבדו נתונים להתקפה הזו בדיוק!' },
        { emoji: '🏆', title: 'פרס הבאג הגדול ביותר', content: 'גוגל שילמה $31,337 על באג הזרקת קוד בודד! מציאת הפגיעויות האלה באופן אתי יכולה להיות קריירה.' },
      ],
    },
  },
  
  // Cheat sheet
  cheatSheetTitle: 'דף עזר לאבטחה',
  cheatSheetProTips: 'טיפים מקצועיים לאבטחה',
  
  // Footer
  footerText: 'נוצר על ידי Browser Coder Security Suite',
  footerBack: 'חזרה למעבדה',
};
