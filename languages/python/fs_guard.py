# ─── Filesystem guard for Browser Coder (Python) ────────────────────────────
# Confines every file the student's program opens to the run's own workspace
# directory, and then allows file I/O freely inside it.
#
# ## Why this exists
#
# `open()` used to be refused outright. That removed a whole standard topic from
# the curriculum - "read a file and count the words" could not run - and the
# justification for it did not survive checking.
#
# The stated justification was that the container already contains everything:
# the network is unreachable, the root filesystem is read-only, capabilities are
# dropped. All true, and none of it addresses the actual risk, which is *other
# students*. Every job runs as the same operating-system user (uid 1001), so the
# `0700` mode on a job directory grants nothing between jobs - a program could
# list the job root and read another student's source and output while it ran.
# Measured in the production image, not assumed:
#
#     $ su-exec app:app ls /tmp/root
#     job-run-attacker
#     job-run-victim
#     $ su-exec app:app cat /tmp/root/job-run-victim/main.py
#     SECRET homework by another student
#
# So the blocklist was load-bearing after all, and simply deleting `open` from it
# would have opened a real hole. What was wrong was the *shape* of the rule:
# "no files at all" instead of "your own files only".
#
# ## What this guarantees, and what it does not
#
# Every path is resolved with realpath - which follows symlinks and collapses
# `..` - and must land inside the workspace root. Opening by file descriptor and
# passing a custom `opener` are both refused, since each would sidestep the path
# check entirely.
#
# This is enforced by the interpreter, so it is a boundary against mistakes and
# casual probing, NOT against an attacker with arbitrary code execution: reaching
# the unwrapped builtin through function internals would defeat it. Those routes
# (`os`, `ctypes`, `__class__`, `__globals__`, …) remain blocked by the AST pass
# in preflight.py, which is what makes the pair meaningful. The genuinely strong
# fix is one uid per job; that is recorded as not done.
#
# Installed from the bootstrap, before the student's module is loaded, so nothing
# here appears in their namespace and no traceback line numbers shift.


def _install_fs_guard():
    import builtins as _builtins
    import io as _io
    import os as _os

    # The server sets this to the job directory. Falling back to the working
    # directory is safe because the pipeline always launches with cwd set to that
    # same directory - but the variable is preferred, since a program could in
    # principle change directory before opening something.
    _root = _os.environ.get('BROWSER_CODER_WORKSPACE') or _os.getcwd()
    _root = _os.path.realpath(_root)

    _real_open = _builtins.open
    _real_io_open = _io.open
    _real_file_io = _io.FileIO

    _DENIED = (
        'PermissionError: %s is outside your project folder.\n'
        'Browser Coder can only open files that live in your own workspace. '
        'Use a plain file name like "data.txt", or a path inside a folder you '
        'created, such as "notes/data.txt".'
    )

    def _describe(target):
        text = repr(target)
        return text if len(text) <= 120 else text[:117] + '...'

    def _checked_path(target):
        """Resolve `target` against the workspace, or raise PermissionError."""
        # A raw file descriptor carries no path, so there is nothing to check and
        # nothing that makes it necessary for a student program.
        if isinstance(target, int):
            raise PermissionError(
                'PermissionError: opening a file by number is not available in '
                'Browser Coder. Open it by name instead.'
            )

        # PathLike (including pathlib.Path) and bytes both become str.
        try:
            target = _os.fspath(target)
        except TypeError:
            raise TypeError('invalid file: %s' % _describe(target))

        if isinstance(target, bytes):
            try:
                target = target.decode('utf-8')
            except UnicodeDecodeError:
                raise PermissionError(_DENIED % _describe(target))

        # realpath after joining: this is what collapses "..", follows symlinks,
        # and turns a relative name into the file that would really be touched.
        resolved = _os.path.realpath(_os.path.join(_root, target))

        if resolved != _root and not resolved.startswith(_root + _os.sep):
            raise PermissionError(_DENIED % _describe(target))

        return resolved

    def open(file, mode='r', buffering=-1, encoding=None, errors=None,
             newline=None, closefd=True, opener=None):
        """`open`, restricted to the student's own workspace."""
        # `opener` receives the path and returns a descriptor, so a custom one
        # can open anything it likes regardless of the check above.
        if opener is not None:
            raise PermissionError(
                'PermissionError: a custom opener is not available in Browser Coder.'
            )
        # closefd=False is only meaningful for a descriptor, which is refused.
        if not closefd:
            raise PermissionError(
                'PermissionError: closefd=False is not available in Browser Coder.'
            )
        return _real_open(
            _checked_path(file), mode, buffering, encoding, errors, newline,
        )

    class FileIO(_real_file_io):
        """Raw file access, restricted the same way.

        `io.FileIO` reaches the operating system without going through `open`, so
        leaving it unwrapped would leave the whole check optional.
        """

        def __init__(self, file, mode='r', closefd=True, opener=None):
            if opener is not None or not closefd:
                raise PermissionError(
                    'PermissionError: that form of file access is not available '
                    'in Browser Coder.'
                )
            _real_file_io.__init__(self, _checked_path(file), mode)

    # Both names, because `io.open` IS the builtin `open` and code reaches it by
    # either route - including the standard library itself.
    _builtins.open = open
    _io.open = open
    _io.FileIO = FileIO


_install_fs_guard()
del _install_fs_guard
