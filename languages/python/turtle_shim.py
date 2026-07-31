# ─── Turtle Shim for Browser Coder ──────────────────────────────────────────
# Replaces the standard `turtle` module (which requires tkinter / a display)
# with a pure-Python renderer that captures every drawing command and, at
# process exit, serialises them to JSON.
#
# Transport: the JSON is written to the path in BROWSER_CODER_GRAPHICS_OUT,
# which the server sets in the sandbox environment and which lives inside the
# run's own private job directory. NOTHING is written to stdout.
#
# That is deliberate and load-bearing. An earlier version printed the output
# path to stdout for the server to read back; since stdout belongs to the
# student's program, any program could name any file and have the service read
# and delete it on its behalf. The server now chooses the path, so there is no
# decision left for a program to influence. It also means a dense drawing is
# never truncated by the 100 KB stdout cap.
#
# Design goals:
#   • Full coverage of the common turtle API (module functions + Turtle class)
#   • Secure: everything is scoped inside _setup_turtle() – no stdlib handles
#     leak into the user's namespace after the function returns
#   • No third-party dependencies; only stdlib (sys, json, math, atexit, os)
# ─────────────────────────────────────────────────────────────────────────────

def _setup_turtle():
    import sys as _sys
    import json as _j
    import math as _m
    import atexit as _ae
    # base64 is needed again, for SVG cursor shapes.
    #
    # It was removed on this branch when the stdout fallback transport went, and the
    # SVG cursor feature - written in parallel on `main` - added three new uses of
    # it. Git merged both sides without a conflict and produced code that raises
    # `NameError: _b64` the first time a program calls `register_shape("x.svg")`.
    # Nothing in a clean merge, a typecheck or a Python parse catches that.
    import base64 as _b64

    # ── Shared drawing list (all turtles write here) ─────────────────────────
    _shapes = []

    # ── Global canvas/screen config (single-element list so closures can mutate)
    _cfg = [{'bg': 'white', 'w': 600, 'h': 600, 'pic': ''}]

    # ── Default cursor styling ────────────────────────────────────────────────
    # Real Python starts with a small black arrowhead, which is easy to miss on
    # a browser canvas. Browser Coder shows a green turtle instead, drawn a bit
    # larger. This is purely how the cursor *looks*: pen and fill colours used
    # for drawing stay black, and the moment the program calls shape(), color()
    # or shapesize() its own choice takes over.
    _DEF_SHAPE     = 'turtle'
    _DEF_CURSOR_FC = 'lightgreen'   # body
    _DEF_CURSOR_PC = 'darkgreen'    # outline
    _DEF_SCALE     = 1.5            # only while shapesize() is untouched

    # ── Default turtle state dict ─────────────────────────────────────────────
    def _new_state():
        return {
            'x': 0.0, 'y': 0.0, 'h': 0.0,   # position + heading (degrees)
            'pd': True,                         # pen down
            'pc': 'black',                      # pen colour
            'fc': 'black',                      # fill colour
            'pw': 1.0,                          # pen width
            'fl': False,                        # currently filling?
            'fp': [],                           # fill path points
            'fi': 0,                            # fill insert index in _shapes
            'vis': True,                        # turtle visible?
            'cu': False,                        # did the program set a colour?
            'sh': _DEF_SHAPE,                   # cursor shape name
            'sw': 1.0, 'sl': 1.0,               # shapesize() stretch (wid, len)
            'ow': 1.0,                          # shape outline width
            'tl': 0.0,                          # tilt angle (degrees)
            'rm': 'noresize',                   # resizemode
        }

    _gs = _new_state()   # global / module-level turtle state

    # ── Animation-support state ─────────────────────────────────────────────
    _arc_mode = [False]  # True inside _circ so penup steps don't spam 'M' shapes
    _tracer   = [1]      # Last tracer(n) value; 0 means "no animation"
    _speed    = [3]      # Last speed(n) value; 0 means instant (real turtle default is 3)

    # ── Colour normaliser ─────────────────────────────────────────────────────
    def _col(c):
        if isinstance(c, str):
            return c
        if isinstance(c, (list, tuple)) and len(c) == 3:
            vals = list(c)
            # Detect float 0-1 range vs int 0-255 range
            if all(isinstance(v, float) and 0.0 <= v <= 1.0 for v in vals):
                vals = [int(v * 255) for v in vals]
            return '#{:02x}{:02x}{:02x}'.format(
                *[max(0, min(255, int(v))) for v in vals])
        return 'black'

    # ── Cursor shape support ─────────────────────────────────────────────────
    # The frontend knows how to draw these by name (same polygons as CPython's
    # turtle module). Anything registered through register_shape() is shipped
    # alongside the drawing data as an explicit polygon.
    _BUILTIN_SHAPES = ('classic', 'arrow', 'turtle', 'circle',
                       'square', 'triangle', 'blank')
    _polys    = {}       # custom polygon shapes: name -> [[x, y], ...]
    _svg_shapes = {}     # SVG cursor shapes: name -> embedded image metadata

    # Must match GRAPHICS_LIMITS.maxSvgBytes in server/graphics/turtle.mjs.
    #
    # The ported version used 12 MB, which base64 inflates to 16 MB - twice the
    # whole graphics channel's 8 MB budget, so a shape anywhere near that size
    # could never be delivered at all. It would have looked like a mysterious
    # "my cursor did not appear" rather than a limit. A cursor icon is a few KB.
    _MAX_SVG_BYTES = 256 * 1024
    _turtles  = []       # states of every Turtle() instance the program made
    _gs_used  = [False]  # did the program actually use the module-level turtle?

    # ── Optional SVG cursor support ──────────────────────────────────────────
    # This is deliberately isolated from the normal polygon/built-in path.
    # When no SVG shape is registered, the shim emits exactly the same payload
    # fields and drawing commands as before.
    def _svg_dimensions(svg_text):
        """Return a small cursor size while preserving the SVG aspect ratio."""
        import re as _re

        viewbox = _re.search(
            r'viewBox\s*=\s*["\']\s*[-+0-9.eE]+\s+[-+0-9.eE]+\s+'
            r'([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*["\']',
            svg_text,
            _re.I,
        )
        if viewbox:
            source_w = max(1.0, float(viewbox.group(1)))
            source_h = max(1.0, float(viewbox.group(2)))
        else:
            width_match = _re.search(
                r'\bwidth\s*=\s*["\']\s*([-+0-9.eE]+)',
                svg_text,
                _re.I,
            )
            height_match = _re.search(
                r'\bheight\s*=\s*["\']\s*([-+0-9.eE]+)',
                svg_text,
                _re.I,
            )
            source_w = max(
                1.0,
                float(width_match.group(1)) if width_match else 42.0,
            )
            source_h = max(
                1.0,
                float(height_match.group(1)) if height_match else 42.0,
            )

        max_side = 42.0
        scale = max_side / max(source_w, source_h)
        return (
            round(max(4.0, source_w * scale), 3),
            round(max(4.0, source_h * scale), 3),
        )

    def _register_svg_source(shape_name, source):
        """Register SVG text/data supplied directly by trusted lesson code.

        This is an additive fallback for sandboxed projects where the SVG is
        visible in the Browser Coder workspace but is not present in Python's
        temporary execution directory.

        Accepted source forms:
          - raw SVG text
          - UTF-8 bytes / bytearray
          - data:image/svg+xml;base64,... URL
          - dict with data/svg/source plus optional w, h and rotate
        """
        if source is None:
            return False

        requested_width = None
        requested_height = None
        rotate = False

        if isinstance(source, dict):
            requested_width = source.get('w', source.get('width'))
            requested_height = source.get('h', source.get('height'))
            rotate = bool(source.get('rotate', False))
            source = source.get(
                'data',
                source.get('svg', source.get('source')),
            )

        if isinstance(source, bytearray):
            source = bytes(source)

        if isinstance(source, bytes):
            try:
                svg_text = source.decode('utf-8-sig')
            except Exception:
                return False
        elif isinstance(source, str):
            value = source.strip()

            if value.lower().startswith('data:image/svg+xml'):
                comma = value.find(',')
                if comma < 0:
                    return False

                header = value[:comma].lower()
                payload = value[comma + 1:]

                if ';base64' not in header:
                    return False

                try:
                    svg_text = _b64.b64decode(payload).decode('utf-8-sig')
                except Exception:
                    return False
            else:
                svg_text = source
        else:
            return False

        encoded_bytes = svg_text.encode('utf-8')

        if (
            len(encoded_bytes) <= 0
            or len(encoded_bytes) > _MAX_SVG_BYTES
            or '<svg' not in svg_text.lower()
        ):
            return False

        width, height = _svg_dimensions(svg_text)

        try:
            if requested_width is not None:
                width = max(2.0, float(requested_width))
            if requested_height is not None:
                height = max(2.0, float(requested_height))
        except Exception:
            return False

        encoded = _b64.b64encode(encoded_bytes).decode('ascii')

        _svg_shapes[shape_name] = {
            'data': 'data:image/svg+xml;base64,' + encoded,
            'w': width,
            'h': height,
            'rotate': rotate,
        }
        return True

    def _register_svg_shape(name, source=None):
        """Register inline SVG data first, then use the existing file path."""
        import os as _os

        shape_name = str(name)
        if not shape_name.lower().endswith('.svg'):
            return False
        if shape_name in _svg_shapes:
            return True

        # NEW: safe inline source path. No file/system access is needed in the
        # student or lesson code.
        if source is not None:
            return _register_svg_source(shape_name, source)

        # Read a local SVG when present in the workspace.
        #
        # Confined to the workspace deliberately. The version this was ported from
        # called `expanduser` and `abspath` on the shape name, so
        # `register_shape("/etc/hosts.svg")` or `register_shape("~/.ssh/id_rsa.svg")`
        # named a real absolute path to try to open.
        #
        # On this branch `open` is already confined by languages/python/fs_guard.py,
        # so those reads FAIL - but `os.path.isfile` and `os.path.getsize` are not
        # guarded, so the candidate loop would still answer "does this file exist?"
        # for any path on the container. That is a small leak, and there is no reason
        # to leave it: a cursor image lives in the student's own project.
        workspace = _os.path.realpath(
            _os.environ.get('BROWSER_CODER_WORKSPACE') or _os.getcwd()
        )

        candidates = []

        def _candidate(path):
            if not path:
                return
            try:
                absolute = _os.path.realpath(path)
            except OSError:
                return
            # realpath first, so a symlink or `..` cannot step outside.
            if absolute != workspace and not absolute.startswith(workspace + _os.sep):
                return
            if absolute not in candidates:
                candidates.append(absolute)

        # A name with a drive letter, a leading separator or a `~` is not a
        # workspace-relative file name and is not treated as one.
        if not _os.path.isabs(shape_name) and not shape_name.startswith('~'):
            _candidate(_os.path.join(workspace, shape_name))
            _candidate(_os.path.join(_os.getcwd(), shape_name))
            try:
                script_dir = _os.path.dirname(_os.path.abspath(_sys.argv[0]))
                _candidate(_os.path.join(script_dir, shape_name))
            except Exception:
                pass

            # Browser Coder already adds project folders to sys.path.
            # Check those exact locations without a recursive filesystem scan.
            for import_dir in _sys.path:
                if isinstance(import_dir, str) and import_dir:
                    _candidate(_os.path.join(import_dir, shape_name))

        max_svg_bytes = _MAX_SVG_BYTES

        for candidate in candidates:
            try:
                if not _os.path.isfile(candidate):
                    continue
                size = _os.path.getsize(candidate)
                if size <= 0 or size > max_svg_bytes:
                    continue

                with open(candidate, 'rb') as handle:
                    raw = handle.read(max_svg_bytes + 1)
                if len(raw) > max_svg_bytes:
                    continue

                svg_text = raw.decode('utf-8-sig')
                if '<svg' not in svg_text.lower():
                    continue

                width, height = _svg_dimensions(svg_text)
                encoded = _b64.b64encode(
                    svg_text.encode('utf-8')
                ).decode('ascii')

                _svg_shapes[shape_name] = {
                    'data': 'data:image/svg+xml;base64,' + encoded,
                    'w': width,
                    'h': height,
                    # Photo/avatar SVG cursors stay upright while the logical
                    # turtle heading still controls movement.
                    'rotate': False,
                }
                return True
            except Exception:
                continue

        return False

    def _eff(s):
        """Stretch factors actually applied to the cursor polygon."""
        if s['rm'] == 'auto':
            l = max(1.0, s['pw'] / 5.0)
            return l, l
        if s['rm'] == 'user':                # shapesize() was called
            return s['sw'], s['sl']
        return _DEF_SCALE, _DEF_SCALE        # 'noresize' → readable default

    def _look(s):
        """Everything the renderer needs to draw this turtle's cursor."""
        sw, sl = _eff(s)
        # Drawing colours are black by default; the cursor is green until the
        # program picks its own colours, and then it follows them exactly.
        fc = s['fc'] if s['cu'] else _DEF_CURSOR_FC
        pc = s['pc'] if s['cu'] else _DEF_CURSOR_PC
        return {
            'sh': s['sh'], 'fc': fc, 'pc': pc,
            'sw': round(sw, 3), 'sl': round(sl, 3),
            'ow': round(s['ow'], 2), 'tl': round(s['tl'] % 360.0, 2),
        }

    def _app_data(s):
        d = _look(s)
        d['k'] = 'SH'
        return d

    _last_app = [None]

    def _app(s):
        """Record a change to the cursor's appearance (shape/colour/size/tilt).

        Only actual changes are emitted: the renderer carries one live cursor,
        so re-stating the current look would just bloat the command list.
        """
        if s is _gs:
            _gs_used[0] = True
        if _tracer[0] == 0:
            return           # instant draw — only the final look matters
        d = _app_data(s)
        if d == _last_app[0]:
            return
        _last_app[0] = d
        if _shapes and _shapes[-1].get('k') == 'SH':
            _shapes[-1] = d  # nothing was drawn since the last change
        else:
            _shapes.append(d)

    _last_app[0] = _app_data(_gs)   # renderer starts from the default look

    def _cur(s):
        """Full cursor state, used to place turtles once drawing is finished."""
        c = _look(s)
        c['x']   = round(s['x'], 2)
        c['y']   = round(s['y'], 2)
        c['h']   = round(s['h'], 2)
        c['vis'] = s['vis']
        return c

    # ── Shape / size / tilt setters (shared by module functions and Turtle) ──
    def _set_shape(s, name=None):
        if name is not None:
            n = str(name)
            if n.lower().endswith('.svg') and n not in _svg_shapes:
                _register_svg_shape(n)
            if n in _polys or n in _svg_shapes:
                s['sh'] = n
                _app(s)
            elif n.lower() in _BUILTIN_SHAPES:
                s['sh'] = n.lower()
                _app(s)
        return s['sh']

    def _set_size(s, stretch_wid=None, stretch_len=None, outline=None):
        if stretch_wid is None and stretch_len is None and outline is None:
            return (s['sw'], s['sl'], s['ow'])
        if stretch_wid is not None:
            if isinstance(stretch_wid, (list, tuple)):
                stretch_wid, stretch_len = stretch_wid[0], stretch_wid[1]
            s['sw'] = float(stretch_wid)
            s['sl'] = float(stretch_len if stretch_len is not None else stretch_wid)
        elif stretch_len is not None:
            s['sl'] = float(stretch_len)
        if outline is not None:
            s['ow'] = float(outline)
        s['rm'] = 'user'       # matches real turtle: shapesize() implies "user"
        _app(s)

    def _set_resizemode(s, rmode=None):
        if rmode is not None and str(rmode).lower() in ('auto', 'user', 'noresize'):
            s['rm'] = str(rmode).lower()
            _app(s)
        return s['rm']

    def _set_tilt(s, angle, relative=False):
        s['tl'] = (s['tl'] + float(angle)) if relative else float(angle)
        _app(s)

    def _pen(s, **kw):
        if 'pendown'   in kw: s['pd'] = bool(kw['pendown'])
        if 'pencolor'  in kw: s['pc'] = _col(kw['pencolor']); s['cu'] = True
        if 'fillcolor' in kw: s['fc'] = _col(kw['fillcolor']); s['cu'] = True
        if 'pensize'   in kw: s['pw'] = float(kw['pensize'])
        if 'shown'     in kw: s['vis'] = bool(kw['shown'])
        if 'outline'   in kw: s['ow'] = float(kw['outline'])
        if 'shape'     in kw: _set_shape(s, kw['shape'])
        if 'resizemode' in kw: _set_resizemode(s, kw['resizemode'])
        if 'stretchfactor' in kw: _set_size(s, kw['stretchfactor'])
        if 'tilt'      in kw: _set_tilt(s, kw['tilt'])
        _app(s)

    _stamp_ids = [0]

    def _stamp(s):
        """Imprint the cursor and return the stamp's id, like real turtle."""
        _stamp_ids[0] += 1
        d = {'k': 'S',
             'x': round(s['x'], 2), 'y': round(s['y'], 2),
             'h': round(s['h'], 2),
             'c': s['pc']}          # legacy field, kept for older frontends
        d.update(_look(s))
        d['sid'] = _stamp_ids[0]
        _shapes.append(d)
        return _stamp_ids[0]

    def _clear_stamp(stampid):
        for i in range(len(_shapes) - 1, -1, -1):
            sh = _shapes[i]
            if sh.get('k') == 'S' and sh.get('sid') == stampid:
                del _shapes[i]

    def _clear_stamps(n=None):
        """Remove all stamps, or the first n (n > 0) / last n (n < 0)."""
        stamps = [i for i, sh in enumerate(_shapes) if sh.get('k') == 'S']
        if n is not None:
            n = int(n)
            if n == 0:
                return
            stamps = stamps[:n] if n > 0 else stamps[n:]
        for i in reversed(stamps):
            del _shapes[i]

    # ── Core movement helper: draw segment + update position ─────────────────
    def _seg(s, nx, ny):
        if s is _gs:
            _gs_used[0] = True
        if s['pd']:
            _shapes.append({
                'k': 'l',
                'x1': round(s['x'], 2), 'y1': round(s['y'], 2),
                'x2': round(nx, 2),     'y2': round(ny, 2),
                'c': s['pc'], 'w': s['pw'],
            })
        elif not s['fl'] and not _arc_mode[0] and _tracer[0] != 0:
            # Pen up, not filling, not inside an arc, animation enabled →
            # emit cursor-move marker so the frontend can animate the teleport.
            # Skip when tracer=0 (instant draw) to keep JSON small.
            _shapes.append({'k': 'M', 'x': round(nx, 2), 'y': round(ny, 2)})
        if s['fl']:
            s['fp'].append([round(nx, 2), round(ny, 2)])
        s['x'], s['y'] = nx, ny

    # ── Move forward (negative = backward) ───────────────────────────────────
    def _fwd(s, d):
        rad = _m.radians(s['h'])
        _seg(s, s['x'] + d * _m.cos(rad), s['y'] + d * _m.sin(rad))

    # ── Draw circle / arc ─────────────────────────────────────────────────────
    def _circ(s, radius, extent=360, steps=None):
        if extent == 0:
            return
        r = abs(radius)
        if steps is None:
            # Enough steps for a smooth arc (~1 step per 3 px of arc)
            steps = max(12, min(360, int(2 * _m.pi * r * abs(extent) / 360 / 3 + 0.5)))
        # Per-step turning angle (sign matches direction of rotation)
        da = (extent / steps) * (1 if radius >= 0 else -1)
        # Direction from turtle to circle center
        cd = s['h'] + (90 if radius >= 0 else -90)
        cx = s['x'] + r * _m.cos(_m.radians(cd))
        cy = s['y'] + r * _m.sin(_m.radians(cd))
        # Starting angle from center → turtle
        ca = _m.degrees(_m.atan2(s['y'] - cy, s['x'] - cx))
        # Suppress penup-move shapes during arc steps (they'd spam the list)
        _arc_mode[0] = True
        try:
            for i in range(steps):
                a = _m.radians(ca + (i + 1) * da)
                _seg(s, cx + r * _m.cos(a), cy + r * _m.sin(a))
        finally:
            _arc_mode[0] = False
        # Update heading to match real turtle
        s['h'] += extent if radius >= 0 else -extent

    # =========================================================================
    # MODULE-LEVEL TURTLE FUNCTIONS  (operate on _gs)
    # =========================================================================

    # ── Movement ─────────────────────────────────────────────────────────────
    def forward(distance):   _fwd(_gs, distance)
    def backward(distance):  _fwd(_gs, -distance)
    def right(angle):        _gs['h'] -= angle
    def left(angle):         _gs['h'] += angle
    def setheading(angle):   _gs['h'] = float(angle)
    def heading():           return _gs['h']
    fd = forward;  bk = back = backward;  rt = right;  lt = left;  seth = setheading

    # ── Position ─────────────────────────────────────────────────────────────
    def goto(x, y=None):
        if isinstance(x, (list, tuple)):
            x, y = x[0], x[1]
        _seg(_gs, float(x), float(y) if y is not None else 0.0)
    setpos = setposition = goto

    def setx(x):   goto(float(x), _gs['y'])
    def sety(y):   goto(_gs['x'], float(y))
    def pos():     return (_gs['x'], _gs['y'])
    position = pos
    def xcor():    return _gs['x']
    def ycor():    return _gs['y']

    def home():
        _seg(_gs, 0.0, 0.0)
        _gs['h'] = 0.0

    def distance(x, y=None):
        if isinstance(x, (list, tuple)): x, y = x[0], x[1]
        return _m.hypot(_gs['x'] - float(x or 0), _gs['y'] - float(y or 0))

    def towards(x, y=None):
        if isinstance(x, (list, tuple)): x, y = x[0], x[1]
        return _m.degrees(_m.atan2(float(y or 0) - _gs['y'], float(x or 0) - _gs['x']))

    # ── Pen ──────────────────────────────────────────────────────────────────
    def pendown():   _gs['pd'] = True
    def penup():     _gs['pd'] = False
    def isdown():    return _gs['pd']
    pd = down = pendown;  pu = up = penup

    def pensize(width=None):
        if width is not None:
            _gs['pw'] = float(width)
            _app(_gs)          # matters when resizemode is "auto"
        return _gs['pw']
    width = pensize

    def pencolor(*args):
        if len(args) == 1: _gs['pc'] = _col(args[0])
        elif len(args) == 3: _gs['pc'] = _col(args)
        if args: _gs['cu'] = True; _app(_gs)
        return _gs['pc']

    def fillcolor(*args):
        if len(args) == 1: _gs['fc'] = _col(args[0])
        elif len(args) == 3: _gs['fc'] = _col(args)
        if args: _gs['cu'] = True; _app(_gs)
        return _gs['fc']

    def color(*args):
        if not args: return (_gs['pc'], _gs['fc'])
        if len(args) == 1:
            c = _col(args[0]); _gs['pc'] = c; _gs['fc'] = c
        elif len(args) == 2:
            _gs['pc'] = _col(args[0]); _gs['fc'] = _col(args[1])
        else:
            c = _col(args); _gs['pc'] = c; _gs['fc'] = c
        _gs['cu'] = True
        _app(_gs)

    def pen(**kwargs):
        _pen(_gs, **kwargs)

    # ── Fill ─────────────────────────────────────────────────────────────────
    def begin_fill():
        _gs['fl'] = True
        _gs['fp'] = [[round(_gs['x'], 2), round(_gs['y'], 2)]]
        _gs['fi'] = len(_shapes)   # insert fill shape here at end_fill()

    def end_fill():
        if _gs['fl'] and len(_gs['fp']) >= 3:
            # Insert fill polygon BEFORE the outline segments so fill renders first
            _shapes.insert(_gs['fi'], {
                'k': 'F',
                'pts': list(_gs['fp']),
                'fc': _gs['fc'],
                'pc': _gs['pc'] if _gs['pd'] else None,
                'pw': _gs['pw'],
            })
        _gs['fl'] = False
        _gs['fp'] = []

    def filling(): return _gs['fl']

    # ── Shapes ───────────────────────────────────────────────────────────────
    def circle(radius, extent=360, steps=None):
        _circ(_gs, radius, extent, steps)

    def dot(size=None, color=None):
        if size is None: size = max(_gs['pw'] + 4, _gs['pw'] * 2)
        _shapes.append({
            'k': 'D',
            'x': round(_gs['x'], 2), 'y': round(_gs['y'], 2),
            'r': round(size / 2, 2),
            'c': _col(color) if color is not None else _gs['pc'],
        })

    def stamp():
        _gs_used[0] = True
        return _stamp(_gs)

    def clearstamp(stampid):
        _clear_stamp(stampid)

    def clearstamps(n=None):
        _clear_stamps(n)

    def write(arg, move=False, align='left', font=('Arial', 8, 'normal')):
        fn = '{} {}px {}'.format(
            font[2] if len(font) > 2 else 'normal',
            font[1] if len(font) > 1 else 8,
            font[0] if font else 'Arial',
        )
        _shapes.append({
            'k': 'T',
            'x': round(_gs['x'], 2), 'y': round(_gs['y'], 2),
            'txt': str(arg), 'c': _gs['pc'], 'font': fn, 'align': align,
        })

    # ── Canvas / screen management ────────────────────────────────────────────
    def clear():
        _shapes.append({'k': 'C'})

    def reset():
        _gs.update(_new_state())
        _shapes.append({'k': 'C'})

    clearscreen = resetscreen = reset

    def speed(s=None):
        if s is not None:
            _speed[0] = int(s)
        return _speed[0]

    def hideturtle():
        _gs_used[0] = True
        _gs['vis'] = False
        _shapes.append({'k': 'HT'})
    def showturtle():
        _gs_used[0] = True
        _gs['vis'] = True
        _shapes.append({'k': 'ST'})
    def isvisible(): return _gs['vis']
    ht = hideturtle;  st = showturtle

    def undo():
        if _shapes: _shapes.pop()

    # ── Screen / window helpers ───────────────────────────────────────────────
    def bgcolor(color=None):
        if color is not None: _cfg[0]['bg'] = _col(color)
        return _cfg[0]['bg']

    def bgpic(picname=None):
        """Set a background picture for the drawing canvas.

        Browser Coder renders SVG images from the project (e.g. "maze.svg"),
        which is what makes it possible to drive the turtle over a ready-made
        picture such as a maze. The name is resolved by the frontend against
        the workspace files, so relative paths like "images/maze.svg" work too.

        Called without an argument it returns the current picture name, or
        'nopic' when there is none - same as Python's turtle.
        """
        if picname is not None:
            name = '' if picname in (None, '', 'nopic') else str(picname)
            _cfg[0]['pic'] = name
        return _cfg[0]['pic'] or 'nopic'

    def title(t): pass   # no-op

    def setup(width=None, height=None, startx=None, starty=None):
        if width is not None:  _cfg[0]['w'] = int(width)
        if height is not None: _cfg[0]['h'] = int(height)

    def screensize(canvwidth=None, canvheight=None, bg=None):
        if canvwidth is not None:  _cfg[0]['w'] = int(canvwidth)
        if canvheight is not None: _cfg[0]['h'] = int(canvheight)
        if bg is not None: bgcolor(bg)

    def window_width():  return _cfg[0]['w']
    def window_height(): return _cfg[0]['h']

    # All of these are no-ops in our headless renderer
    def tracer(n=None, delay=None):
        if n is not None:
            _tracer[0] = int(n)
    def update(): pass
    def delay(d=None): return 10
    def listen(): pass
    def onkey(fun, key): pass
    def onkeypress(fun, key=None): pass
    def onkeyrelease(fun, key=None): pass
    def onclick(fun, btn=1, add=None): pass
    def onscreenclick(fun, btn=1, add=None): pass
    def ontimer(fun, t=0): pass
    def mainloop(): pass
    done = mainloop
    def exitonclick(): pass
    def bye(): pass
    def numinput(title, prompt, default=None, minval=None, maxval=None): return default
    def textinput(title, prompt): return ''
    def mode(m=None): return 'standard'
    def colormode(cmode=None): return cmode if cmode is not None else 255

    # ── Cursor shape ─────────────────────────────────────────────────────────
    def shape(name=None):
        return _set_shape(_gs, name)

    def resizemode(rmode=None):
        return _set_resizemode(_gs, rmode)

    def turtlesize(stretch_wid=None, stretch_len=None, outline=None):
        return _set_size(_gs, stretch_wid, stretch_len, outline)
    shapesize = turtlesize

    def addshape(name, shape=None):
        """Register an existing polygon shape or an SVG cursor.

        Existing polygon registration is unchanged.

        SVG registration supports both:
            screen.register_shape("player.svg")
        when the SVG exists in the runtime, and:
            screen.register_shape("player.svg", SVG_TEXT)
        when lesson code supplies safe inline SVG content.
        """
        shape_name = str(name)

        if shape_name.lower().endswith('.svg'):
            _register_svg_shape(shape_name, shape)
            return

        try:
            pts = [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in shape]
        except Exception:
            return
        if len(pts) >= 3:
            _polys[shape_name] = pts
    register_shape = addshape

    def getshapes():
        return sorted(
            list(_BUILTIN_SHAPES)
            + list(_polys)
            + list(_svg_shapes)
        )

    def tilt(angle):
        _set_tilt(_gs, angle, relative=True)

    def settiltangle(angle):
        _set_tilt(_gs, angle)

    def tiltangle(angle=None):
        if angle is not None:
            _set_tilt(_gs, angle)
        return _gs['tl']

    # ── Screen singleton ─────────────────────────────────────────────────────
    class _Screen:
        def bgcolor(self, color=None):    return bgcolor(color)
        def bgpic(self, picname=None):    return bgpic(picname)
        def register_shape(self, name, shape=None): addshape(name, shape)
        def addshape(self, name, shape=None):       addshape(name, shape)
        def getshapes(self):              return getshapes()
        def Screen(self):                 return _screen
        def Turtle(self, *a, **kw):       return _Turtle(*a, **kw)

        # Drawing calls, also accepted on the screen: they drive the module-level
        # turtle, exactly as turtle.forward() does. Same reasoning as the
        # screen-level calls accepted on a turtle above.
        def forward(self, d):             forward(d)
        def backward(self, d):            backward(d)
        def left(self, a):                left(a)
        def right(self, a):               right(a)
        def goto(self, x, y=None):        goto(x, y)
        def setpos(self, x, y=None):      goto(x, y)
        def setposition(self, x, y=None): goto(x, y)
        def setx(self, x):                setx(x)
        def sety(self, y):                sety(y)
        def setheading(self, a):          setheading(a)
        def heading(self):                return heading()
        def xcor(self):                   return xcor()
        def ycor(self):                   return ycor()
        def position(self):               return position()
        def pos(self):                    return pos()
        def distance(self, x, y=None):    return distance(x, y)
        def towards(self, x, y=None):     return towards(x, y)
        def home(self):                   home()
        def penup(self):                  penup()
        def pendown(self):                pendown()
        def pensize(self, w=None):        return pensize(w)
        def pencolor(self, *a):           return pencolor(*a)
        def fillcolor(self, *a):          return fillcolor(*a)
        def color(self, *a):              return color(*a)
        def shape(self, name=None):       return shape(name)
        def speed(self, s=None):          return speed(s)
        def showturtle(self):             showturtle()
        def hideturtle(self):             hideturtle()
        def isvisible(self):              return isvisible()
        def clear(self):                  clear()
        def reset(self):                  reset()
        def undo(self):                   undo()
        def write(self, arg, move=False, align='left', font=('Arial', 8, 'normal')):
            write(arg, move, align, font)
        def begin_fill(self):             begin_fill()
        def end_fill(self):               end_fill()
        def circle(self, radius, extent=360, steps=None): circle(radius, extent, steps)
        def dot(self, size=None, color=None): dot(size, color)
        def stamp(self):                  return stamp()
        def clearstamp(self, stampid):    _clear_stamp(stampid)
        def clearstamps(self, n=None):    _clear_stamps(n)
        def title(self, t):               pass
        def setup(self, width=None, height=None, startx=None, starty=None):
            if width  is not None: _cfg[0]['w'] = int(width)
            if height is not None: _cfg[0]['h'] = int(height)
        def screensize(self, cw=None, ch=None, bg=None): screensize(cw, ch, bg)
        def window_width(self):           return _cfg[0]['w']
        def window_height(self):          return _cfg[0]['h']
        def tracer(self, n=None, d=None):
            if n is not None: _tracer[0] = int(n)
        def update(self):                 pass
        def delay(self, d=None):          return 10
        def listen(self):                 pass
        def onkey(self, f, k):            pass
        def onkeypress(self, f, k=None):  pass
        def onkeyrelease(self, f, k=None):pass
        def onclick(self, f, b=1, a=None):pass
        def ontimer(self, f, t=0):        pass
        def mainloop(self):               pass
        done = mainloop
        def exitonclick(self):            pass
        def bye(self):                    pass
        def numinput(self, t, p, d=None, mn=None, mx=None): return d
        def textinput(self, t, p):        return ''
        def mode(self, m=None):           return 'standard'
        def colormode(self, c=None):      return c if c is not None else 255

    _screen = _Screen()
    def Screen(): return _screen
    def getscreen(): return _screen

    # ── Turtle class (OOP API) ───────────────────────────────────────────────
    class _Turtle:
        def __init__(self, *args, **kwargs):
            self._s = _new_state()
            _turtles.append(self._s)
            if 'shape' in kwargs:
                _set_shape(self._s, kwargs['shape'])
            elif args and isinstance(args[0], str):
                _set_shape(self._s, args[0])
            if kwargs.get('visible') is False:
                self._s['vis'] = False

        def _seg(self, nx, ny):  _seg(self._s, nx, ny)
        def _fwd(self, d):       _fwd(self._s, d)

        def forward(self, d):    _fwd(self._s, d)
        def fd(self, d):         _fwd(self._s, d)
        def backward(self, d):   _fwd(self._s, -d)
        def bk(self, d):         _fwd(self._s, -d)
        def back(self, d):       _fwd(self._s, -d)
        def right(self, a):      self._s['h'] -= a
        def rt(self, a):         self._s['h'] -= a
        def left(self, a):       self._s['h'] += a
        def lt(self, a):         self._s['h'] += a
        def setheading(self, a): self._s['h'] = float(a)
        def seth(self, a):       self._s['h'] = float(a)
        def heading(self):       return self._s['h']

        def goto(self, x, y=None):
            if isinstance(x, (list, tuple)): x, y = x[0], x[1]
            _seg(self._s, float(x), float(y) if y is not None else 0.0)
        def setpos(self, x, y=None):    self.goto(x, y)
        def setposition(self, x, y=None): self.goto(x, y)
        def setx(self, x):   self.goto(float(x), self._s['y'])
        def sety(self, y):   self.goto(self._s['x'], float(y))
        def pos(self):       return (self._s['x'], self._s['y'])
        def position(self):  return (self._s['x'], self._s['y'])
        def xcor(self):      return self._s['x']
        def ycor(self):      return self._s['y']
        def home(self):
            _seg(self._s, 0.0, 0.0)
            self._s['h'] = 0.0
        def distance(self, x, y=None):
            if isinstance(x, (list, tuple)): x, y = x[0], x[1]
            return _m.hypot(self._s['x'] - float(x or 0), self._s['y'] - float(y or 0))
        def towards(self, x, y=None):
            if isinstance(x, (list, tuple)): x, y = x[0], x[1]
            return _m.degrees(_m.atan2(float(y or 0) - self._s['y'], float(x or 0) - self._s['x']))

        def pendown(self):     self._s['pd'] = True
        def pd(self):          self._s['pd'] = True
        def down(self):        self._s['pd'] = True
        def penup(self):       self._s['pd'] = False
        def pu(self):          self._s['pd'] = False
        def up(self):          self._s['pd'] = False
        def isdown(self):      return self._s['pd']
        def pensize(self, w=None):
            if w is not None:
                self._s['pw'] = float(w)
                _app(self._s)
            return self._s['pw']
        def width(self, w=None): return self.pensize(w)
        def pen(self, **kw):     _pen(self._s, **kw)

        def pencolor(self, *a):
            if len(a) == 1: self._s['pc'] = _col(a[0])
            elif len(a) == 3: self._s['pc'] = _col(a)
            if a: self._s['cu'] = True; _app(self._s)
            return self._s['pc']
        def fillcolor(self, *a):
            if len(a) == 1: self._s['fc'] = _col(a[0])
            elif len(a) == 3: self._s['fc'] = _col(a)
            if a: self._s['cu'] = True; _app(self._s)
            return self._s['fc']
        def color(self, *a):
            if not a: return (self._s['pc'], self._s['fc'])
            if len(a) == 1: c = _col(a[0]); self._s['pc'] = c; self._s['fc'] = c
            elif len(a) == 2: self._s['pc'] = _col(a[0]); self._s['fc'] = _col(a[1])
            else: c = _col(a); self._s['pc'] = c; self._s['fc'] = c
            self._s['cu'] = True
            _app(self._s)

        def begin_fill(self):
            self._s['fl'] = True
            self._s['fp'] = [[round(self._s['x'], 2), round(self._s['y'], 2)]]
            self._s['fi'] = len(_shapes)
        def end_fill(self):
            if self._s['fl'] and len(self._s['fp']) >= 3:
                _shapes.insert(self._s['fi'], {
                    'k': 'F',
                    'pts': list(self._s['fp']),
                    'fc': self._s['fc'],
                    'pc': self._s['pc'] if self._s['pd'] else None,
                    'pw': self._s['pw'],
                })
            self._s['fl'] = False
            self._s['fp'] = []
        def filling(self):   return self._s['fl']

        def circle(self, radius, extent=360, steps=None):
            _circ(self._s, radius, extent, steps)
        def dot(self, size=None, color=None):
            if size is None: size = max(self._s['pw'] + 4, self._s['pw'] * 2)
            _shapes.append({'k': 'D', 'x': round(self._s['x'], 2), 'y': round(self._s['y'], 2),
                            'r': round(size / 2, 2), 'c': _col(color) if color else self._s['pc']})
        def stamp(self):
            return _stamp(self._s)
        def clearstamp(self, stampid):    _clear_stamp(stampid)
        def clearstamps(self, n=None):    _clear_stamps(n)

        # Screen-level calls, also accepted on a turtle. Real Python keeps these
        # on the screen only, but a beginner reasonably writes t.bgpic("maze.svg")
        # or t.tracer(0), and an AttributeError there teaches nothing.
        def Screen(self):                 return _screen
        def Turtle(self, *a, **kw):       return _Turtle(*a, **kw)
        def setup(self, width=None, height=None, startx=None, starty=None):
            _screen.setup(width, height, startx, starty)
        def title(self, t):               pass
        def bgcolor(self, color=None):    return bgcolor(color)
        def bgpic(self, picname=None):    return bgpic(picname)
        def screensize(self, cw=None, ch=None, bg=None): screensize(cw, ch, bg)
        def register_shape(self, name, shape=None): addshape(name, shape)
        def addshape(self, name, shape=None):       addshape(name, shape)
        def getshapes(self):              return getshapes()
        def tracer(self, n=None, d=None):
            if n is not None: _tracer[0] = int(n)
            return _tracer[0]
        def update(self):                 pass
        def delay(self, d=None):          return 10
        def ontimer(self, fun, t=0):      pass
        def listen(self):                 pass
        def mainloop(self):               pass
        def done(self):                   pass
        def bye(self):                    pass
        def exitonclick(self):            pass
        def write(self, arg, move=False, align='left', font=('Arial', 8, 'normal')):
            fn = '{} {}px {}'.format(
                font[2] if len(font) > 2 else 'normal',
                font[1] if len(font) > 1 else 8,
                font[0] if font else 'Arial')
            _shapes.append({'k': 'T', 'x': round(self._s['x'], 2), 'y': round(self._s['y'], 2),
                            'txt': str(arg), 'c': self._s['pc'], 'font': fn, 'align': align})
        def clear(self):       _shapes.append({'k': 'C'})
        def reset(self):
            self._s.update(_new_state())
            _shapes.append({'k': 'C'})
        def speed(self, s=None):
            if s is not None: _speed[0] = int(s)
            return _speed[0]
        def hideturtle(self):
            self._s['vis'] = False
            _shapes.append({'k': 'HT'})
        def ht(self):
            self._s['vis'] = False
            _shapes.append({'k': 'HT'})
        def showturtle(self):
            self._s['vis'] = True
            _shapes.append({'k': 'ST'})
        def st(self):
            self._s['vis'] = True
            _shapes.append({'k': 'ST'})
        def isvisible(self):   return self._s['vis']
        def undo(self):
            if _shapes: _shapes.pop()
        def getscreen(self):   return _screen
        def getturtle(self):   return self
        def getpen(self):      return self
        def shape(self, name=None):   return _set_shape(self._s, name)
        def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
            return _set_size(self._s, stretch_wid, stretch_len, outline)
        def turtlesize(self, stretch_wid=None, stretch_len=None, outline=None):
            return _set_size(self._s, stretch_wid, stretch_len, outline)
        def resizemode(self, r=None): return _set_resizemode(self._s, r)
        def tilt(self, a):            _set_tilt(self._s, a, relative=True)
        def settiltangle(self, a):    _set_tilt(self._s, a)
        def tiltangle(self, a=None):
            if a is not None: _set_tilt(self._s, a)
            return self._s['tl']
        def onclick(self, fun, btn=1, add=None): pass
        def onrelease(self, fun, btn=1, add=None): pass
        def ondrag(self, fun, btn=1, add=None): pass

    Turtle = _Turtle
    RawTurtle = _Turtle
    Pen = _Turtle

    # ── atexit: emit drawing data ─────────────────────────────────────────────
    def _emit():
        # Where every turtle ended up. Used to draw the cursors once the
        # drawing is complete (and as the only cursor source when animation
        # is switched off, since no 'SH' events are recorded in that mode).
        _cursors = []
        if _gs_used[0] or _gs != _new_state():
            _cursors.append(_cur(_gs))
        for _ts in _turtles[:50]:
            _cursors.append(_cur(_ts))

        data = {
            'bg':     _cfg[0]['bg'],
            'w':      _cfg[0]['w'],
            'h':      _cfg[0]['h'],
            'tracer': _tracer[0],
            'speed':  _speed[0],
            'shapes': _shapes,
            'cursors': _cursors,
        }
        if _polys:
            data['polys'] = _polys
        if _svg_shapes:
            data['svgShapes'] = _svg_shapes
        if _cfg[0]['pic']:
            data['pic'] = _cfg[0]['pic']
        json_str = _j.dumps(data, separators=(',', ':'))

        # ── Write the drawing to the target the SERVICE chose ─────────────────
        #
        # The path comes from BROWSER_CODER_GRAPHICS_OUT, which the server sets
        # in the sandbox environment before starting this process. It is inside
        # the run's own private job directory.
        #
        # Nothing is printed to stdout. This matters for two reasons:
        #
        #  1. The previous design printed `__TURTLE_FILE__:<path>` and the server
        #     then read and DELETED whatever path it found there. Because stdout
        #     belongs to the student's program, any program could name any file
        #     and have the service read and unlink it on its behalf. Choosing the
        #     path server-side removes the decision an attacker could subvert;
        #     filtering the marker would not have, because the flaw was trusting
        #     a filesystem instruction from untrusted output at all.
        #
        #  2. The server's live-output filter had to buffer anything starting with
        #     `__TURTLE_` before applying the output budget, so an unterminated
        #     marker could exhaust its memory. With nothing printed there is
        #     nothing to buffer.
        #
        # Using a file rather than stdout also keeps a dense drawing (spirograph,
        # mandala) from being truncated by the 100 KB output cap.
        import os as _os
        _out_path = _os.environ.get('BROWSER_CODER_GRAPHICS_OUT')
        if _out_path:
            try:
                # Written whole, then closed, so the server never observes a
                # partially written JSON document.
                with open(_out_path, 'w', encoding='utf-8') as _fh:
                    _fh.write(json_str)
            except Exception:
                # A drawing that cannot be saved is a lost picture, never a failed
                # program. Silently give up rather than corrupting the student's
                # real output with a diagnostic they cannot act on.
                pass

    _ae.register(_emit)

    # ── Build turtle module object and inject into sys.modules ────────────────
    _tm = type(_sys)('turtle')
    _public = [
        'forward', 'fd', 'backward', 'bk', 'back',
        'right', 'rt', 'left', 'lt', 'setheading', 'seth', 'heading',
        'goto', 'setpos', 'setposition', 'setx', 'sety',
        'pos', 'position', 'xcor', 'ycor', 'home', 'distance', 'towards',
        'pendown', 'pd', 'down', 'penup', 'pu', 'up', 'isdown',
        'pensize', 'width', 'pencolor', 'fillcolor', 'color', 'pen',
        'begin_fill', 'end_fill', 'filling',
        'circle', 'dot', 'stamp', 'clearstamp', 'clearstamps', 'write',
        'clear', 'reset', 'clearscreen', 'resetscreen',
        'speed', 'hideturtle', 'ht', 'showturtle', 'st', 'isvisible', 'undo',
        'bgcolor', 'bgpic', 'title', 'setup', 'screensize', 'window_width', 'window_height',
        'tracer', 'update', 'delay', 'listen',
        'onkey', 'onkeypress', 'onkeyrelease', 'onclick', 'onscreenclick', 'ontimer',
        'mainloop', 'done', 'exitonclick', 'bye',
        'numinput', 'textinput', 'mode', 'colormode',
        'shape', 'resizemode', 'turtlesize', 'shapesize', 'getshapes',
        'tilt', 'tiltangle', 'settiltangle',
        'addshape', 'register_shape',
        'Screen', 'getscreen', 'Turtle', 'RawTurtle', 'Pen',
    ]
    _lc = locals()
    for _n in _public:
        if _n in _lc:
            setattr(_tm, _n, _lc[_n])
    _sys.modules['turtle'] = _tm


_setup_turtle()
del _setup_turtle