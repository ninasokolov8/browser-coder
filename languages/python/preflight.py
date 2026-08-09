# ─── Pre-run static checker for Browser Coder (Python) ──────────────────────
# Scans user code WITHOUT executing it and reports blocking problems so the
# sandbox can refuse to run code that would fail - instead of running it up to
# the first bad line and failing halfway through.
#
# It detects:
#   1. Syntax errors    (SyntaxError / IndentationError / TabError)
#   2. Undefined names  (e.g. `prin("hi")` - a typo for `print`)
#
# Design: conservative. A name is treated as "defined" if it is bound in ANY
# scope of the module (function, class, comprehension, import, param, …), so the
# checker NEVER blocks code that would actually run. It only flags names that
# appear nowhere as a binding and are not Python builtins. It also bails out of
# the undefined-name check entirely (still reporting syntax errors) whenever the
# code uses constructs that can inject names dynamically - star-imports,
# exec/eval/globals/locals/vars/compile/__import__, `from __future__ import
# annotations`, or `match` statements - because those make static name analysis
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
import re

MAX_ERRORS = 25

_MODULE_DUNDERS = {
    '__name__', '__file__', '__doc__', '__builtins__', '__spec__',
    '__loader__', '__package__', '__annotations__', '__dict__', '__debug__',
    '__path__', '__cached__',
}

_DYNAMIC_NAMES = {
    'exec', 'eval', 'globals', 'locals', 'vars', 'compile', '__import__',
}


# ── Security pass ───────────────────────────────────────────────────────────
# Decided on the AST, never on the text: a blocked word in a comment, a
# docstring, a string, an SVG file name or a variable name is not a reason to
# refuse a program. Only real `import` statements and real calls count.

# Modules a student program may not import. Everything else (math, random,
# time, statistics, turtle, csv, json, datetime, …) is allowed.
#
# Narrowed once the container became the boundary for the threats it can actually
# hold - but only for those threats, which is a shorter list than it first
# appears. See fs_guard.py: every job runs as the SAME uid, so file access had to
# be confined rather than simply permitted.
#
# Still blocked, and why each one is not merely redundant with the container:
#   • os, subprocess, pty, signal, resource, _posixsubprocess - process control,
#     and `os` is a second unguarded route to the filesystem (os.open, os.scandir)
#     that would make fs_guard.py optional.
#   • ctypes, mmap, marshal, pickle - reach memory or execute what they load.
#   • importlib, builtins, inspect, gc, types, code, runpy, pdb - reach the
#     interpreter's own state, which is how the fs guard would be unwrapped.
#   • pathlib, glob, shutil, fileinput, tempfile, fnmatch, io, codecs, sqlite3,
#     shelve, dbm, zipfile, tarfile, gzip, bz2, lzma - filesystem access that does
#     NOT pass through the guarded `open`. These are the ones worth revisiting:
#     each is a real curriculum topic, and each needs its own confinement.
#   • socket, ssl, http, urllib, requests, ftplib, smtplib, … - the network is
#     already unreachable; these stay only so the failure is a clear message
#     instead of a timeout the student cannot interpret.
#   • threading, multiprocessing, asyncio, _thread - concurrency the runner's
#     single-process timeout and pid limit model does not account for.
_BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'ssl', 'select', 'signal', 'shutil',
    'pathlib', 'io', 'codecs', 'pickle', 'cPickle',
    'marshal', 'ctypes', 'mmap', 'resource', 'pty', 'tty', 'termios', 'fcntl',
    'threading', 'multiprocessing', 'asyncio', 'importlib', 'builtins',
    'inspect', 'gc', 'dis', 'code', 'types', 'tempfile', 'platform', 'ast',
    'glob', 'fnmatch', 'fileinput', 'getpass', 'webbrowser', 'sqlite3',
    'http', 'urllib', 'urllib2', 'requests', 'ftplib', 'smtplib', 'telnetlib',
    'poplib', 'imaplib', 'nntplib', 'xmlrpc', 'commands',
    'shelve', 'dbm', 'anydbm', 'whichdb', 'zipfile', 'tarfile', 'gzip', 'bz2',
    'lzma', 'runpy', 'pdb', 'site', 'sysconfig', 'venv', 'distutils',
    'setuptools', 'posix', 'nt', 'pwd', 'grp', 'spwd', 'crypt', 'curses',
    'pipes', 'popen2', '_thread', '_socket', '_posixsubprocess',
}

# `sys` is allowed, but only these attributes.
#
# sys.exit() is taught in every introductory course and is completely harmless -
# the process is going to be killed by the timeout anyway. What is NOT harmless is
# the rest of the module: sys.modules and sys.path reach the import machinery,
# and sys._getframe walks the stack into the guard's own closure. So the module is
# permitted and the dangerous attributes are named, rather than the reverse.
_ALLOWED_SYS_ATTRIBUTES = {
    'exit', 'argv', 'stdin', 'stdout', 'stderr', 'version', 'version_info',
    'maxsize', 'platform', 'byteorder', 'getsizeof', 'float_info', 'int_info',
    'getrecursionlimit', 'setrecursionlimit', 'flags', 'implementation',
    'exc_info', 'displayhook', 'excepthook', 'hexversion', 'api_version',
    'copyright', 'executable', 'prefix', 'base_prefix', 'dont_write_bytecode',
}

# Modules that are permitted but whose attribute surface is restricted.
_ATTRIBUTE_LIMITED_MODULES = {'sys': _ALLOWED_SYS_ATTRIBUTES}

# Builtins that hand out code execution or the interpreter's internals. Only
# flagged as a *direct* call: `door.open()` on the student's own object is a
# method call and stays legal, and so does a function they defined themselves
# called compile().
#
# `open` is deliberately NOT here any more. It is allowed and confined to the
# workspace at runtime by fs_guard.py - see that file for why refusing it outright
# was both too strict for the curriculum and, on its own, not the reason cross-job
# reads were prevented.
_BLOCKED_BUILTIN_CALLS = {
    'eval', 'exec', 'compile', '__import__', 'breakpoint',
    'getattr', 'setattr', 'delattr', 'globals', 'locals', 'vars',
}

# Attribute names that only exist to walk out of the sandbox.
_BLOCKED_ATTRIBUTES = {
    '__builtins__', '__class__', '__subclasses__', '__globals__', '__code__',
    '__bases__', '__mro__', '_getframe',
}

# The turtle API. Calling any of these - on the module, on a Screen, or on a
# Turtle - is drawing, never operating-system access. Listed explicitly so
# screen.update(), screen.delay() and screen.ontimer() can never be mistaken
# for something dangerous, whatever the object is named.
_TURTLE_API = {
    'Screen', 'Turtle', 'RawTurtle', 'Pen', 'getscreen',
    'setup', 'title', 'bgcolor', 'bgpic', 'screensize',
    'window_width', 'window_height', 'mode', 'colormode',
    'register_shape', 'addshape', 'getshapes', 'shape', 'resizemode',
    'shapesize', 'turtlesize', 'tilt', 'tiltangle', 'settiltangle',
    'color', 'pencolor', 'fillcolor', 'pensize', 'width', 'pen',
    'speed', 'delay', 'tracer', 'update', 'ontimer', 'mainloop', 'done',
    'bye', 'exitonclick', 'listen', 'onkey', 'onkeypress', 'onkeyrelease',
    'onclick', 'onscreenclick', 'numinput', 'textinput',
    'forward', 'fd', 'backward', 'bk', 'back', 'left', 'lt', 'right', 'rt',
    'goto', 'setpos', 'setposition', 'setx', 'sety', 'setheading', 'seth',
    'heading', 'xcor', 'ycor', 'position', 'pos', 'towards', 'distance',
    'home', 'penup', 'pu', 'up', 'pendown', 'pd', 'down', 'isdown',
    'showturtle', 'st', 'hideturtle', 'ht', 'isvisible',
    'clear', 'reset', 'clearscreen', 'resetscreen', 'undo',
    'write', 'begin_fill', 'end_fill', 'filling', 'circle', 'dot',
    'stamp', 'clearstamp', 'clearstamps',
}

_SECURITY_HINT = (
    'SecurityError: %s is disabled in Browser Coder. '
    'Drawing, math, random, time and strings are all available.'
)


def _security_problems(tree, lines):
    """Report real imports of blocked modules and real dangerous calls.

    Walks the AST, so comments, docstrings, strings and variable names are
    invisible to this check by construction.
    """
    problems = []

    def report(node, what):
        problems.append({
            'line': getattr(node, 'lineno', 1),
            'col': getattr(node, 'col_offset', 0) + 1,
            'msg': _SECURITY_HINT % what,
            'text': _source_line(lines, getattr(node, 'lineno', 0)),
            'kind': 'security',
        })

    for node in ast.walk(tree):
        # ── Real import statements ──────────────────────────────────────────
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root in _BLOCKED_MODULES:
                    report(node, "importing '%s'" % root)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or '').split('.')[0]
            if root in _BLOCKED_MODULES:
                report(node, "importing from '%s'" % root)
            elif root in _ATTRIBUTE_LIMITED_MODULES:
                # `from sys import _getframe` would otherwise bind the name
                # directly and never appear as an attribute access.
                allowed = _ATTRIBUTE_LIMITED_MODULES[root]
                for alias in node.names:
                    if alias.name == '*':
                        report(node, "importing everything from '%s'" % root)
                    elif alias.name not in allowed:
                        report(node, "using %s.%s" % (root, alias.name))

        # ── Real calls ──────────────────────────────────────────────────────
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in _BLOCKED_BUILTIN_CALLS:
                report(node, "calling %s()" % func.id)
            elif isinstance(func, ast.Attribute) and func.attr not in _TURTLE_API:
                # A method call is only dangerous when it hangs off a blocked
                # module, e.g. os.system(...) - which needs `import os` anyway.
                target = func.value
                if isinstance(target, ast.Name) and target.id in _BLOCKED_MODULES:
                    report(node, "calling %s.%s()" % (target.id, func.attr))

        # ── Attribute-limited modules ───────────────────────────────────────
        # Checked before the generic internals rule so the message names the
        # module the student actually wrote.
        elif (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in _ATTRIBUTE_LIMITED_MODULES
            and node.attr not in _ATTRIBUTE_LIMITED_MODULES[node.value.id]
        ):
            report(node, "using %s.%s" % (node.value.id, node.attr))

        # ── Interpreter internals ───────────────────────────────────────────
        elif isinstance(node, ast.Attribute) and node.attr in _BLOCKED_ATTRIBUTES:
            report(node, "using %s" % node.attr)
        elif isinstance(node, ast.Name) and node.id in _BLOCKED_ATTRIBUTES:
            report(node, "using %s" % node.id)

        if len(problems) >= MAX_ERRORS:
            break

    problems.sort(key=lambda p: (p['line'], p['col']))
    return problems


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


def _line_ending(line):
    """Return the original newline so recovery never shifts later positions."""
    if line.endswith('\r\n'):
        return '\r\n'
    if line.endswith('\n') or line.endswith('\r'):
        return line[-1]
    return ''


def _recovery_line(line, error=None):
    """Replace one broken statement while preserving its suite when possible.

    Python's parser stops at its first syntax error. Replacing only that statement
    lets it continue into the rest of the file, where independent syntax and name
    errors can still be found. Block headers need a valid synthetic header rather
    than `pass`, otherwise their correctly indented bodies become fake errors created
    by the recovery itself.
    """
    ending = _line_ending(line)
    content = line[:-len(ending)] if ending else line
    indent = content[:len(content) - len(content.lstrip(' \t'))]
    stripped = content[len(indent):]

    # Once an enclosing broken statement has been removed, one of its continuation
    # lines can look like a new top-level indentation error. Removing that fragment
    # entirely is the only neutral repair; keeping its indentation with `pass` would
    # manufacture the same error forever.
    if isinstance(error, IndentationError) and 'unexpected indent' in str(error):
        return ending

    if re.match(r'async\s+def\b', stripped):
        statement = 'async def __browser_coder_recovered__(*args, **kwargs):'
    elif re.match(r'def\b', stripped):
        statement = 'def __browser_coder_recovered__(*args, **kwargs):'
    elif re.match(r'class\b', stripped):
        statement = 'class __BrowserCoderRecovered__:'
    elif re.match(r'async\s+for\b|for\b', stripped):
        statement = 'for __browser_coder_recovered__ in ():'
    elif re.match(r'async\s+with\b|with\b', stripped):
        statement = 'if True:'
    elif re.match(r'elif\b', stripped):
        statement = 'elif True:'
    elif re.match(r'else\b', stripped):
        statement = 'else:'
    elif re.match(r'except\b', stripped):
        statement = 'except Exception:'
    elif re.match(r'finally\b', stripped):
        statement = 'finally:'
    elif re.match(r'try\b', stripped):
        statement = 'try:'
    elif re.match(r'match\b', stripped):
        statement = 'match None:'
    elif re.match(r'case\b', stripped):
        statement = 'case _:'
    elif re.match(r'if\b|while\b', stripped):
        statement = 'if True:'
    else:
        statement = 'pass'

    return indent + statement + ending


def _neutral_line(line):
    """Fallback for a synthetic block header that is invalid in its context."""
    ending = _line_ending(line)
    content = line[:-len(ending)] if ending else line
    indent = content[:len(content) - len(content.lstrip(' \t'))]
    return indent + 'pass' + ending


def _binding_names(fragment):
    """Return identifier-shaped names from a binding-only source fragment."""
    return set(re.findall(r'\b[A-Za-z_]\w*\b', fragment))


def _possible_bindings_on(line):
    """Return names a removed statement could have introduced.

    Adding every identifier from an unparseable line to the defined-name set hides
    real errors later in the file. Only binding positions are uncertain: assignment
    targets, declarations, loop targets, aliases and exception names.
    """
    content = line.split('#', 1)[0].strip()
    bindings = set()

    declaration = re.match(r'(?:async\s+)?def\s+([A-Za-z_]\w*)', content)
    if declaration:
        bindings.add(declaration.group(1))
        parameters = re.search(r'\((.*)', content)
        if parameters:
            bindings.update(_binding_names(parameters.group(1)))
        return bindings

    class_declaration = re.match(r'class\s+([A-Za-z_]\w*)', content)
    if class_declaration:
        bindings.add(class_declaration.group(1))
        return bindings

    loop = re.match(r'(?:async\s+)?for\s+(.+?)\s+in\b', content)
    if loop:
        bindings.update(_binding_names(loop.group(1)))

    exception_alias = re.search(r'\bexcept\b.*?\bas\s+([A-Za-z_]\w*)', content)
    if exception_alias:
        bindings.add(exception_alias.group(1))

    if re.match(r'(?:async\s+)?with\b', content):
        bindings.update(re.findall(r'\bas\s+([A-Za-z_]\w*)', content))

    imported = re.match(r'import\s+(.+)', content)
    if imported:
        for item in imported.group(1).split(','):
            alias = re.search(r'\bas\s+([A-Za-z_]\w*)', item)
            module = re.match(r'\s*([A-Za-z_]\w*)', item)
            if alias or module:
                bindings.add((alias or module).group(1))

    imported_from = re.match(r'from\s+.+?\s+import\s+(.+)', content)
    if imported_from:
        for item in imported_from.group(1).split(','):
            alias = re.search(r'\bas\s+([A-Za-z_]\w*)', item)
            name = re.match(r'\s*([A-Za-z_]\w*)', item)
            if alias or name:
                bindings.add((alias or name).group(1))

    assignment = re.search(r'(?<![=!<>:])=(?!=)', content)
    if assignment:
        target = content[:assignment.start()]
        if '(' not in target and '[' not in target and '{' not in target:
            bindings.update(_binding_names(target))

    bindings.update(re.findall(r'\b([A-Za-z_]\w*)\s*:=', content))
    return bindings


def _syntax_problem(exc, lines, line=None):
    line = line or exc.lineno or 1
    source = _source_line(lines, line)
    return {
        'line': line,
        'col': exc.offset or max(1, len(source) + 1),
        'msg': '%s: %s' % (type(exc).__name__, exc.msg or 'invalid syntax'),
        'text': source,
        'kind': 'syntax',
    }


def _recovery_target(exc, recovered, reported_line):
    """Find the statement that caused an error reported on a later line."""
    message = exc.msg or ''
    block_line = re.search(r'expected an indented block .* on line (\d+)', message)
    if block_line:
        return min(max(1, int(block_line.group(1))), len(recovered))

    if "expected 'except' or 'finally' block" in message:
        for line_number in range(reported_line - 1, 0, -1):
            if re.match(r'^\s*try\b', recovered[line_number - 1]):
                return line_number

    return reported_line


def _parse_with_recovery(source, lines):
    """Return a best-effort AST plus every independent parser error found.

    Recovery is bounded by both the file size and MAX_ERRORS. Each attempt changes at
    least one previously untouched line, so malformed input cannot loop or turn a
    live check into expensive work. Lines are replaced in place, never inserted or
    removed, which keeps all later AST locations aligned with the editor.
    """
    recovered = source.splitlines(keepends=True)
    if not recovered and source:
        recovered = [source]

    syntax_problems = []
    repaired = set()
    uncertain_names = set()
    attempts = min(max(1, len(recovered) * 2), MAX_ERRORS * 2)

    for _attempt in range(attempts):
        try:
            return ast.parse(''.join(recovered)), syntax_problems, uncertain_names
        except SyntaxError as exc:
            if not recovered:
                syntax_problems.append(_syntax_problem(exc, lines))
                return None, syntax_problems, uncertain_names

            reported_line = min(max(1, exc.lineno or 1), len(recovered))
            target_line = _recovery_target(exc, recovered, reported_line)
            end_line = target_line
            if target_line == reported_line:
                reported_end = getattr(exc, 'end_lineno', None) or reported_line
                end_line = min(max(target_line, reported_end), len(recovered))

            artificial_indent = (
                isinstance(exc, IndentationError)
                and 'unexpected indent' in str(exc)
                and any(line < target_line for line in repaired)
            )
            recovery_backtrack = any(line > target_line for line in repaired)
            if (
                target_line not in repaired
                and not artificial_indent
                and not recovery_backtrack
                and len(syntax_problems) < MAX_ERRORS
            ):
                syntax_problems.append(_syntax_problem(exc, lines, target_line))

            changed = False
            for line_number in range(target_line, end_line + 1):
                if line_number in repaired:
                    continue
                original = recovered[line_number - 1]
                uncertain_names.update(_possible_bindings_on(original))
                recovered[line_number - 1] = (
                    _recovery_line(original, exc)
                    if line_number == target_line
                    else _line_ending(original)
                )
                repaired.add(line_number)
                changed = True

            if changed:
                continue

            # A context-sensitive replacement such as `else:` or `except Exception:`
            # can still be invalid when its matching block is the malformed part.
            # Downgrade that synthetic header before touching any unrelated line.
            current = recovered[target_line - 1]
            neutral = _neutral_line(current)
            if current.strip() and current != neutral:
                recovered[target_line - 1] = neutral
                continue

            # The parser can point at an already repaired line when the real cause is
            # an earlier multi-line statement. Expand backwards to the nearest
            # untouched source line, then forwards only if nothing precedes it.
            candidates = list(range(target_line - 1, 0, -1))
            candidates.extend(range(target_line + 1, len(recovered) + 1))
            candidate = next((line for line in candidates if line not in repaired), None)
            if candidate is None:
                break

            original = recovered[candidate - 1]
            uncertain_names.update(_possible_bindings_on(original))
            recovered[candidate - 1] = _recovery_line(original)
            repaired.add(candidate)
        except Exception:
            return None, syntax_problems, uncertain_names

    return None, syntax_problems, uncertain_names


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
    tree, syntax_problems, uncertain_names = _parse_with_recovery(source, lines)
    if tree is None:
        print(json.dumps(syntax_problems[:MAX_ERRORS]))
        return 1 if syntax_problems else 0

    # ── 2. Security check (AST only: imports and calls that really happen) ──
    # Runs before the name check so a blocked program reports why it was
    # refused, instead of a confusing NameError further down the file.
    try:
        blocked = _security_problems(tree, lines)
    except Exception:
        blocked = []          # fail-open: the regex gate in server.mjs still ran
    if blocked:
        print(json.dumps(blocked))
        return 1

    # ── 3. Undefined-name check (skipped for dynamic/ambiguous code) ────────
    try:
        if _should_bail(tree):
            print(json.dumps(syntax_problems[:MAX_ERRORS]))
            return 1 if syntax_problems else 0

        defined, loaded = _collect(tree)
        # A removed statement might have introduced a binding. Preserve only names
        # found in binding positions so recovery avoids cascades without hiding the
        # same undefined receiver or expression on a later valid line.
        defined.update(uncertain_names)

        errors = list(syntax_problems)
        for name, line, col in loaded:
            if name in defined:
                continue
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
