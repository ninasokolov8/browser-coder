/**
 * Parsing a Java breakpoint condition.
 *
 * ## Why Java has this file and no other language does
 *
 * Every other debugger here evaluates a condition itself: V8's `setBreakpointByUrl`
 * takes one, bdb's `set_break` takes one, DAP's `SourceBreakpoint` has a `condition`
 * field, and DBGp has a whole `conditional` breakpoint type. The engine tests it in the
 * stopped frame and only reports a pause when it is true, so a condition on a loop
 * never reaches the adapter at all.
 *
 * JDWP does not. Its event modifiers are Count, ThreadOnly, ClassOnly, ClassMatch,
 * ClassExclude, LocationOnly, ExceptionOnly, FieldOnly, Step, InstanceOnly and
 * SourceNameMatch. The specification reserves modKind 8 as "Conditional" and marks it
 * "For the future"; no JVM implements it. So the Java adapter has to stop, decide, and
 * resume - which costs one round trip per iteration, and is exactly why the supported
 * shape is narrow rather than a general Java expression evaluator.
 *
 * ## Why the parser is separate from the adapter
 *
 * `debug_adapter.mjs` opens a socket and spawns a JVM the moment it is imported, so a
 * unit test cannot load it. This module is pure: it turns text into a decision about
 * SHAPE, and knows nothing about JDWP, values or frames. The adapter resolves the
 * operands and compares them.
 *
 * ## What is supported, and why refusing the rest matters
 *
 *   total              a boolean variable, on its own
 *   i == 5             a path compared with a literal
 *   node.next.value    a path, anywhere a path is allowed
 *   name != "bob"      strings, with Java's own escapes
 *   items.length > 0   an array length
 *   a.x <= b.y         two paths
 *
 * Anything else - a method call, arithmetic, `&&` - is refused BY NAME at arm time
 * rather than ignored. A breakpoint that quietly drops its condition looks identical
 * to one whose condition is false, and a student cannot tell "this never happened"
 * from "the IDE ignored me".
 */

/** A path: an identifier, or identifiers joined by dots. Matches the watch grammar. */
export const FIELD_PATH = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/;

/**
 * `left OP right`.
 *
 * The left side is non-greedy and the operators are ordered longest-first, so `<=`
 * is never read as `<` followed by a stray `=`.
 */
const COMPARISON = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/;

/**
 * A Java literal as a comparable JavaScript value.
 *
 * Returns `undefined` for anything that is not a literal - which is why every caller
 * checks against `undefined` rather than falsiness: `0`, `false` and `null` are all
 * literals, and all falsy.
 */
export function parseLiteral(text) {
  const trimmed = String(text ?? '').trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;

  // A char literal compares as the one-character string it holds.
  const char = /^'(\\.|[^'\\])'$/.exec(trimmed);
  if (char) {
    const body = char[1];
    if (!body.startsWith('\\')) return body;
    const escapes = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"' };
    return escapes[body[1]] ?? body[1];
  }

  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
    try {
      // Java's string escapes are a subset of JSON's for everything a student writes.
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  // `L`, `f` and `d` are Java's width suffixes, not part of the number.
  if (/^[+-]?\d+[lL]?$/.test(trimmed)) return Number(trimmed.replace(/[lL]$/, ''));
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)[fdFD]$/.test(trimmed)) return Number(trimmed.slice(0, -1));
  if (/^[+-]?(?:\d+\.\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);

  return undefined;
}

/**
 * Parse a condition into the shape the adapter evaluates, or null if unsupported.
 *
 * Null is the signal to refuse at arm time. The adapter reports it and arms the
 * breakpoint WITHOUT the condition, so it stops every time - the safe direction to be
 * wrong in, because it is visible.
 */
export function parseCondition(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  const match = COMPARISON.exec(trimmed);

  if (!match) {
    // A bare path is a truthiness test - which in Java means "is this boolean true",
    // because Java has no truthiness for anything else.
    return FIELD_PATH.test(trimmed) ? { kind: 'truthy', path: trimmed } : null;
  }

  const left = match[1].trim();
  const operator = match[2];
  const right = match[3].trim();

  if (!FIELD_PATH.test(left)) return null;

  const literal = parseLiteral(right);
  if (literal !== undefined) return { kind: 'compare', left, operator, literal };
  if (FIELD_PATH.test(right)) return { kind: 'compare', left, operator, right };

  return null;
}

/** Is this a shape `parseCondition` understands? Checked before arming. */
export function conditionIsSupported(text) {
  return parseCondition(text) !== null;
}

/**
 * Apply an operator to two already-resolved values.
 *
 * Kept here so the comparison semantics are testable without a JVM. `==` is strict:
 * comparing a number with a string is false rather than coerced, because a student
 * writing `count == "5"` has made a mistake and a silently-true comparison hides it.
 */
export function compareValues(left, operator, right) {
  switch (operator) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    default: return null;
  }
}
