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
