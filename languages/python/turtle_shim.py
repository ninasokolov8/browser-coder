# ─── Turtle Shim for Browser Coder ──────────────────────────────────────────
# Replaces the standard `turtle` module (which requires tkinter / a display)
# with a pure-Python renderer that captures every drawing command and, at
# process exit, serialises them to a single JSON blob printed on stdout as:
#
#   __TURTLE_COMMANDS__:<base64-encoded-JSON>
#
# The browser-coder frontend (src/main.ts) detects this line, decodes it, and
# renders the result on an HTML5 <canvas>.
#
# Design goals:
#   • Full coverage of the common turtle API (module functions + Turtle class)
#   • Secure: everything is scoped inside _setup_turtle() – no stdlib handles
#     leak into the user's namespace after the function returns
#   • No third-party dependencies; only stdlib (sys, json, math, atexit, base64)
# ─────────────────────────────────────────────────────────────────────────────

def _setup_turtle():
    import sys as _sys
    import json as _j
    import math as _m
    import atexit as _ae
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
    _polys    = {}       # custom shapes: name -> [[x, y], ...]
    _turtles  = []       # states of every Turtle() instance the program made
    _gs_used  = [False]  # did the program actually use the module-level turtle?

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
            if n in _polys:
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
        """Register a polygon shape: a sequence of (x, y) pairs.

        Image and compound shapes have no meaning for the canvas renderer and
        are ignored, exactly as they were before shapes were supported.
        """
        try:
            pts = [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in shape]
        except Exception:
            return
        if len(pts) >= 3:
            _polys[str(name)] = pts
    register_shape = addshape

    def getshapes():
        return sorted(list(_BUILTIN_SHAPES) + list(_polys))

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
        if _cfg[0]['pic']:
            data['pic'] = _cfg[0]['pic']
        json_str = _j.dumps(data, separators=(',', ':'))

        # Write the JSON to a temp file and print only the path to stdout.
        # This avoids the server's stdout size limit (100 KB) for programs
        # that produce thousands of shapes (spirographs, dense mandalas, etc).
        # The server reads the file in parseTurtleOutput() then deletes it.
        import os as _os
        _tmp_dir = _os.environ.get('TMPDIR', _os.environ.get('TMP', '/tmp'))
        _tmp_path = _os.path.join(_tmp_dir, '__turtle_%d__.json' % _os.getpid())
        try:
            with open(_tmp_path, 'w', encoding='utf-8') as _fh:
                _fh.write(json_str)
            print('__TURTLE_FILE__:' + _tmp_path, flush=True)
        except Exception:
            # Fallback: inline base64 (may still get truncated for huge programs)
            _enc = _b64.b64encode(json_str.encode()).decode()
            print('__TURTLE_COMMANDS__:' + _enc, flush=True)

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
