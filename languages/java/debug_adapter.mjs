/**
 * The Java debug adapter.
 *
 * Speaks JDWP to a suspended JVM on one side (see `jdwp.mjs` for the wire format) and
 * this IDE's NDJSON frames on the other - the same `hello` / `breakpoints` / `stopped` /
 * `evaluated` / `terminated` vocabulary Python and JavaScript already use, so the whole
 * client debug surface works for Java without knowing Java exists.
 *
 * ## Why a separate process rather than in-process
 *
 * Python's adapter runs inside the program (bdb is a trace hook) and JavaScript's runs
 * in a worker of the same process (V8's inspector). Java can do neither: the JVM is a
 * different runtime entirely, and JDWP is a socket protocol. So this is a Node process
 * that supervises a JVM.
 *
 * That is safe here for a reason worth stating: the run pipeline kills the whole
 * process GROUP (`process.kill(-pid)` on POSIX, `taskkill /T` on Windows), so a
 * grandchild JVM dies with its supervisor. The objection that ruled out an external
 * supervisor for JavaScript does not apply.
 *
 * ## The ordering
 *
 * The JVM starts with `suspend=y`, before it has loaded a single class, and a
 * breakpoint cannot be set on a class that does not exist. So: ask for CLASS_PREPARE,
 * resume, and arm the real breakpoints when each class arrives. Breakpoints requested
 * before that are remembered and applied on prepare.
 */

import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  EVENT_KIND,
  JdwpConnection,
  SET,
  STEP_DEPTH,
  STEP_SIZE_LINE,
  SUSPEND_POLICY,
  TAG,
} from './jdwp.mjs';

const PORT = Number(process.env.BROWSER_CODER_DEBUG_PORT || 0);
const TOKEN = process.env.BROWSER_CODER_DEBUG_TOKEN || '';
const WORKSPACE = process.env.BROWSER_CODER_WORKSPACE || '';
const MAIN_CLASS = process.env.BROWSER_CODER_JAVA_MAIN || '';
const JAVA_BIN = process.env.BROWSER_CODER_JAVA_BIN || 'java';
const CLASSPATH = process.env.BROWSER_CODER_JAVA_CLASSPATH || '.';

if (!PORT || !TOKEN || !MAIN_CLASS) {
  process.stderr.write('java debug adapter: missing session environment\n');
  process.exit(2);
}

/** Longest rendering of one value, matching the other adapters. */
const MAX_VALUE_CHARS = 200;
const MAX_STACK = 50;

// ── The IDE channel ─────────────────────────────────────────────────────────

const channel = net.connect(PORT, '127.0.0.1');
channel.setNoDelay(true);

let channelBuffer = '';
let channelClosed = false;

function send(frame) {
  if (channelClosed || channel.destroyed) return;
  try {
    channel.write(`${JSON.stringify(frame)}\n`);
  } catch {
    // Losing the debugger must not lose the run.
  }
}

channel.on('error', () => { channelClosed = true; });
channel.on('close', () => { channelClosed = true; });

// ── The JVM ─────────────────────────────────────────────────────────────────

/**
 * A free loopback port for JDWP.
 *
 * Bound and released before the JVM is told to use it. A race is possible in principle
 * and has never been observed; the alternative - letting the JVM pick and parsing its
 * "Listening for transport" line - depends on a message format that is not a contract.
 */
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

const jdwpPort = await freePort();

const jvm = spawn(
  JAVA_BIN,
  [
    // `suspend=y` so nothing runs before breakpoints are armed - the same contract the
    // other two adapters get for free by being inside the program.
    `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:${jdwpPort}`,
    '-Xmx128m',
    '-cp', CLASSPATH,
    MAIN_CLASS,
  ],
  { cwd: WORKSPACE || process.cwd(), stdio: ['inherit', 'pipe', 'pipe'] },
);

// The student's program output is this process's output. The JVM's own "Listening for
// transport" line goes to stdout before anything else and would otherwise appear in
// their console as if their program had printed it.
let seenListening = false;
jvm.stdout.on('data', chunk => {
  let text = String(chunk);
  if (!seenListening) {
    const cleaned = text.replace(/^Listening for transport dt_socket at address: \d+\r?\n/, '');
    if (cleaned !== text) seenListening = true;
    text = cleaned;
  }
  if (text) process.stdout.write(text);
});
jvm.stderr.on('data', chunk => process.stderr.write(chunk));

let exitCode = 0;
jvm.on('exit', code => {
  exitCode = code ?? 0;
  send({ type: 'terminated', exitCode });
  finish();
});

/**
 * End the session, and do not leave a zombie behind.
 *
 * Usually this is reached from the JVM's own `exit` handler, so there is nothing left
 * to wait for. It is also reached when the debugger could not attach at all, and there
 * the JVM is still running: exiting then reparents it to PID 1, which in this image is
 * the server, and a Node process is not an init and does not reap strangers. The
 * production compose sets `pids_limit: 512`, so leaked PIDs eventually stop the
 * container forking anything.
 *
 * So: wait for it, bounded - a JVM that will not die must not hold the job open
 * either, and the container's init (`init: true` in compose) reaps what is left.
 */
function finish() {
  try { connection?.close(); } catch { /* already gone */ }
  if (!channelClosed) {
    channelClosed = true;
    try { channel.end(); } catch { /* already gone */ }
  }

  const leave = () => process.exit(exitCode);

  if (jvm.exitCode !== null || jvm.signalCode !== null) {
    setTimeout(leave, 50);
    return;
  }

  const giveUp = setTimeout(leave, 2000);
  jvm.once('exit', () => {
    clearTimeout(giveUp);
    setTimeout(leave, 50);
  });
  try { jvm.kill(); } catch { /* already gone */ }
}

// ── JDWP state ──────────────────────────────────────────────────────────────

/** Breakpoints the IDE asked for, by source file name, before or after class load. */
let wanted = new Map();
/** Every class we know about: source file name -> {typeId, methods}. */
const classes = new Map();
/** Active breakpoint request ids, so a replacement can clear them. */
let breakpointRequests = [];
/** The thread the program is stopped on, or null. */
let pausedThread = null;
/** The top frame of that thread. Frame ids die the moment the thread resumes. */
let pausedFrame = null;
/** The step request in flight, cleared on the next stop or it fires forever. */
let stepRequest = null;

let connection = null;

/**
 * Resolves when the IDE's first `setBreakpoints` has been applied - or after a wait,
 * so a client that never sends one still gets its program run.
 */
let markBreakpointsReceived = () => {};
const firstBreakpointsCommand = Promise.race([
  new Promise(resolve => { markBreakpointsReceived = resolve; }),
  new Promise(resolve => setTimeout(resolve, 5000)),
]);

/** `Main` -> `Main.java`, and `pkg.Thing$Inner` -> `Thing.java`. */
function sourceNameForSignature(signature) {
  const withoutWrapper = signature.replace(/^L/, '').replace(/;$/, '');
  const simple = withoutWrapper.split('/').pop().split('$')[0];
  return `${simple}.java`;
}

async function methodsOf(typeId) {
  const reply = await connection.command(
    SET.REFERENCE_TYPE,
    5,
    connection.writer().referenceTypeId(typeId).build(),
  );
  if (reply.errorCode !== 0) return [];

  const reader = connection.reader(reply.data);
  const count = reader.int();
  const methods = [];
  for (let index = 0; index < count; index++) {
    methods.push({
      methodId: reader.methodId(),
      name: reader.string(),
      signature: reader.string(),
      modBits: reader.int(),
    });
  }
  return methods;
}

/** `line -> code index` for one method, or an empty map for a native one. */
async function lineTable(typeId, methodId) {
  const reply = await connection.command(
    SET.METHOD,
    1,
    connection.writer().referenceTypeId(typeId).methodId(methodId).build(),
  );
  const table = new Map();
  // Error 101 is ABSENT_INFORMATION: compiled without -g:lines. Nothing to map.
  if (reply.errorCode !== 0) return table;

  const reader = connection.reader(reply.data);
  reader.long();
  reader.long();
  const count = reader.int();
  for (let index = 0; index < count; index++) {
    const codeIndex = reader.long();
    const line = reader.int();
    // The FIRST index for a line: a line can appear several times (a loop header),
    // and stopping at its first bytecode is what a student means by that line.
    if (!table.has(line)) table.set(line, codeIndex);
  }
  return table;
}

/** Class names we have already asked to be told about. */
const watchedClasses = new Set();

/**
 * Ask to be told when one class is prepared.
 *
 * Two patterns per class: the class itself, and `Name$*` for its inner and anonymous
 * classes - a breakpoint inside a lambda or an inner class lives in a separate JVM
 * class whose source file is still the outer one's.
 */
/**
 * Ask to be told when classes matching one JDWP pattern are prepared.
 *
 * A "restricted regular expression" in JDWP is an exact binary name with at most ONE
 * wildcard, at the very start or the very end. Not two - `*Main$*` is not a pattern,
 * it is a mistake that silently matches nothing.
 */
async function watchPattern(pattern) {
  if (!pattern || watchedClasses.has(pattern)) return;
  watchedClasses.add(pattern);

  const writer = connection.writer();
  writer.byte(EVENT_KIND.CLASS_PREPARE).byte(SUSPEND_POLICY.ALL).int(1);
  // Modifier kind 5 = ClassMatch.
  writer.byte(5).string(pattern);
  await connection.command(SET.EVENT_REQUEST, 1, writer.build());
}

/**
 * Watch the class a source file declares, wherever it lives.
 *
 * `*Name` rather than `Name`, because a class in a package has the package in its
 * binary name - `app.Main`, not `Main` - so the bare name missed every packaged
 * class and a breakpoint in `src/app/Main.java` never armed.
 *
 * The leading wildcard over-matches (`Main` also catches `PlainMain`), which costs
 * nothing: a prepared class is keyed back to its source file name, and one no
 * breakpoint names is recorded and ignored. It is emphatically not `*`, the pattern
 * that round-trips every class the JDK loads and made startup take seconds.
 *
 * Inner classes are NOT covered here and cannot be: `app.Main$Inner` needs a
 * trailing wildcard on a name that includes the package, which is unknown until the
 * outer class prepares. `watchNested` does it then.
 */
async function watchClass(className) {
  if (!className) return;
  await watchPattern(`*${className}`);
}

/** `Lapp/Main;` -> `app.Main`. */
function binaryNameOf(signature) {
  return signature.replace(/^L/, '').replace(/;$/, '').replace(/\//g, '.');
}

/** Arm every wanted breakpoint that has a loaded class, and report what took. */
async function applyBreakpoints() {
  for (const requestId of breakpointRequests) {
    await connection.command(
      SET.EVENT_REQUEST,
      2,
      connection.writer().byte(EVENT_KIND.BREAKPOINT).int(requestId).build(),
    );
  }
  breakpointRequests = [];

  const acceptedByFile = {};

  for (const [sourceName, lines] of wanted) {
    /*
     * Every class from this file, not "the" class.
     *
     * One `.java` declares as many classes as it likes - an inner class, a second
     * top-level class - and each is a separate JDWP reference type with its own line
     * table. Keeping one entry per source file meant `Main$Node` preparing after
     * `Main` replaced it, so a breakpoint on a line in `main` was looked up in the
     * inner class's line table, found nothing, and was dropped in silence.
     */
    const known = classes.get(sourceName);
    if (!known || known.length === 0) continue;

    const accepted = [];
    for (const line of lines) {
      let location = null;
      for (const type of known) {
        for (const method of type.methods) {
          const table = await lineTable(type.typeId, method.methodId);
          const index = table.get(line);
          if (index !== undefined) {
            location = { typeTag: 1, classId: type.typeId, methodId: method.methodId, index };
            break;
          }
        }
        if (location) break;
      }
      if (!location) continue;

      const writer = connection.writer();
      writer.byte(EVENT_KIND.BREAKPOINT).byte(SUSPEND_POLICY.ALL).int(1);
      // Modifier kind 7 = LocationOnly.
      writer.byte(7).location(location);

      const reply = await connection.command(SET.EVENT_REQUEST, 1, writer.build());
      if (reply.errorCode !== 0) continue;

      breakpointRequests.push(reply.data.readInt32BE(0));
      accepted.push(line);
    }

    if (accepted.length > 0) acceptedByFile[sourceName] = accepted.sort((a, b) => a - b);
  }

  const entrySource = `${MAIN_CLASS.split('.').pop()}.java`;
  send({
    type: 'breakpoints',
    lines: acceptedByFile[entrySource] ?? [],
    files: acceptedByFile,
  });
}

// ── Reading values ──────────────────────────────────────────────────────────

/**
 * One JDWP tagged value, off the wire and no further.
 *
 * Deliberately separate from rendering. A watch expression like `node.next.value`
 * has to keep walking from a value, and a rendered `"object#42"` is a dead end - so
 * this returns the object id, and `render` turns it into something a panel shows.
 *
 * It must consume exactly the value's bytes whatever the tag, or every subsequent
 * value in the same reply is read from the wrong offset.
 */
function readTagged(reader) {
  const tag = reader.byte();

  switch (tag) {
    case TAG.BOOLEAN:
      return { tag, value: reader.boolean() };
    case TAG.BYTE:
      return { tag, value: reader.buffer.readInt8(reader.at++) };
    case TAG.CHAR: {
      const code = reader.buffer.readUInt16BE(reader.at);
      reader.at += 2;
      return { tag, value: code };
    }
    case TAG.SHORT: {
      const value = reader.buffer.readInt16BE(reader.at);
      reader.at += 2;
      return { tag, value };
    }
    case TAG.INT:
      return { tag, value: reader.int() };
    case TAG.LONG:
      return { tag, value: reader.long() };
    case TAG.FLOAT: {
      const value = reader.buffer.readFloatBE(reader.at);
      reader.at += 4;
      return { tag, value };
    }
    case TAG.DOUBLE: {
      const value = reader.buffer.readDoubleBE(reader.at);
      reader.at += 8;
      return { tag, value };
    }
    case TAG.VOID:
      return { tag };
    default:
      // Every remaining tag carries an object id, so the reader stays in step even
      // when the value itself cannot be rendered usefully.
      return { tag, id: reader.objectId() };
  }
}

/** A raw tagged value, rendered the way the variables panel expects. */
async function render(raw) {
  switch (raw.tag) {
    case TAG.BOOLEAN:
      return { text: String(raw.value), type: 'boolean' };
    case TAG.BYTE:
      return { text: String(raw.value), type: 'byte' };
    case TAG.CHAR:
      return { text: `'${String.fromCharCode(raw.value)}'`, type: 'char' };
    case TAG.SHORT:
      return { text: String(raw.value), type: 'short' };
    case TAG.INT:
      return { text: String(raw.value), type: 'int' };
    case TAG.LONG:
      return { text: String(raw.value), type: 'long' };
    case TAG.FLOAT:
      return { text: String(raw.value), type: 'float' };
    case TAG.DOUBLE:
      return { text: String(raw.value), type: 'double' };
    case TAG.VOID:
      return { text: 'void', type: 'void' };
    case TAG.STRING: {
      if (raw.id === 0n) return { text: 'null', type: 'String' };
      // The id is a handle; the characters need a second round trip.
      const reply = await connection.command(
        SET.STRING_REFERENCE,
        1,
        connection.writer().objectId(raw.id).build(),
      );
      if (reply.errorCode !== 0) return { text: '<unreadable String>', type: 'String' };
      const value = connection.reader(reply.data).string();
      const shown = value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value;
      return { text: JSON.stringify(shown), type: 'String', length: value.length };
    }
    case TAG.ARRAY: {
      if (raw.id === 0n) return { text: 'null', type: 'array' };
      const length = await arrayLength(raw.id);
      if (length === null) return { text: 'array', type: 'array' };
      return { text: `array(${length} items)`, type: 'array', length };
    }
    default: {
      if (raw.id === 0n) return { text: 'null', type: 'object' };
      const typeName = await runtimeTypeName(raw.id);
      return { text: typeName ? `${typeName}@${raw.id}` : `object#${raw.id}`, type: 'object' };
    }
  }
}

/** ArrayReference.Length, or null if it could not be read. */
async function arrayLength(objectId) {
  const reply = await connection.command(
    SET.ARRAY_REFERENCE,
    1,
    connection.writer().objectId(objectId).build(),
  );
  if (reply.errorCode !== 0) return null;
  return connection.reader(reply.data).int();
}

/** Read one tagged value from a reply and render it. */
async function describe(reader) {
  return render(readTagged(reader));
}

/** The simple name of an object's runtime class, e.g. `ArrayList`, or null. */
async function runtimeTypeName(objectId) {
  const typeReply = await connection.command(
    SET.OBJECT_REFERENCE,
    1,
    connection.writer().objectId(objectId).build(),
  );
  if (typeReply.errorCode !== 0) return null;
  const typeReader = connection.reader(typeReply.data);
  typeReader.byte();
  const typeId = typeReader.referenceTypeId();

  const signature = await signatureOf(typeId);
  if (!signature) return null;
  return binaryNameOf(signature).split('.').pop();
}

/** ReferenceType.Signature, e.g. `Ljava/util/ArrayList;`. */
async function signatureOf(typeId) {
  const reply = await connection.command(
    SET.REFERENCE_TYPE,
    1,
    connection.writer().referenceTypeId(typeId).build(),
  );
  if (reply.errorCode !== 0) return null;
  return connection.reader(reply.data).string();
}

/** The locals visible at one frame, from the method's variable table. */
async function localsOf(thread, frame) {
  const slots = await frameSlots(thread, frame);
  const locals = [];
  for (const slot of slots) locals.push({ name: slot.name, value: await render(slot.raw) });
  return locals;
}

/** The same locals, as raw values a watch expression can keep walking from. */
async function frameSlots(thread, frame) {
  const table = await connection.command(
    SET.METHOD,
    2,
    connection.writer().referenceTypeId(frame.location.classId).methodId(frame.location.methodId).build(),
  );
  // ABSENT_INFORMATION: compiled without -g:vars. Nothing to show, and saying so is
  // better than an empty panel that looks like "no variables exist".
  if (table.errorCode !== 0) return [];

  const reader = connection.reader(table.data);
  reader.int();
  const slotCount = reader.int();

  const visible = [];
  for (let index = 0; index < slotCount; index++) {
    const codeIndex = reader.long();
    const name = reader.string();
    const signature = reader.string();
    const length = reader.int();
    const slot = reader.int();

    // A local only exists over part of the method. Reading one outside its range
    // returns whatever is in the slot, which is another variable's value.
    const at = frame.location.index;
    if (at >= codeIndex && at < codeIndex + BigInt(length)) {
      visible.push({ name, signature, slot });
    }
  }

  if (visible.length === 0) return [];

  const writer = connection.writer();
  writer.objectId(thread).frameId(frame.frameId).int(visible.length);
  for (const variable of visible) {
    writer.int(variable.slot).byte(signatureTag(variable.signature));
  }

  const values = await connection.command(SET.STACK_FRAME, 1, writer.build());
  if (values.errorCode !== 0) return [];

  const valueReader = connection.reader(values.data);
  const count = valueReader.int();
  const slots = [];
  for (let index = 0; index < count && index < visible.length; index++) {
    slots.push({ name: visible[index].name, raw: readTagged(valueReader) });
  }
  return slots;
}

/** The JDWP tag byte a slot's type signature implies. */
function signatureTag(signature) {
  const first = signature.charAt(0);
  if (first === '[') return TAG.ARRAY;
  if (first === 'L') return signature === 'Ljava/lang/String;' ? TAG.STRING : TAG.OBJECT;
  return signature.charCodeAt(0);
}

// ── Stopping ────────────────────────────────────────────────────────────────

/** Report a stop: where, the stack, and the locals of the top frame. */
async function reportStop(thread, reason) {
  pausedThread = thread;

  /*
   * -1, not MAX_STACK.
   *
   * `length` is "how many frames from `startFrame`", and asking for more than the
   * thread has is an error (INVALID_LENGTH), not a short read - so a fixed 50 failed
   * on every stack shallower than 50, which is every student program. The reply came
   * back with an error code, `reportStop` returned early, and the breakpoint fired
   * with nothing shown: the program stopped and the IDE never heard about it.
   *
   * -1 means "all remaining"; the cap is applied here instead.
   */
  const framesReply = await connection.command(
    SET.THREAD_REFERENCE,
    6,
    connection.writer().objectId(thread).int(0).int(-1).build(),
  );
  if (framesReply.errorCode !== 0) {
    process.stderr.write(`java debug adapter: could not read the stack (JDWP ${framesReply.errorCode})\n`);
    return;
  }

  const reader = connection.reader(framesReply.data);
  const count = Math.min(reader.int(), MAX_STACK);
  const frames = [];
  for (let index = 0; index < count; index++) {
    frames.push({ frameId: reader.frameId(), location: reader.location() });
  }
  if (frames.length === 0) return;
  // Kept so a watch expression has a frame to resolve names against. Frame ids are
  // only valid while the thread is suspended, so this is cleared on every resume.
  pausedFrame = frames[0];

  const described = [];
  for (const frame of frames) {
    described.push(await describeFrame(frame));
  }

  // Only the student's own frames. A stack that starts inside the JDK is noise to
  // someone learning, and matches what the other two adapters already do.
  const own = described.filter(frame => frame.file !== null);
  const stack = (own.length > 0 ? own : described).map(frame => ({
    name: frame.name,
    file: frame.file ?? 'unknown',
    line: frame.line,
  }));

  send({
    type: 'stopped',
    reason,
    file: stack[0].file,
    line: stack[0].line,
    stack,
    locals: await localsOf(thread, frames[0]),
    globals: [],
  });
}

/** One frame's name, file and line - or file null when it is not the student's. */
async function describeFrame(frame) {
  const signatureReply = await connection.command(
    SET.REFERENCE_TYPE,
    1,
    connection.writer().referenceTypeId(frame.location.classId).build(),
  );
  const signature = signatureReply.errorCode === 0
    ? connection.reader(signatureReply.data).string()
    : '';

  const sourceName = sourceNameForSignature(signature);
  // The exact type this frame is in, among however many that file declares.
  const known = classes.get(sourceName)?.find(type => type.typeId === frame.location.classId);
  const isOurs = known !== undefined;

  let name = '(method)';
  let line = 0;

  if (known) {
    const method = known.methods.find(candidate => candidate.methodId === frame.location.methodId);
    if (method) name = method.name === '<init>' ? '(constructor)' : method.name;

    const table = await lineTable(frame.location.classId, frame.location.methodId);
    // The greatest line whose code index is at or before here: the bytecode we are
    // stopped at belongs to the most recent line that started before it.
    for (const [candidateLine, index] of table) {
      if (index <= frame.location.index && candidateLine > line) line = candidateLine;
    }
  }

  return { name, file: isOurs ? sourceName : null, line };
}

// ── Commands from the IDE ───────────────────────────────────────────────────

async function step(depth) {
  if (pausedThread === null) return;

  const writer = connection.writer();
  writer.byte(EVENT_KIND.SINGLE_STEP).byte(SUSPEND_POLICY.ALL).int(1);
  // Modifier kind 10 = Step.
  writer.byte(10).objectId(pausedThread).int(STEP_SIZE_LINE).int(depth);

  const reply = await connection.command(SET.EVENT_REQUEST, 1, writer.build());
  if (reply.errorCode === 0) stepRequest = reply.data.readInt32BE(0);

  await resume();
}

async function clearStepRequest() {
  if (stepRequest === null) return;
  await connection.command(
    SET.EVENT_REQUEST,
    2,
    connection.writer().byte(EVENT_KIND.SINGLE_STEP).int(stepRequest).build(),
  );
  stepRequest = null;
}

async function resume() {
  pausedThread = null;
  pausedFrame = null;
  await connection.command(SET.VIRTUAL_MACHINE, 9);
}

// ── Watch expressions ───────────────────────────────────────────────────────

/**
 * A name, or a path of field accesses through names: `total`, `node.next.value`,
 * `args.length`. Nothing else - see `evaluateExpression`.
 */
const FIELD_PATH = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/;

/** Every field of a type and its supertypes, as name -> {fieldId, typeId, isStatic}. */
async function fieldsOf(typeId) {
  const found = new Map();

  // Walk up: a field declared on a superclass is still readable through the
  // subclass, and students inherit constantly.
  let current = typeId;
  for (let depth = 0; current && depth < 20; depth++) {
    const reply = await connection.command(
      SET.REFERENCE_TYPE,
      4,
      connection.writer().referenceTypeId(current).build(),
    );
    if (reply.errorCode !== 0) break;

    const reader = connection.reader(reply.data);
    const count = reader.int();
    for (let index = 0; index < count; index++) {
      const fieldId = reader.fieldId();
      const name = reader.string();
      reader.string();
      const modBits = reader.int();
      // The nearest declaration wins, which is what shadowing means.
      if (!found.has(name)) found.set(name, { fieldId, typeId: current, isStatic: (modBits & 0x0008) !== 0 });
    }

    const superReply = await connection.command(
      SET.CLASS_TYPE,
      1,
      connection.writer().referenceTypeId(current).build(),
    );
    if (superReply.errorCode !== 0) break;
    const superId = connection.reader(superReply.data).referenceTypeId();
    // java.lang.Object's superclass is the null id, which ends the walk.
    current = superId === 0n ? null : superId;
  }

  return found;
}

/** Read one named field from an object, or null if it has no such field. */
async function fieldOfObject(objectId, name) {
  const typeReply = await connection.command(
    SET.OBJECT_REFERENCE,
    1,
    connection.writer().objectId(objectId).build(),
  );
  if (typeReply.errorCode !== 0) return null;
  const typeReader = connection.reader(typeReply.data);
  typeReader.byte();
  const typeId = typeReader.referenceTypeId();

  const field = (await fieldsOf(typeId)).get(name);
  if (!field) return null;

  const reply = await connection.command(
    SET.OBJECT_REFERENCE,
    2,
    connection.writer().objectId(objectId).int(1).fieldId(field.fieldId).build(),
  );
  if (reply.errorCode !== 0) return null;
  const reader = connection.reader(reply.data);
  if (reader.int() < 1) return null;
  return readTagged(reader);
}

/** Read one named static field of a class, or null. */
async function staticField(typeId, name) {
  const field = (await fieldsOf(typeId)).get(name);
  if (!field || !field.isStatic) return null;

  const reply = await connection.command(
    SET.REFERENCE_TYPE,
    6,
    connection.writer().referenceTypeId(field.typeId).int(1).fieldId(field.fieldId).build(),
  );
  if (reply.errorCode !== 0) return null;
  const reader = connection.reader(reply.data);
  if (reader.int() < 1) return null;
  return readTagged(reader);
}

/**
 * Evaluate a watch expression at the paused frame.
 *
 * ## What this deliberately is not
 *
 * It is not a Java evaluator. Evaluating `list.size() + 1` means compiling an
 * expression against a live frame - a compiler front end, a class loader and an
 * invocation protocol - which is far more machinery than a teaching IDE's watch panel
 * justifies, and which fails in ways a beginner cannot read.
 *
 * What it does cover is what a watch panel is actually used for: a variable, a field,
 * a chain of fields, and the length of an array. Anything else is refused by name, so
 * a student is told "this shape is not supported" rather than shown a wrong answer or
 * a JDWP error code.
 */
async function evaluateExpression(expression) {
  const text = String(expression ?? '').trim();
  if (!text) return { error: 'Nothing to evaluate' };
  if (pausedThread === null || pausedFrame === null) {
    return { error: 'The program is not paused' };
  }
  if (!FIELD_PATH.test(text)) {
    return {
      error: 'Java watches support a variable or a field path (like total or node.next.value)',
    };
  }

  const parts = text.split('.').map(part => part.trim());
  const [head, ...rest] = parts;

  const slots = await frameSlots(pausedThread, pausedFrame);
  let current = slots.find(slot => slot.name === head)?.raw ?? null;

  if (!current) {
    // Not a local: try `this`, then a static of the class the frame is in. That
    // ordering is Java's own scoping.
    const self = slots.find(slot => slot.name === 'this');
    if (self?.raw?.id) current = await fieldOfObject(self.raw.id, head);
    if (!current) current = await staticField(pausedFrame.location.classId, head);
  }
  if (!current) return { error: `No variable or field named ${head} is visible here` };

  for (const step of rest) {
    if (current.tag === TAG.ARRAY && step === 'length') {
      if (current.id === 0n) return { error: 'null has no length' };
      const length = await arrayLength(current.id);
      if (length === null) return { error: 'Could not read the array length' };
      current = { tag: TAG.INT, value: length };
      continue;
    }
    if (current.id === undefined) return { error: `${step} is not a field of a primitive value` };
    if (current.id === 0n) return { error: `Cannot read ${step} of null` };

    const next = await fieldOfObject(current.id, step);
    if (!next) return { error: `No field named ${step} on that value` };
    current = next;
  }

  return { value: await render(current) };
}

async function handleCommand(command) {
  switch (command?.command) {
    case 'setBreakpoints': {
      wanted = new Map();
      const entrySource = `${MAIN_CLASS.split('.').pop()}.java`;
      if (Array.isArray(command.lines) && command.lines.length > 0) {
        wanted.set(entrySource, [...command.lines]);
      }
      for (const [file, lines] of Object.entries(command.files ?? {})) {
        // The IDE names a path; JDWP knows only a source file name.
        const sourceName = path.basename(file);
        wanted.set(sourceName, [...(wanted.get(sourceName) ?? []), ...(lines ?? [])]);
      }

      // Watch every class a breakpoint names, so one in a file that has not loaded yet
      // arms the moment it does rather than being silently forgotten.
      for (const sourceName of wanted.keys()) {
        await watchClass(sourceName.replace(/\.java$/i, ''));
      }

      await applyBreakpoints();
      markBreakpointsReceived();
      return;
    }

    case 'continue':
      await clearStepRequest();
      await resume();
      return;

    case 'next':
      await clearStepRequest();
      await step(STEP_DEPTH.OVER);
      return;

    case 'stepIn':
      await clearStepRequest();
      await step(STEP_DEPTH.INTO);
      return;

    case 'stepOut':
      await clearStepRequest();
      await step(STEP_DEPTH.OUT);
      return;

    case 'evaluate': {
      const expression = String(command.expression ?? '');
      const result = await evaluateExpression(expression);
      send({ type: 'evaluated', expression, ...result });
      return;
    }

    case 'stop':
      // VirtualMachine.Exit, so the JVM winds down rather than being killed - its
      // stdout reaches the student either way, but this reports a real exit code.
      await connection.command(SET.VIRTUAL_MACHINE, 10, connection.writer().int(1).build());
      setTimeout(() => { try { jvm.kill(); } catch { /* gone */ } }, 500);
      return;

    default:
      send({ type: 'error', message: `unknown command: ${command?.command}` });
  }
}

/*
 * Commands are held until the debugger can act on them, and then run in order.
 *
 * `hello` is what makes the server report `debug:attached`, and a client reacts to
 * that by sending `setBreakpoints` immediately - but `hello` has to go out early or
 * the channel's own connect timeout fires. So between the two there is a window in
 * which a command can arrive with no JDWP connection to serve it.
 *
 * It is not hypothetical: driving a real Java debug run over HTTP, `setBreakpoints`
 * landed before the JVM was attached, threw inside the handler, and was lost. Nothing
 * was armed, `markBreakpointsReceived` never fired, and the program ran to completion
 * five seconds later when the fallback timer gave up - a breakpoint in the margin and
 * a program that ignored it.
 *
 * Python's adapter has always queued for exactly this reason; its own comment says
 * so. This is the same fix.
 */
let markReady = () => {};
const ready = new Promise(resolve => { markReady = resolve; });
let handling = ready;

channel.on('data', chunk => {
  channelBuffer += chunk.toString('utf8');
  let index;
  while ((index = channelBuffer.indexOf('\n')) !== -1) {
    const line = channelBuffer.slice(0, index);
    channelBuffer = channelBuffer.slice(index + 1);
    if (!line.trim()) continue;

    let command;
    try {
      command = JSON.parse(line);
    } catch {
      // A malformed frame must not end the session.
      continue;
    }

    handling = handling
      .then(() => handleCommand(command), () => handleCommand(command))
      .catch(error => {
        process.stderr.write(`java debug adapter: ${error?.stack || error}\n`);
      });
  }
});

// ── Bring it up ─────────────────────────────────────────────────────────────

/**
 * Handle one Event.Composite.
 *
 * A composite is ONE suspension however many events it carries, so it gets at most one
 * resume. Resuming per event was wrong in both directions: three class-prepares in one
 * packet drove the suspend count negative, and the VM then ignored a later real
 * suspend.
 *
 * A stop is the exception - the program stays suspended until the student says
 * otherwise, which is the entire point.
 */
async function onComposite(composite) {
  let stayStopped = false;

  for (const event of composite.events) {
    if (event.kind === EVENT_KIND.CLASS_PREPARE) {
      const sourceName = sourceNameForSignature(event.signature);
      const forFile = classes.get(sourceName) ?? [];
      if (!forFile.some(type => type.typeId === event.typeId)) {
        forFile.push({ typeId: event.typeId, methods: await methodsOf(event.typeId) });
      }
      classes.set(sourceName, forFile);

      // A class the student has breakpoints in has just become armable.
      if (wanted.has(sourceName)) {
        // Now that the package is known, the inner classes of this file can be
        // named exactly - `app.Main$*` - which no pattern could express before.
        const binary = binaryNameOf(event.signature);
        if (!binary.includes('$')) await watchPattern(`${binary}$*`);
        await applyBreakpoints();
      }
      continue;
    }

    if (event.kind === EVENT_KIND.BREAKPOINT) {
      stayStopped = true;
      await reportStop(event.thread, 'breakpoint');
      continue;
    }

    if (event.kind === EVENT_KIND.SINGLE_STEP) {
      // A step request fires forever until cleared, so it is cleared at the stop it
      // produced rather than when the next command arrives.
      stayStopped = true;
      await clearStepRequest();
      await reportStop(event.thread, 'step');
      continue;
    }

    if (event.kind === EVENT_KIND.VM_DEATH) {
      /*
       * Noted, not acted on.
       *
       * Closing the channel here raced the JVM's own exit: `terminated` is sent from
       * the process `exit` handler, which knows the real exit code, and it arrived to
       * find the channel already shut - so the IDE saw the program stop and never
       * heard that it had ended, leaving the toolbar live over a dead session.
       *
       * The process exit is the authoritative end. This event only means "do not
       * expect anything more over JDWP".
       */
      return;
    }

    if (event.kind === EVENT_KIND.VM_START) {
      /*
       * Do NOT resume here.
       *
       * `suspend=y` means the VM is stopped before it has loaded anything, and this
       * event announces that. Resuming it from here let the program run before the
       * CLASS_PREPARE request was registered - so `Main` loaded unwatched, the
       * breakpoint had no class to attach to, and a program that had already finished
       * simply never stopped. The startup path below resumes once, deliberately,
       * after the request is in place.
       */
      stayStopped = true;
    }
  }

  if (!stayStopped && composite.suspendPolicy !== SUSPEND_POLICY.NONE) {
    await connection.command(SET.VIRTUAL_MACHINE, 9);
  }
}

/**
 * Connect to the JVM's debug port, retrying until it is listening.
 *
 * The JVM prints "Listening for transport" and opens the socket a beat AFTER the
 * process starts - a second or so on a cold start, longer on a loaded machine - so the
 * first attempt reliably gets ECONNREFUSED. Retrying is the fix; waiting a fixed delay
 * instead would be a guess that is too short on a busy host and wasted time on an idle
 * one.
 *
 * Bounded, because a JVM that never listens must become an honest failure rather than
 * a session that hangs.
 */
async function attachWithRetry(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (jvm.exitCode !== null) throw new Error('the JVM exited before the debugger attached');
    try {
      return await JdwpConnection.connect(jdwpPort, '127.0.0.1', {
        onEvent: composite => {
          // Reported, never swallowed: a rejection here used to leave the VM suspended
          // with no message at all, which is indistinguishable from a hung program.
          onComposite(composite).catch(error => {
            const detail = error?.stack || error;
            process.stderr.write(`java debug adapter: event handling failed - ${detail}\n`);
          });
        },
      });
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  throw lastError ?? new Error('timed out attaching to the JVM');
}

channel.on('connect', async () => {
  send({ type: 'hello', token: TOKEN, pid: process.pid });

  try {
    connection = await attachWithRetry();
    await connection.handshake();
  } catch (error) {
    process.stderr.write(`java debug adapter: could not attach (${error?.message || error})\n`);
    return;
  }

  // Watch for the entry class. Others are added as breakpoints name them.
  //
  // NOT `ClassMatch: '*'`. That fires for every class the JVM loads - hundreds from
  // the JDK before the student's own - and each one suspends the world while this
  // process makes a round trip to read its methods. The program took seconds to reach
  // its first line and the suspend bookkeeping came apart under the volume.
  await watchClass(MAIN_CLASS.split('.').pop());

  // Only now can a command be served, so anything the client already sent runs here.
  // No `attached` frame: the server derives `debug:attached` from `hello`, and
  // sending one as well made the client see the same event twice.
  markReady();

  /*
   * Wait for the IDE's first `setBreakpoints` before letting the program run.
   *
   * Without this the JVM was resumed the instant it attached, and a short program
   * finished before the command arrived - the breakpoint was then armed against a
   * class whose `main` had already returned, so it reported as armed and never fired.
   * A student would see the program run straight through with a breakpoint sitting in
   * the margin.
   *
   * Python's adapter has always done this; the same race exists there and is closed
   * the same way. Bounded, because a client that never sends one must still get its
   * program run rather than a session that hangs.
   */
  await firstBreakpointsCommand;

  await connection.command(SET.VIRTUAL_MACHINE, 9);
  send({ type: 'started' });
});
