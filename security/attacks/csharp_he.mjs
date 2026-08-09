/** Hebrew explanations keyed by the canonical English fixture name. */
export const csharpExplanations = Object.freeze({
  "C#: Process.Start (shell)": `
      🎯 התקפה: הרצת פקודת Shell ישירה

      איך תוקפים משתמשים בזה:
      Process.Start הוא המקביל של ‎Runtime.exec‎ ב־.NET -
      הוא מפעיל תהליכים מקוריים, כולל shells, עם גישה מלאה
      למערכת ההפעלה של השרת.

      השפעה בעולם האמיתי:
      - יצירת reverse shell ותנועה רוחבית
      - קריאת ‎/etc/passwd‎ ושליפת מפתחות SSH
      - מעבר מאפליקציות Web לתוך רשתות פנימיות
    `,
  "C#: ProcessStartInfo + UseShellExecute": `
      🎯 התקפה: הפעלת Shell דרך ProcessStartInfo

      איך תוקפים משתמשים בזה:
      ProcessStartInfo מאפשר לשלוט בניתוב פלט/קלט, משתני
      סביבה והרשאות. כאשר UseShellExecute=true, ה־Shell של
      מערכת ההפעלה מפרש את מחרוזת הארגומנטים - מה שעלול לאפשר
      command injection.
    `,
  "C#: Process.Start with redirected stdout": `
      🎯 התקפה: הפעלת תהליך ושליפת stdout

      איך תוקפים משתמשים בזה:
      תפיסת stdout מתהליך שהופעל מאפשרת לתוקפים להוציא החוצה
      תוכן של קבצים רגישים, למשל ‎/etc/shadow‎ או ‎/etc/passwd‎,
      או פלט של כלי מערכת כמו id, whoami ו־env.
    `,
  "C#: Thread to bypass scanner": `
      🎯 התקפה: הרצת פקודה בתוך Thread

      איך תוקפים משתמשים בזה:
      עטיפת Process.Start בתוך Thread חדש יכולה לעקוף סורקי
      מחרוזות נאיביים, ולהריץ את הפקודה בצורה אסינכרונית כך
      שהקריאה המקורית חוזרת כ"הצלחה" לפני שהנזק מזוהה.
    `,
  "C#: File.ReadAllText": `
      🎯 התקפה: גניבת קובץ בשורה אחת

      איך תוקפים משתמשים בזה:
      File.ReadAllText היא הדרך הקלאסית לקרוא קובץ רגיש ב־C#.
      ‎/etc/passwd‎, פרטי AWS, קבצי kube ומפתחות פרטיים יכולים
      להיקרא באמצעות קריאה אחת בלבד.
    `,
  "C#: File.WriteAllText backdoor": `
      🎯 התקפה: שתילת Backdoor

      איך תוקפים משתמשים בזה:
      File.WriteAllText משמשת לשתילת web shells, משימות cron
      או קבצי systemd לצורך התמדה במערכת. בשילוב עם Process.Start
      היא יוצרת שרשרת RCE מלאה.
    `,
  "C#: FileStream raw read": `
      🎯 התקפה: גישה נמוכה לקבצים עם FileStream

      איך תוקפים משתמשים בזה:
      FileStream היא מחלקת הבסיס לפעולות קלט/פלט על קבצים ב־.NET.
      תוקפים משתמשים בה לגישה ברמת bytes - שימושי לקריאת סודות
      בינאריים או לכתיבת payloads בנויים במיוחד.
    `,
  "C#: StreamReader on path": `
      🎯 התקפה: גישה לקבצים דרך StreamReader

      איך תוקפים משתמשים בזה:
      StreamReader היא אחת הדרכים הנפוצות ביותר שבה מפתחי C#
      קוראים קבצי טקסט - ולכן גם אחת הדרכים הנפוצות שבה תוקפים
      עושים זאת.
    `,
  "C#: Directory.GetFiles": `
      🎯 התקפה: סריקה רקורסיבית של מערכת הקבצים

      איך תוקפים משתמשים בזה:
      Directory.GetFiles עם AllDirectories סורק את כל מערכת
      הקבצים ומחפש קבצים כמו ‎*.key‎, ‎*.pem‎, id_rsa ועוד.
    `,
  "C#: File.Delete": `
      🎯 התקפה: מחיקת לוגים וטשטוש עקבות

      איך תוקפים משתמשים בזה:
      מחיקת קבצי לוג היא צעד אנטי־פורנזי קלאסי אחרי חדירה.
      File.Delete ו־Directory.Delete הם נקודות הכניסה לכך ב־.NET.
    `,
  "C#: BinaryReader reads bytes": `
      🎯 התקפה: קריאת קבצים בינאריים

      איך תוקפים משתמשים בזה:
      BinaryReader מתאים במיוחד לקבצים שאינם טקסטואליים, כמו
      keystores, מסדי נתונים של סיסמאות וקבצי assembly מקומפלים.
    `,
  "C#: MemoryMappedFile": `
      🎯 התקפה: גישה לקובץ ממופה־זיכרון

      איך תוקפים משתמשים בזה:
      MemoryMappedFile ממפה קובץ ישירות לזיכרון ומאפשר קריאה
      וכתיבה ללא העתקה. משתמשים בזה כדי לעקוף audit hooks
      שנמצאים בשכבות API גבוהות יותר של מערכת הקבצים.
    `,
  "C#: HttpClient exfiltration": `
      🎯 התקפה: הוצאת נתונים דרך HTTP

      איך תוקפים משתמשים בזה:
      HttpClient הוא API ה־HTTP המודרני של .NET. תוקפים שולחים
      נתונים גנובים ב־POST לשרת שבשליטתם, כשהתעבורה נראית כמו
      תעבורה יוצאת רגילה.
    `,
  "C#: WebClient download": `
      🎯 התקפה: הורדת Payload מרוחק

      איך תוקפים משתמשים בזה:
      WebClient.DownloadFile הוא dropper קלאסי לשלב שני. התבנית
      "להוריד ואז להריץ" היא אחת מטכניקות התקנת RAT הנפוצות
      ביותר בעולם האמיתי.
    `,
  "C#: TcpClient reverse shell": `
      🎯 התקפה: Reverse Shell באמצעות TCP גולמי

      איך תוקפים משתמשים בזה:
      TcpClient יוצר חיבור TCP יוצא. בשילוב עם
      Process.Start("/bin/sh") וניתוב streams הוא הופך ל־reverse
      shell מלא.
    `,
  "C#: TcpListener bind shell": `
      🎯 התקפה: Bind Shell Listener

      איך תוקפים משתמשים בזה:
      TcpListener הופך את המחשב שנפרץ לשרת שהתוקף יכול להתחבר
      אליו מאוחר יותר. בדרך כלל משתמשים בזה לצורך התמדה.
    `,
  "C#: Socket primitive": `
      🎯 התקפה: בדיקת פורטים עם Socket גולמי

      איך תוקפים משתמשים בזה:
      Socket הוא הפרימיטיב ברמה הנמוכה ביותר - מושלם לסריקת
      פורטים ברשת הפנימית מתוך אפליקציה שכבר נפרצה.
    `,
  "C#: Dns lookup": `
      🎯 התקפה: איסוף מודיעין DNS / הוצאת מידע דרך DNS

      איך תוקפים משתמשים בזה:
      בקשות DNS מותרות לעיתים גם בסביבות שבהן HTTP חסום, ולכן
      DNS יכול לשמש כערוץ סמוי להוצאת מידע החוצה.
    `,
  "C#: SmtpClient mail relay": `
      🎯 התקפה: הוצאת מידע דרך SMTP

      איך תוקפים משתמשים בזה:
      שליחת דואר דרך שרת SMTP שבשליטת התוקף היא ערוץ סמוי נוסף
      להוצאת מידע, שיכול לעקוף מסנני HTTP יוצאים נפוצים.
    `,
  "C#: Type.GetType + Invoke": `
      🎯 התקפה: הרצת פקודות באמצעות Reflection

      איך תוקפים משתמשים בזה:
      Reflection עוקף ניתוח סטטי: המחלקה Process לא מופיעה
      ישירות בקוד, אלא רק כמחרוזת. משפחות רבות של נוזקות .NET
      משתמשות בדיוק בתבנית הזו כדי להתחמק מאנטי־וירוס.
    `,
  "C#: Activator.CreateInstance": `
      🎯 התקפה: בניית אובייקטים דינמית

      איך תוקפים משתמשים בזה:
      Activator.CreateInstance בונה אובייקטים מתוך Type reference -
      כך תוקפים יכולים ליצור WebClient, Process או כל מחלקה אחרת
      בלי להזכיר אותה ישירות בקוד המקור.
    `,
  "C#: Assembly.Load(byte[])": `
      🎯 התקפה: הזרקת Assembly בזיכרון

      איך תוקפים משתמשים בזה:
      Assembly.Load(byte[]) טוען assembly של .NET מתוך buffer
      גולמי של bytes, בלי לגעת בדיסק. זה בסיס לנוזקות .NET
      fileless ולטכניקת execute-assembly של Cobalt Strike.
    `,
  "C#: Assembly.LoadFrom remote": `
      🎯 התקפה: טעינת Assembly מרוחק

      איך תוקפים משתמשים בזה:
      LoadFrom יכול לטעון assemblies דרך HTTP, להוריד ולהריץ
      קוד .NET שרירותי משרת שבשליטת התוקף.
    `,
  "C#: BindingFlags.NonPublic": `
      🎯 התקפה: Reflection על members פרטיים

      איך תוקפים משתמשים בזה:
      BindingFlags.NonPublic חושף members פרטיים ופנימיים,
      ומאפשר לתוקפים לקרוא APIs שלא נועדו להיות נגישים,
      כולל internals רגישים מבחינת אבטחה.
    `,
  "C#: DynamicMethod IL emission": `
      🎯 התקפה: יצירת IL בזמן ריצה

      איך תוקפים משתמשים בזה:
      Reflection.Emit / ILGenerator בונים bytecode מסוג CIL
      בזמן ריצה - המקביל ב־C# לכתיבת payload דרך JIT, וזה
      מנגנון נפוץ שבו obfuscators מסתירים payloads.
    `,
  "C#: AppDomain access": `
      🎯 התקפה: מיפוי AppDomain

      איך תוקפים משתמשים בזה:
      AppDomain חושף כל assembly שנטען - שלב reconnaissance
      מצוין למציאת types מעניינים שאפשר לתקוף באמצעות Reflection.
    `,
  "C#: CSharpScript.EvaluateAsync": `
      🎯 התקפה: RCE דרך Roslyn Scripting

      איך תוקפים משתמשים בזה:
      Microsoft.CodeAnalysis.CSharp.Scripting מקמפל ומריץ C#
      שרירותי בזמן ריצה. זה ה־eval() של C#, ונתיב ישיר להרצת
      קוד שרירותית.
    `,
  "C#: CSharpCodeProvider.CompileAssemblyFromSource": `
      🎯 התקפה: קומפיילר CodeDom ישן

      איך תוקפים משתמשים בזה:
      ה־pipeline הקלאסי של Microsoft.CSharp + CodeDom מקמפל
      C# מתוך מחרוזת. הוא קדם ל־Roslyn, אבל עדיין נפוץ ב־payloads
      ישנים בסגנון PowerShell.
    `,
  "C#: dynamic + ExpandoObject": `
      🎯 התקפה: Dispatch דינמי דרך DLR

      איך תוקפים משתמשים בזה:
      Dynamic Language Runtime פותר קריאות בזמן ריצה, וכך מקשה
      על כלי ניתוח סטטי שמחפשים קריאות ידועות למתודות מסוכנות.
    `,
  "C#: BinaryFormatter.Deserialize": `
      🎯 התקפה: Deserialization עם BinaryFormatter ‏(RCE)

      איך תוקפים משתמשים בזה:
      BinaryFormatter הוא המקביל של ObjectInputStream ב־Java -
      מקור להמון חולשות RCE. Microsoft סימנה אותו רשמית
      כ"מסוכן", ו־YSoSerial.NET מייצר payloads מוכנים למחלקה הזו.
    `,
  "C#: SoapFormatter.Deserialize": `
      🎯 התקפה: Deserialization של SOAP

      איך תוקפים משתמשים בזה:
      SoapFormatter סובל מאותה בעיית gadget-chain כמו
      BinaryFormatter, ומנוצל באותה שיטה.
    `,
  "C#: ObjectStateFormatter (ViewState)": `
      🎯 התקפה: Deserialization של ASP.NET ViewState

      איך תוקפים משתמשים בזה:
      ObjectStateFormatter מנתח ASP.NET ViewState. כאשר
      machine key דולף או חלש, תוקפים יכולים לבנות payloads
      של ViewState ל־RCE מלא - ראו CVE-2017-9248 ורבים נוספים.
    `,
  "C#: NetDataContractSerializer": `
      🎯 התקפה: Gadget Chain דרך NetDataContractSerializer

      איך תוקפים משתמשים בזה:
      NetDataContractSerializer מטמיע שמות types מלאים בפלט
      שלו ופותר אותם בזמן deserialize, ולכן הוא primitive
      משמעותי ל־RCE.
    `,
  "C#: TypeNameHandling abuse hint": `
      🎯 התקפה: RCE דרך Json.NET TypeNameHandling

      איך תוקפים משתמשים בזה:
      כאשר Json.NET מוגדר עם TypeNameHandling שאינו None,
      מאפיין "$type" בתוך JSON יכול ליצור types שרירותיים -
      שרשרת gadget קלאסית ל־Process או למחלקות מסוכנות אחרות.
      הרבה CVEs אמיתיים, למשל CVE-2019-18935, פגעו בדיוק בתבנית הזו.
    `,
  "C#: unsafe pointer write": `
      🎯 התקפה: מניפולציה של מצביעים עם unsafe

      איך תוקפים משתמשים בזה:
      בלוקים של unsafe מאפשרים ל־C# לעבוד עם מצביעים גולמיים
      כמו ב־C. בשילוב עם stackalloc / fixed זה מאפשר stack
      smashing, ניצול בסגנון ROP וקריאה/כתיבה שרירותית לזיכרון -
      הליבה של binary exploitation.
    `,
  "C#: stackalloc buffer": `
      🎯 התקפה: Buffer Overflow על ה־Stack

      איך תוקפים משתמשים בזה:
      stackalloc מקצה זיכרון על ה־stack בלי בדיקות גבולות.
      כתיבה מעבר לסוף ה־buffer דורסת return addresses -
      stack smashing קלאסי להרצת קוד native.
    `,
  "C#: fixed pointer pinning": `
      🎯 התקפה: Pinning ו־Type Punning

      איך תוקפים משתמשים בזה:
      fixed מקבע זיכרון managed וחושף אותו כמצביע גולמי.
      המרה ל־(long*) היא type punning - דרך לעקוף type safety
      ולבנות payloads בינאריים.
    `,
  "C#: Marshal.AllocHGlobal": `
      🎯 התקפה: טעינת Shellcode ל־Native Heap

      איך תוקפים משתמשים בזה:
      Marshal.AllocHGlobal מקצה זיכרון unmanaged, ו־Marshal.Copy
      מעתיק אליו bytes. שתי שורות נוספות - VirtualProtect
      ו־GetDelegateForFunctionPointer - וכבר אפשר להריץ shellcode
      בתוך תהליך .NET. זה המתכון הקלאסי של execute-shellcode-from-C#.
    `,
  "C#: GCHandle.Alloc Pinned": `
      🎯 התקפה: חשיפת כתובת של Buffer מקובע

      איך תוקפים משתמשים בזה:
      GCHandle.Alloc(Pinned) מונע מה־GC להזיז אובייקט, כך שאפשר
      לקבל מצביע native יציב - תנאי מקדים להעברת buffers ל־P/Invoke
      או ל־shellcode.
    `,
  "C#: Marshal.GetDelegateForFunctionPointer": `
      🎯 התקפה: השתלטות דרך Function Pointer

      איך תוקפים משתמשים בזה:
      GetDelegateForFunctionPointer הופך כל IntPtr ל־delegate
      שניתן לקרוא לו - מכוונים אותו ל־shellcode בזיכרון שהוקצה
      עם AllocHGlobal ומפעילים. הרצת shellcode ישירה ב־.NET טהור.
    `,
  "C#: Span<byte> + stackalloc": `
      🎯 התקפה: Stack Buffer עטוף ב־Span

      איך תוקפים משתמשים בזה:
      Span<byte> מעל stackalloc הוא המקביל המודרני ל־buffer
      של C. הוא נפוץ בקוד עתיר ביצועים - וגם בניצולי memory
      corruption.
    `,
  "C#: Unsafe.As reinterpret cast": `
      🎯 התקפה: Type Punning דרך Unsafe.As

      איך תוקפים משתמשים בזה:
      System.Runtime.CompilerServices.Unsafe.As מפרש reference
      managed כ־type אחר - ועוקף לחלוטין את מערכת הטיפוסים.
    `,
  "C#: DllImport kernel32 LoadLibrary": `
      🎯 התקפה: Win32 LoadLibrary דרך P/Invoke

      איך תוקפים משתמשים בזה:
      DllImport מגדיר binding של P/Invoke ל־API native.
      LoadLibrary טוען DLLs של התוקף לתוך התהליך - הצעד הראשון
      במתקפות DLL hijacking ו־side-loading.
    `,
  "C#: DllImport libc system()": `
      🎯 התקפה: libc system() דרך P/Invoke

      איך תוקפים משתמשים בזה:
      P/Invoke אל libc.system() מריץ פקודות shell בלינוקס.
      זה עוקף בדיקות ברמת .NET להרצת פקודות, כי לא נוגעים בכלל
      ב־Process API מנוהל.
    `,
  "C#: DllImport VirtualAlloc": `
      🎯 התקפה: עמוד RWX עבור Shellcode

      איך תוקפים משתמשים בזה:
      VirtualAlloc עם PAGE_EXECUTE_READWRITE ‏(0x40) יוצר אזור
      זיכרון שניתן להרצה. בשילוב עם WriteProcessMemory ו־CreateThread
      זו שרשרת הזרקת shellcode הקלאסית ב־Windows.
    `,
  "C#: NativeLibrary.Load": `
      🎯 התקפה: טעינת Native Library חוצת־פלטפורמות

      איך תוקפים משתמשים בזה:
      NativeLibrary.Load, שנוסף ב־.NET Core 3, טוען ספרייה native
      לפי path בכל מערכת הפעלה - תחליף מודרני ל־LoadLibrary/dlopen
      דרך P/Invoke.
    `,
  "C#: AssemblyLoadContext load": `
      🎯 התקפה: השתלטות דרך AssemblyLoadContext

      איך תוקפים משתמשים בזה:
      AssemblyLoadContext הוא טוען ה־assemblies המודרני של .NET.
      טעינת DLLs של התוקף לתוך context ברירת המחדל מאפשרת להם
      להחליף types קיימים ולהריץ קוד בשימוש הראשון.
    `,
  "C#: AppDomain.CreateDomain": `
      🎯 התקפה: בריחה מ־Sandbox דרך AppDomain

      איך תוקפים משתמשים בזה:
      יצירת AppDomain חדש ב־.NET Framework הישן עם הרשאות משוחררות
      הייתה טכניקת sandbox escape כבר מהגרסאות הראשונות של .NET.
    `,
  "C#: Environment.Exit DoS": `
      🎯 התקפה: DoS באמצעות סיום תהליך

      איך תוקפים משתמשים בזה:
      Environment.Exit הורג את תהליך השרת מיד, ומפיל את השירות
      עבור כל המשתמשים האחרים - denial of service בשורה אחת.
    `,
  "C#: Environment.GetEnvironmentVariables": `
      🎯 התקפה: גניבת משתני סביבה

      איך תוקפים משתמשים בזה:
      משתני סביבה מכילים לעיתים קרובות סודות כמו
      AWS_SECRET_ACCESS_KEY,‏ DATABASE_URL ו־API tokens. שליפה שלהם
      היא אחד הדברים הראשונים שתוקף אמיתי עושה אחרי גישה ראשונית.
    `,
  "C#: Registry.GetValue": `
      🎯 התקפה: קריאת Windows Registry

      איך תוקפים משתמשים בזה:
      ה־Windows registry מכיל credentials, נתיבי התקנה והגדרות.
      Microsoft.Win32.Registry הוא ה־API הישיר של .NET לקריאה
      וכתיבה שלו.
    `,
  "C#: Environment.SetEnvironmentVariable": `
      🎯 התקפה: השתלטות על PATH

      איך תוקפים משתמשים בזה:
      שינוי PATH גורם להרצות תהליכים בהמשך לבחור בינארי זדוני
      שהתוקף שתל - תבנית privilege escalation קלאסית של
      PATH injection.
    `,
  "C#: Convert.FromBase64String → Assembly.Load": `
      🎯 התקפה: Payload מקודד Base64 בזיכרון

      איך תוקפים משתמשים בזה:
      קידוד assembly זדוני כ־base64 מסתיר אותו מסורקי byte-pattern
      נאיביים. בזמן הריצה הוא מפוענח ונטען עם Assembly.Load מתוך
      הזיכרון - RCE ללא קובץ.
    `,
  "C#: BitConverter / hex decode": `
      🎯 התקפה: עזר ל־Payload מקודד Hex

      איך תוקפים משתמשים בזה:
      BitConverter משולב לעיתים עם Convert.FromHexString כדי
      להבריח bytes של shellcode דרך ערוצים שמקבלים רק מחרוזות,
      כמו logs, query strings ועוד.
    `,
  "C#: Safe print": `
      ✅ בטוח: פלט Console בסיסי

      Hello World קלאסי. זה חייב לרוץ בהצלחה כדי שהתלמידים באמת
      יוכלו להשתמש ב־playground.
    `,
  "C#: Safe math": `
      ✅ בטוח: חישוב חשבוני בסיסי

      מתמטיקה פשוטה ללא תופעות לוואי.
    `,
  "C#: Safe class": `
      ✅ בטוח: OOP - מחלקה + constructor + מתודה

      קוד מונחה־עצמים סטנדרטי בלי APIs מסוכנים.
    `,
  "C#: Safe LINQ": `
      ✅ בטוח: Aggregation עם LINQ

      System.Linq הוא כלי לטרנספורמציה של נתונים בלבד - ללא I/O,
      ללא reflection וללא קוד native.
    `,
  "C#: Safe top-level": `
      ✅ בטוח: Top-Level Statements ב־C# 9

      צורת entry point מודרנית של C# - חייבת להיות נתמכת.
    `,
});
