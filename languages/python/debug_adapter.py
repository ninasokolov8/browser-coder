# ─── Python debug adapter for Browser Coder ─────────────────────────────────
#
# Real breakpoint debugging: set breakpoints, run, stop on a line, inspect
# variables, walk the call stack, step over/into/out, continue, and stop.
#
# ## Why bdb and not debugpy
#
# `bdb` is in the standard library. `debugpy` is not installed in the production
# image and there is no pip in it, so using debugpy means a Dockerfile change, a
# larger image, and a dependency whose wire protocol (DAP) is far larger than
# anything this IDE surfaces. `bdb` is what pdb itself is built on: it provides
# exactly the primitives needed - a trace hook, breakpoint bookkeeping, and the
# stepping state machine - and nothing else.
#
# The cost is that the protocol here is ours. It is deliberately tiny: six commands
# in, five events out, one JSON object per line.
#
# ## Transport
#
# A loopback TCP connection back to the server, inside the same container. Chosen
# over extra file descriptors because Node's support for fds above 2 is unreliable
# on Windows, where development happens; and over a Unix socket for the same reason.
# The container's network is `internal: true`, but loopback is unaffected by that.
#
# A per-session token is sent as the first frame. It does not defend against the
# student's own program - which can read the same environment variable - and is not
# meant to: impersonating your own debugger only confuses your own UI. It defends
# against a *different* session's program connecting to the wrong port, which the
# server would otherwise have no way to detect.
#
# ## What the student's program can see
#
# Nothing, by design. The adapter never writes to stdout or stderr, so the program's
# own output is exactly what it would be without a debugger attached. Standard input
# still reaches the program, so a debugged program can call `input()`.

import bdb
import json
import os
import queue
import socket
import sys
import threading

MAX_STRING = 200
MAX_ITEMS = 100
MAX_DEPTH = 3


def _describe(value, depth=0):
    """A short, safe, JSON-encodable rendering of one value.

    Never calls a user-defined __repr__ more than once, and never lets one raise
    out of the debugger: a broken __repr__ in student code must not kill the
    session, it must show as an unreadable value.
    """
    try:
        if value is None or isinstance(value, (bool, int, float)):
            return {'text': repr(value), 'type': type(value).__name__}

        if isinstance(value, str):
            text = value if len(value) <= MAX_STRING else value[:MAX_STRING] + '...'
            return {'text': repr(text), 'type': 'str', 'length': len(value)}

        if isinstance(value, (list, tuple, set, frozenset)):
            name = type(value).__name__
            if depth >= MAX_DEPTH:
                return {'text': '%s(%d items)' % (name, len(value)), 'type': name,
                        'length': len(value)}
            items = list(value)[:MAX_ITEMS]
            children = [
                {'name': str(index), 'value': _describe(item, depth + 1)}
                for index, item in enumerate(items)
            ]
            return {'text': '%s(%d items)' % (name, len(value)), 'type': name,
                    'length': len(value), 'children': children}

        if isinstance(value, dict):
            if depth >= MAX_DEPTH:
                return {'text': 'dict(%d keys)' % len(value), 'type': 'dict',
                        'length': len(value)}
            children = []
            for index, (key, item) in enumerate(value.items()):
                if index >= MAX_ITEMS:
                    break
                children.append({'name': repr(key), 'value': _describe(item, depth + 1)})
            return {'text': 'dict(%d keys)' % len(value), 'type': 'dict',
                    'length': len(value), 'children': children}

        text = repr(value)
        if len(text) > MAX_STRING:
            text = text[:MAX_STRING] + '...'
        return {'text': text, 'type': type(value).__name__}

    except Exception as error:                                  # noqa: BLE001
        # A student's __repr__ can raise anything at all.
        return {'text': '<unreadable: %s>' % type(error).__name__,
                'type': 'unknown'}


class _Channel:
    """One JSON object per line, over a socket.

    ## Why a reader thread

    The obvious design - read a command only when the program is paused - is broken
    in a way that is invisible until you try it. While the program runs, nothing
    reads the socket, so a command sent mid-run sits in the kernel buffer until the
    next pause. That makes two things the UI must offer silently impossible:

      - adding a breakpoint while the program is running (it would only take effect
        at the next stop, which is exactly the stop it was supposed to cause)
      - the Stop button, on a program that is looping and never pauses

    So one thread owns reading. Commands that must act immediately, whatever the
    program is doing, are dispatched straight from that thread. The rest are queued
    for the paused frame to consume, because they need a frame to act on.
    """

    #: Handled the moment they arrive, running or paused.
    IMMEDIATE = ('setBreakpoints', 'stop')

    def __init__(self, sock, token):
        self._sock = sock
        self._buffer = b''
        self._send_lock = threading.Lock()
        self._queue = queue.Queue()
        self._closed = threading.Event()
        self._immediate_handler = None
        self._reader = None
        self.send({'type': 'hello', 'token': token, 'pid': os.getpid()})

    def start_reading(self, immediate_handler):
        """Install the handler and only THEN begin reading.

        Not done in the constructor, and the ordering is load-bearing. `hello` is
        sent from the constructor, so a fast client replies immediately - and if the
        reader thread were already running it would consume that first
        `setBreakpoints` while `_immediate_handler` was still None, queue it instead
        of applying it, and the paused frame would later reject it as an unknown
        command. The breakpoint would silently never arm.

        That is exactly what happened: the standalone probe was slow enough to win
        the race, and the contract tests were fast enough to lose it.
        """
        self._immediate_handler = immediate_handler
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def send(self, payload):
        line = (json.dumps(payload, default=str) + '\n').encode('utf-8')
        with self._send_lock:
            try:
                self._sock.sendall(line)
            except OSError:
                # The server has gone. Nothing useful to do; the process will be
                # torn down with the session.
                pass

    def _read_loop(self):
        while not self._closed.is_set():
            while b'\n' not in self._buffer:
                try:
                    chunk = self._sock.recv(65536)
                except OSError:
                    chunk = b''
                if not chunk:
                    self._closed.set()
                    # Unblock a paused frame waiting for a command.
                    self._queue.put(None)
                    return
                self._buffer += chunk

            line, self._buffer = self._buffer.split(b'\n', 1)
            try:
                command = json.loads(line.decode('utf-8'))
            except ValueError:
                # A malformed frame is skipped rather than fatal.
                continue

            if command.get('command') in self.IMMEDIATE and self._immediate_handler:
                try:
                    self._immediate_handler(command)
                except Exception as error:                      # noqa: BLE001
                    # An immediate handler must never take the reader thread with
                    # it, or the session goes deaf.
                    self.send({'type': 'error', 'message': 'command failed: %s' % error})
                continue

            self._queue.put(command)

    def receive(self):
        """Block for the next queued command, or None when the connection closes."""
        if self._closed.is_set() and self._queue.empty():
            return None
        return self._queue.get()

    def unblock(self):
        """Wake a paused frame that is waiting for a command.

        `set_quit` alone is not enough to stop a PAUSED program. `quitting` is read by
        the trace function on the running thread, and that thread is blocked in
        `_pause` waiting on this queue - so it never returns to the trace function to
        notice. Stop therefore worked on a looping program and hung on a paused one,
        which is the more common case by far.

        A None frame is what `_pause` already treats as "the channel has gone": it
        quits and returns. Reusing that path rather than adding a second one.
        """
        self._queue.put(None)

    def close(self):
        self._closed.set()


class BrowserCoderDebugger(bdb.Bdb):
    """The trace hook, wired to the channel."""

    def __init__(self, channel, program_path):
        bdb.Bdb.__init__(self)
        self._channel = channel
        self._program_path = os.path.realpath(program_path)
        self._workspace = os.path.dirname(self._program_path)
        self._frames = []
        self._running = True
        # bdb stops on the FIRST line of the program, which is what pdb wants - it
        # drops you at a prompt. The IDE's contract is the opposite: "Start
        # debugging" runs to the first breakpoint, and stopping on line 1 every time
        # reads as a bug. Tracked here so that first stop can be waved through.
        self._entered = False

    # ── bdb only reports frames we admit to owning ──────────────────────────
    #
    # Without this the debugger stops inside the standard library and inside its own
    # bootstrap, which for a student is indistinguishable from the IDE breaking.
    def is_our_file(self, filename):
        if not filename:
            return False
        try:
            resolved = os.path.realpath(filename)
        except OSError:
            return False
        if resolved.startswith('<'):
            return False
        return resolved == self._program_path or resolved.startswith(self._workspace + os.sep)

    # ── bdb hooks ───────────────────────────────────────────────────────────

    def _continue_keeping_trace(self):
        """Resume, but keep the trace function installed.

        Deliberately NOT `bdb.set_continue`. That one removes the trace function
        entirely when no breakpoints are set:

            if not self.breaks:
                sys.settrace(None)

        which is a sound optimisation for pdb and wrong here: a breakpoint the
        student adds while the program is running would then have no effect at all,
        silently. Keeping the trace installed costs speed and buys a debugger that
        behaves the way the UI implies.

        It does NOT preserve stop-on-exception, which an earlier version of this
        comment claimed. `stop_here` returns False once `stoplineno` is -1:

            if frame is self.stopframe:
                if self.stoplineno == -1:
                    return False

        and `dispatch_exception` consults `stop_here` before calling
        `user_exception`, so a running program's exceptions are never reported
        through that path. Stopping where the program broke is handled by
        `report_post_mortem` instead, off the traceback, after the fact.
        """
        self._set_stopinfo(self.botframe, None, -1)

    def report_post_mortem(self, exc_type, exc_value, traceback_object):
        """Report an uncaught exception at the frame that raised it.

        This is the behaviour worth the most to a beginner, and the one bdb's own
        machinery cannot give directly. Stopping at the raise point during tracing
        would mean stopping on EVERY raised exception, including ones a `try` block
        goes on to handle - noise that teaches students to ignore the debugger.

        A traceback keeps its frames alive, so after the program has failed the
        deepest frame's locals are still exactly what they were when it broke. That
        is the same information, obtained without guessing whether an exception was
        going to be handled.

        Returns once the UI acknowledges. Stepping is meaningless here - the program
        is over - so only `continue` and `stop` are honoured.
        """
        # Walk to the DEEPEST frame that belongs to the student. The deepest frame
        # overall may be inside the standard library, which is not where their
        # mistake is.
        chosen = None
        stack = []
        current = traceback_object
        while current is not None:
            frame = current.tb_frame
            if self.is_our_file(frame.f_code.co_filename):
                chosen = (frame, current.tb_lineno)
                stack.append({
                    'name': frame.f_code.co_name if frame.f_code.co_name != '<module>'
                            else '(module)',
                    'file': os.path.basename(frame.f_code.co_filename),
                    'line': current.tb_lineno,
                })
            current = current.tb_next

        if chosen is None:
            return

        frame, lineno = chosen
        event = {
            'type': 'stopped',
            'reason': 'exception',
            'file': os.path.basename(frame.f_code.co_filename),
            'line': lineno,
            # Innermost first, matching the live `stopped` events.
            'stack': list(reversed(stack)),
            'exception': {
                'type': getattr(exc_type, '__name__', str(exc_type)),
                'message': str(exc_value),
            },
            'postMortem': True,
        }
        event.update(self._variables(frame))
        self._channel.send(event)

        while True:
            command = self._channel.receive()
            if command is None:
                return
            action = command.get('command')
            if action in ('continue', 'stop', None):
                return
            if action == 'evaluate':
                self._evaluate(frame, command.get('expression') or '')
                continue
            # Stepping a finished program cannot do anything; say so rather than
            # appearing to hang.
            self._channel.send({
                'type': 'error',
                'message': 'the program has already stopped; %s is not available' % action,
            })

    def user_line(self, frame):
        if not self.is_our_file(frame.f_code.co_filename):
            # Not the student's code: keep going rather than surfacing it.
            self.set_step()
            return

        if not self._entered:
            self._entered = True
            # Wave through bdb's stop on the program's first line, unless the student
            # actually put a breakpoint there.
            filename = os.path.realpath(frame.f_code.co_filename)
            if not self.get_break(filename, frame.f_lineno):
                self._continue_keeping_trace()
                return

        self._pause(frame, 'step')

    def user_call(self, frame, argument_list):
        if not self.is_our_file(frame.f_code.co_filename):
            return
        if self.stop_here(frame):
            self._pause(frame, 'call')

    def user_return(self, frame, return_value):
        if not self.is_our_file(frame.f_code.co_filename):
            return
        if self.stop_here(frame):
            self._pause(frame, 'return')

    def user_exception(self, frame, exc_info):
        """Stop on an unhandled exception, at the line that raised it.

        This is the single most useful debugger behaviour for a beginner and the
        one pdb makes hardest to reach: the program stops where it broke, with every
        local variable still inspectable, instead of printing a traceback after the
        state is gone.
        """
        if not self.is_our_file(frame.f_code.co_filename):
            return
        exc_type, exc_value = exc_info[0], exc_info[1]
        self._pause(frame, 'exception', extra={
            'exception': {
                'type': getattr(exc_type, '__name__', str(exc_type)),
                'message': str(exc_value),
            },
        })

    # ── pausing and resuming ────────────────────────────────────────────────

    def _stack_frames(self, frame):
        """The student's frames, innermost first."""
        out = []
        current = frame
        while current is not None:
            if self.is_our_file(current.f_code.co_filename):
                out.append({
                    'name': current.f_code.co_name if current.f_code.co_name != '<module>'
                            else '(module)',
                    'file': os.path.basename(current.f_code.co_filename),
                    'line': current.f_lineno,
                })
            current = current.f_back
        return out

    # Things that are code, not data. A student inspecting variables is looking for
    # their list and their counter, and every imported module and defined function
    # sitting in the same list pushes those off the panel.
    _NOISE_TYPES = (
        'module', 'function', 'builtin_function_or_method', 'method',
        'type', 'classmethod', 'staticmethod', '_SpecialForm',
    )

    def _collect(self, mapping):
        out = []
        for name, value in list(mapping.items()):
            # Dunder entries are interpreter bookkeeping, not the student's data.
            if name.startswith('__') and name.endswith('__'):
                continue
            if type(value).__name__ in self._NOISE_TYPES:
                continue
            out.append({'name': name, 'value': _describe(value)})
        return out

    def _variables(self, frame):
        # At module level `f_globals is f_locals` - the module's variables ARE the
        # module frame's locals. Reporting both would list every name twice, so
        # `globals` is populated only when the two really differ, i.e. inside a
        # function.
        locals_out = self._collect(frame.f_locals)
        globals_out = (
            self._collect(frame.f_globals) if frame.f_globals is not frame.f_locals else []
        )
        return {'locals': locals_out, 'globals': globals_out}

    def _pause(self, frame, reason, extra=None):
        """Report the stop, then block on the channel until told to resume."""
        event = {
            'type': 'stopped',
            'reason': reason,
            'file': os.path.basename(frame.f_code.co_filename),
            'line': frame.f_lineno,
            'stack': self._stack_frames(frame),
        }
        event.update(self._variables(frame))
        if extra:
            event.update(extra)
        self._channel.send(event)

        while True:
            command = self._channel.receive()
            if command is None:
                # Channel closed: stop tracing and let the program finish rather
                # than leaving it frozen forever.
                self.set_quit()
                return

            action = command.get('command')

            if action == 'continue':
                # Not set_continue: see _continue_keeping_trace.
                self._continue_keeping_trace()
                return
            if action == 'next':
                self.set_next(frame)
                return
            if action == 'stepIn':
                self.set_step()
                return
            if action == 'stepOut':
                self.set_return(frame)
                return
            # `stop` and `setBreakpoints` never reach here: the channel's reader
            # thread handles both the moment they arrive, so they work while the
            # program is running too.
            if action == 'evaluate':
                self._evaluate(frame, command.get('expression') or '')
                continue

            # An unknown command must not silently resume the program - that would
            # look like a spontaneous continue.
            self._channel.send({'type': 'error', 'message': 'unknown command: %s' % action})

    def _resolve_in_workspace(self, relative_path):
        """Absolute path for a workspace-relative one, or None if it escapes.

        The server has already validated the path, but this is the process that
        actually opens files - so it checks again rather than trusting a value that
        arrived over a socket. Same reasoning as fs_guard.py.
        """
        candidate = os.path.realpath(os.path.join(self._workspace, relative_path))
        if candidate == self._workspace or candidate.startswith(self._workspace + os.sep):
            return candidate
        return None

    def apply_breakpoints(self, lines, files=None):
        """Replace the breakpoint set across every file it names.

        `lines` alone means the entry file and is the shape the first version of this
        spoke. `files` maps a workspace-relative path to its lines, which is what lets
        a student stop inside a module they imported - bdb has always supported a
        breakpoint in any file, and only this method was hardcoded to one.
        """
        self.clear_all_breaks()

        wanted = {}
        if lines:
            wanted[self._program_path] = list(lines)

        for relative_path, file_lines in (files or {}).items():
            resolved = self._resolve_in_workspace(relative_path)
            if resolved is None:
                continue
            wanted.setdefault(resolved, []).extend(file_lines or [])

        accepted_by_path = {}
        for absolute, file_lines in wanted.items():
            armed = []
            for line in file_lines:
                try:
                    # set_break returns an error STRING on failure, not an exception,
                    # and returns None on success - the opposite of the usual
                    # convention, which is easy to get backwards.
                    problem = self.set_break(absolute, int(line))
                except (TypeError, ValueError):
                    problem = 'not a line number'
                if problem is None:
                    armed.append(int(line))
            if armed:
                accepted_by_path[self._relative_to_workspace(absolute)] = sorted(armed)

        # `lines` is still reported for the entry file, so a client that only
        # understands the first shape keeps working.
        entry_relative = self._relative_to_workspace(self._program_path)
        self._channel.send({
            'type': 'breakpoints',
            'lines': accepted_by_path.get(entry_relative, []),
            'files': accepted_by_path,
        })

    def _relative_to_workspace(self, absolute):
        """The path as the IDE knows it: relative, with forward slashes."""
        try:
            return os.path.relpath(absolute, self._workspace).replace(os.sep, '/')
        except ValueError:
            return os.path.basename(absolute)

    def _evaluate(self, frame, expression):
        """Evaluate an expression in the paused frame, for a watch or hover."""
        if not expression.strip():
            self._channel.send({'type': 'evaluated', 'expression': expression,
                                'error': 'empty expression'})
            return
        try:
            value = eval(expression, frame.f_globals, frame.f_locals)   # noqa: S307
            self._channel.send({'type': 'evaluated', 'expression': expression,
                                'value': _describe(value)})
        except Exception as error:                                       # noqa: BLE001
            # Evaluating in a paused frame is entirely under the student's control,
            # and a failure is information rather than a fault.
            self._channel.send({'type': 'evaluated', 'expression': expression,
                                'error': '%s: %s' % (type(error).__name__, error)})


def _print_user_traceback(exc_type, exc_value, traceback_object, program):
    """Print the traceback the student would see with no debugger attached.

    Every frame from this file and from `bdb` is dropped. What remains is their own
    program, so a crash under the debugger reads exactly like a crash without it.
    """
    import traceback as traceback_module

    program_real = os.path.realpath(program)
    adapter = os.path.realpath(__file__)

    frames = [
        entry for entry in traceback_module.extract_tb(traceback_object)
        if os.path.realpath(entry.filename) != adapter
        and 'bdb.py' not in entry.filename
    ]

    lines = ['Traceback (most recent call last):\n']
    if frames:
        lines.extend(traceback_module.format_list(frames))
    lines.extend(traceback_module.format_exception_only(exc_type, exc_value))

    # The job directory is a temporary path the student never chose; show the file
    # under the name they know it by.
    basename = os.path.basename(program_real)
    text = ''.join(lines).replace(program_real, basename).replace(os.path.dirname(program_real) + os.sep, '')

    sys.stderr.write(text)
    sys.stderr.flush()


def _install_fs_guard_for_debug():
    """Run fs_guard.py in its own namespace, before anything else.

    The guard lives beside this file, so it is found relative to `__file__` rather
    than through an environment variable a program could influence.

    A missing or broken guard raises. The alternative - carrying on unguarded -
    would mean the debugger quietly had filesystem access the Run button does not.
    """
    guard = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fs_guard.py')
    with open(guard, 'r', encoding='utf-8') as handle:
        source = handle.read()
    exec(compile(source, guard, 'exec'), {'__name__': '_bc_fs_guard'})    # noqa: S102


def _add_import_dirs(program):
    """Put the student's own folders on sys.path, deterministically.

    Mirrors `importDirs` in server/languages/adapters/python.mjs: the entry file's
    directory first, then the job root, then every folder beneath it in sorted order.
    Sorted so two runs of the same project resolve an ambiguous import the same way.
    """
    workspace = os.environ.get('BROWSER_CODER_WORKSPACE') or os.path.dirname(program)
    workspace = os.path.realpath(workspace)

    directories = [os.path.dirname(os.path.realpath(program)), workspace]

    nested = []
    for root, folder_names, _files in os.walk(workspace):
        # Never descend into generated output; the run adapter does not either.
        folder_names[:] = sorted(
            name for name in folder_names
            if name not in ('__pycache__', 'node_modules', '.git')
        )
        for name in folder_names:
            nested.append(os.path.join(root, name))
    directories.extend(sorted(nested))

    seen = set()
    ordered = []
    for directory in directories:
        if directory and directory not in seen:
            seen.add(directory)
            ordered.append(directory)

    sys.path[:0] = ordered


def main():
    port = int(os.environ.get('BROWSER_CODER_DEBUG_PORT') or 0)
    token = os.environ.get('BROWSER_CODER_DEBUG_TOKEN') or ''
    program = os.environ.get('BROWSER_CODER_DEBUG_PROGRAM') or ''

    if not port or not program:
        sys.stderr.write('[debugger not configured]\n')
        return 2

    # The program's source, read BEFORE the filesystem guard is installed.
    #
    # Ordering matters and getting it wrong is silent: the guard confines `open` to
    # the workspace, and the adapter loading the file it was told to run is not the
    # student doing I/O. Installed first, the guard refused the adapter's own read,
    # the program never started, and every breakpoint was simply never reached.
    try:
        with open(program, 'r', encoding='utf-8-sig') as handle:
            program_source = handle.read()
    except OSError as error:
        sys.stderr.write('[could not read %s: %s]\n' % (program, error))
        return 2

    # Now confine the program, exactly as the ordinary bootstrap does.
    #
    # Load-bearing: without it a debug run would be LESS confined than a normal run,
    # `open('/etc/passwd')` would work under the debugger and not otherwise, and
    # students would find out which of the two buttons is looser. "Run" and "Debug"
    # must have one security posture.
    _install_fs_guard_for_debug()

    # Make the student's own modules importable, exactly as the ordinary bootstrap
    # does with `sys.path[:0] = importDirs`.
    #
    # This was missing, and it meant a multi-file Python project could not be debugged
    # at all: `from helper import twice` raised ModuleNotFoundError the moment the
    # debugger was attached, while the same program ran fine without it. It went
    # unnoticed because every debug test until now used a single file.
    #
    # The directories are derived here rather than passed in, so the two launches
    # cannot drift: the entry file's own directory, the job root, and every folder
    # beneath it - which is what supports both `from helper import x` and
    # `from pkg.helper import x`.
    _add_import_dirs(program)

    sock = socket.create_connection(('127.0.0.1', port), timeout=10)
    sock.settimeout(None)
    channel = _Channel(sock, token)

    debugger = BrowserCoderDebugger(channel, program)

    started = threading.Event()

    def handle_immediate(command):
        """setBreakpoints and stop, honoured whatever the program is doing."""
        action = command.get('command')
        if action == 'setBreakpoints':
            debugger.apply_breakpoints(command.get('lines') or [], command.get('files') or {})
            started.set()
        elif action == 'stop':
            # Two halves, and both are needed.
            #
            # `quitting` is read by the trace function on the RUNNING thread, so
            # setting it makes a program stuck in a loop raise BdbQuit at its next
            # traced event - the case a paused-only design cannot serve.
            debugger.set_quit()
            # And a program that is PAUSED is blocked on the command queue, not in
            # the trace function, so it would never look at `quitting` at all. This
            # wakes it so it can unwind.
            channel.unblock()

    channel.start_reading(handle_immediate)

    # Wait briefly for an initial breakpoint set, so the student's first breakpoint
    # is armed before line 1 rather than being missed on the first pass. A client
    # that sends nothing must not hang the run, hence the timeout.
    started.wait(timeout=5.0)

    channel.send({'type': 'started'})

    exit_code = 0
    try:
        # runpy would add its own frames; compiling here keeps the stack the
        # student's own, and __name__ == '__main__' so `if __name__` guards run.
        code = compile(program_source, program, 'exec')
        globals_dict = {'__name__': '__main__', '__file__': program, '__builtins__': __builtins__}
        debugger.run(code, globals_dict, globals_dict)
    except bdb.BdbQuit:
        # A deliberate stop from the UI, not a failure.
        exit_code = 0
    except SystemExit as error:
        exit_code = error.code if isinstance(error.code, int) else 0
    except BaseException:                                                # noqa: BLE001
        exc_type, exc_value, tb = sys.exc_info()

        # Stop where it broke, with the variables still inspectable, before the
        # traceback is printed and the state is gone.
        debugger.report_post_mortem(exc_type, exc_value, tb)

        # Then print a traceback that looks like the one they would get WITHOUT a
        # debugger attached. Left unfiltered, the top frames are this adapter's
        # `main` and `bdb.run`, which the student did not write and cannot open -
        # the same problem the turtle shim solves for its own injected lines.
        _print_user_traceback(exc_type, exc_value, tb, program)
        exit_code = 1

    channel.send({'type': 'terminated', 'exitCode': exit_code})
    channel.close()
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    sock.close()
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
