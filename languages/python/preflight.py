# ─── Pre-run static checker for Browser Coder (Python) ──────────────────────
# Scans user code WITHOUT executing it and reports blocking problems so the
# sandbox can refuse to run code that would fail — instead of running it up to
# the first bad line and failing halfway through.
#
# It detects:
#   1. Syntax errors    (SyntaxError / IndentationError / TabError)
#   2. Undefined names  (e.g. `prin("hi")` — a typo for `print`)
#
# Design: conservative. A name is treated as "defined" if it is bound in ANY
# scope of the module (function, class, comprehension, import, param, …), so the
# checker NEVER blocks code that would actually run. It only flags names that
# appear nowhere as a binding and are not Python builtins. It also bails out of
# the undefined-name check entirely (still reporting syntax errors) whenever the
# code uses constructs that can inject names dynamically — star-imports,
# exec/eval/globals/locals/vars/compile/__import__, `from __future__ import
# annotations`, or `match` statements — because those make static name analysis
# unreliable and could otherwise produce false positives.
#
# Output: a JSON array on stdout. Empty array = nothing to block. Each entry:
#   {"line": int, "col": int, "msg": str, "text": str, "kind": "syntax"|"name"}
# Exit code: 0 when clean, 1 when there is at least one blocking problem.
# On any internal failure it prints "[]" and exits 0 (fail-open: never block
# valid code because the checker itself hiccuped).

import ast
import sys
import json
import builtins

MAX_ERRORS = 25

_MODULE_DUNDERS = {
    '__name__', '__file__', '__doc__', '__builtins__', '__spec__',
    '__loader__', '__package__', '__annotations__', '__dict__', '__debug__',
    '__path__', '__cached__',
}

_DYNAMIC_NAMES = {
    'exec', 'eval', 'globals', 'locals', 'vars', 'compile', '__import__',
}


def _source_line(lines, lineno):
    if lineno and 1 <= lineno <= len(lines):
        return lines[lineno - 1].rstrip('\n')
    return ''


def _should_bail(tree):
    """True when the module uses constructs that make static name analysis
    unreliable (dynamic name injection, star-imports, future annotations,
    or match statements)."""
    match_cls = getattr(ast, 'Match', None)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module == '__future__' and any(a.name == 'annotations' for a in node.names):
                return True
            if any(a.name == '*' for a in node.names):
                return True
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) \
                and node.id in _DYNAMIC_NAMES:
            return True
        elif match_cls is not None and isinstance(node, match_cls):
            return True
    return False


def _collect(tree):
    """Return (defined_names, loaded_refs) walking every scope as one.

    defined_names: set of names bound anywhere in the module.
    loaded_refs:   list of (name, line, col) for every Name used in Load ctx.
    """
    defined = set(dir(builtins))
    defined.update(_MODULE_DUNDERS)
    loaded = []

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)
        elif isinstance(node, ast.arg):
            defined.add(node.arg)
        elif isinstance(node, ast.Name):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                defined.add(node.id)
            else:
                loaded.append((node.id, node.lineno, node.col_offset))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                defined.add((alias.asname or alias.name).split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                defined.add(alias.asname or alias.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            defined.update(node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            defined.add(node.name)

    return defined, loaded


def main():
    if len(sys.argv) < 2:
        print('[]')
        return 0

    try:
        with open(sys.argv[1], 'r', encoding='utf-8-sig') as fh:
            source = fh.read()
    except Exception:
        print('[]')
        return 0

    lines = source.splitlines()

    # ── 1. Syntax check ─────────────────────────────────────────────────────
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        out = [{
            'line': exc.lineno or 1,
            'col': exc.offset or 1,
            'msg': '%s: %s' % (type(exc).__name__, exc.msg or 'invalid syntax'),
            'text': (exc.text or _source_line(lines, exc.lineno) or '').rstrip('\n'),
            'kind': 'syntax',
        }]
        print(json.dumps(out))
        return 1
    except Exception:
        # Any other parse problem: fail open, let the normal run handle it.
        print('[]')
        return 0

    # ── 2. Undefined-name check (skipped for dynamic/ambiguous code) ────────
    try:
        if _should_bail(tree):
            print('[]')
            return 0

        defined, loaded = _collect(tree)

        errors = []
        seen = set()
        for name, line, col in loaded:
            if name in defined or name in seen:
                continue
            seen.add(name)
            errors.append({
                'line': line,
                'col': col + 1,
                'msg': "NameError: name '%s' is not defined" % name,
                'text': _source_line(lines, line),
                'kind': 'name',
            })
            if len(errors) >= MAX_ERRORS:
                break

        errors.sort(key=lambda e: (e['line'], e['col']))
        print(json.dumps(errors))
        return 1 if errors else 0
    except Exception:
        print('[]')
        return 0


if __name__ == '__main__':
    sys.exit(main())
