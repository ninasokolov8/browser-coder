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
          content: 'במקום שימוש זדוני, <code>child_process</code> יכול לאוטמט את תהליך הפיתוח שלך! בנה כלי CLI משלך: פעולות git אוטומטיות, מעבדי קבצים, סקריפטי פריסה.',
        },
        {
          title: '🌐 צור שרתי פיתוח חזקים',
          content: 'אותם מודולים של <code>http</code> ו-<code>net</code> שהאקרים מנצלים יכולים לבנות כלי פיתוח מדהימים! צור Mock APIs, שרתי proxy, שרתי WebSocket לאפליקציות בזמן אמת.',
        },
        {
          title: '⚡ שלוט ב-eval() בבטחה',
          content: 'בעוד <code>eval()</code> מסוכן עם קלט משתמש, הוא מפעיל כלים מדהימים! בנה מנתחי ביטויים, מחשבוני נוסחאות, או מגרשי קוד דינמיים.',
        },
      ],
      facts: [
        {
          emoji: '⚡',
          title: 'קסם מנוע V8',
          content: 'JavaScript יכול להיות מהיר כמו C++ כאשר הוא מקומפל נכון עם JIT.',
        },
        {
          emoji: '🌍',
          title: 'כוח הפרוטוטייפ',
          content: 'שרשרת הפרוטוטייפ היא איך כל אובייקט JS יורש מתודות.',
        },
        {
          emoji: '🔮',
          title: 'Proxy & Reflect',
          content: 'ה-APIs האלה מאפשרים לבנות frameworks ריאקטיביים כמו Vue.js!',
        },
      ],
    },
    typescript: {
      title: 'כוחות העל של TypeScript',
      tips: [
        {
          title: '🛡️ Type Guards כאבטחה',
          content: 'Type guards מאמתים נתונים בזמן ריצה — קו ההגנה הראשון שלך נגד קלט זדוני.',
        },
        {
          title: '🏗️ Strict Mode הוא החבר שלך',
          content: 'הפעל strict mode כדי לתפוס בעיות אבטחה פוטנציאליות בזמן קומפילציה.',
        },
      ],
    },
    python: {
      title: 'שיטות אבטחה מומלצות לפייתון',
      tips: [
        {
          title: '🔒 הימנע מ-eval() ו-exec()',
          content: 'השתמש ב-<code>ast.literal_eval()</code> להערכת ביטויים בטוחה.',
        },
        {
          title: '📦 דה-סריאליזציה מאובטחת',
          content: 'לעולם אל תשתמש ב-<code>pickle</code> עם נתונים לא מהימנים. השתמש ב-JSON במקום.',
        },
      ],
    },
    php: {
      title: 'יסודות אבטחה ב-PHP',
      tips: [
        {
          title: '🚫 השבת פונקציות מסוכנות',
          content: 'ב-php.ini, השבת: exec, shell_exec, system, passthru, popen.',
        },
        {
          title: '🔐 שאילתות עם פרמטרים',
          content: 'תמיד השתמש ב-PDO עם prepared statements למניעת SQL injection.',
        },
      ],
    },
    java: {
      title: 'הנחיות אבטחה לג\'אווה',
      tips: [
        {
          title: '🛡️ SecurityManager',
          content: 'השתמש ב-SecurityManager של Java כדי להגביל פעולות מסוכנות.',
        },
        {
          title: '📝 אימות קלט',
          content: 'אמת את כל הקלט באמצעות ספריות מוכרות כמו OWASP ESAPI.',
        },
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
