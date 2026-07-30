"""
Browser Coder Turtle Shim
=========================

Drop-in replacement for languages/python/turtle_shim.py.

Adds native SVG cursor support to the browser coder while preserving the
usual educational Turtle API. Custom SVG files are embedded into the Turtle
JSON as data URLs, so the frontend can animate them without one-SVG-per-cell
frames and without requiring a public asset URL.

Supported usage:

    import turtle

    screen = turtle.Screen()
    screen.register_shape("player.svg")

    player = turtle.Turtle()
    player.shape("player.svg")
    player.forward(100)

Calling shape("file.svg") also auto-registers the SVG when possible.
"""

from __future__ import annotations

import atexit
import base64
import json
import math
import os
import re
import sys
import tempfile
import types
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Union

Number = Union[int, float]
Color = Union[str, Tuple[Number, Number, Number], List[Number]]

_FILE_MARKER = "__TURTLE_FILE__:"
_INLINE_MARKER = "__TURTLE_COMMANDS__:"
_MAX_SVG_BYTES = 12 * 1024 * 1024


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _css_color(value: Color, colormode: float = 255.0) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, (tuple, list)) and len(value) >= 3:
        mode = 1.0 if colormode <= 1 else colormode
        channels = []
        for item in value[:3]:
            channel = _finite(item)
            if mode <= 1:
                channel *= 255
            else:
                channel = channel * 255 / mode
            channels.append(max(0, min(255, round(channel))))
        return "rgb({},{},{})".format(*channels)

    return str(value)


def _candidate_asset_paths(name: str) -> List[str]:
    if not name or name.startswith("data:"):
        return []

    raw = os.path.expanduser(name)
    candidates: List[str] = []

    def add(path: str) -> None:
        absolute = os.path.abspath(path)
        if absolute not in candidates:
            candidates.append(absolute)

    add(raw)
    add(os.path.join(os.getcwd(), raw))

    try:
        script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        add(os.path.join(script_dir, raw))
    except Exception:
        pass

    # Multi-file projects sometimes execute an entry file from a generated
    # directory while assets remain one folder below it. Search only a small,
    # bounded area to avoid an expensive filesystem walk.
    basename = os.path.basename(raw)
    roots = []
    try:
        roots.append(os.getcwd())
    except Exception:
        pass
    try:
        roots.append(os.path.dirname(os.path.abspath(sys.argv[0])))
    except Exception:
        pass

    for path_entry in sys.path:
        if isinstance(path_entry, str) and path_entry:
            roots.append(path_entry)

    checked_roots = []
    for root in roots:
        absolute_root = os.path.abspath(root)
        if absolute_root in checked_roots or not os.path.isdir(absolute_root):
            continue
        checked_roots.append(absolute_root)

        try:
            for child in os.listdir(absolute_root):
                child_path = os.path.join(absolute_root, child)
                if os.path.isdir(child_path):
                    add(os.path.join(child_path, basename))
        except Exception:
            pass

        # Bounded recursive search: project imports can place the active Python
        # file and SVG assets in neighboring folders. Never scan deeper than
        # three levels or more than 300 directories.
        visited = 0
        try:
            root_depth = absolute_root.rstrip(os.sep).count(os.sep)
            for current_root, directories, files in os.walk(absolute_root):
                visited += 1
                current_depth = current_root.rstrip(os.sep).count(os.sep) - root_depth
                if current_depth >= 3:
                    directories[:] = []
                if basename in files:
                    add(os.path.join(current_root, basename))
                if visited >= 300:
                    break
        except Exception:
            pass

    return candidates


def _sanitize_svg(svg_text: str) -> str:
    """Remove executable or remote-loading SVG features before embedding."""
    sanitized = re.sub(
        r"<script\b[^>]*>.*?</script\s*>",
        "",
        svg_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    sanitized = re.sub(
        r"<foreignObject\b[^>]*>.*?</foreignObject\s*>",
        "",
        sanitized,
        flags=re.IGNORECASE | re.DOTALL,
    )
    sanitized = re.sub(
        r"\s+on[a-zA-Z]+\s*=\s*(['\"]).*?\1",
        "",
        sanitized,
        flags=re.IGNORECASE | re.DOTALL,
    )
    sanitized = re.sub(
        r"((?:href|xlink:href)\s*=\s*['\"])\s*(?:javascript:|https?://)[^'\"]*(['\"])",
        r"\1\2",
        sanitized,
        flags=re.IGNORECASE,
    )
    return sanitized


def _svg_dimensions(svg_text: str) -> Tuple[float, float]:
    # The rendered cursor should be classroom-friendly, not the source file's
    # raw pixel size. We only use the source aspect ratio here.
    viewbox = re.search(
        r"viewBox\s*=\s*['\"]\s*[-+0-9.eE]+\s+[-+0-9.eE]+\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*['\"]",
        svg_text,
        re.IGNORECASE,
    )
    if viewbox:
        source_w = max(1.0, _finite(viewbox.group(1), 1.0))
        source_h = max(1.0, _finite(viewbox.group(2), 1.0))
    else:
        width = re.search(r"\bwidth\s*=\s*['\"]\s*([-+0-9.eE]+)", svg_text, re.IGNORECASE)
        height = re.search(r"\bheight\s*=\s*['\"]\s*([-+0-9.eE]+)", svg_text, re.IGNORECASE)
        source_w = max(1.0, _finite(width.group(1), 1.0) if width else 1.0)
        source_h = max(1.0, _finite(height.group(1), 1.0) if height else 1.0)

    max_side = 42.0
    scale = max_side / max(source_w, source_h)
    return max(8.0, source_w * scale), max(8.0, source_h * scale)


def _load_svg_data(name: str) -> Optional[Dict[str, Any]]:
    if name.startswith("data:image/svg+xml"):
        return {
            "dataUrl": name,
            "width": 42,
            "height": 42,
            "rotate": False,
        }

    for candidate in _candidate_asset_paths(name):
        try:
            size = os.path.getsize(candidate)
            if size <= 0 or size > _MAX_SVG_BYTES:
                continue
            with open(candidate, "rb") as handle:
                raw = handle.read(_MAX_SVG_BYTES + 1)
            if len(raw) > _MAX_SVG_BYTES:
                continue
            text = raw.decode("utf-8-sig")
            if "<svg" not in text.lower():
                continue
            text = _sanitize_svg(text)
            width, height = _svg_dimensions(text)
            encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
            return {
                "dataUrl": "data:image/svg+xml;base64," + encoded,
                "width": width,
                "height": height,
                "rotate": False,
            }
        except Exception:
            continue

    return None


class _State:
    def __init__(self) -> None:
        self.width = 600
        self.height = 600
        self.background = "white"
        self.background_name: Optional[str] = None
        self.background_data: Optional[str] = None
        self.title = "Python Turtle"
        self.tracer = 1
        self.delay = 10
        self.colormode = 255.0
        self.mode = "standard"
        self.shapes: List[Dict[str, Any]] = []
        self.cursor_assets: Dict[str, Dict[str, Any]] = {}
        self.registered_shapes = {
            "arrow", "turtle", "circle", "square", "triangle", "classic"
        }
        self.turtles: List["Turtle"] = []
        self.active_turtle: Optional["Turtle"] = None
        self.emitted = False
        self.closed = False

    def append(self, shape: Dict[str, Any]) -> None:
        self.shapes.append(shape)

    def serialize(self) -> Dict[str, Any]:
        active = self.active_turtle or (self.turtles[0] if self.turtles else None)
        speed = active._speed if active else 3
        cursors = [turtle._cursor_payload() for turtle in self.turtles]

        payload: Dict[str, Any] = {
            "bg": self.background,
            "w": self.width,
            "h": self.height,
            "tracer": self.tracer,
            "speed": speed,
            "delay": self.delay,
            "title": self.title,
            "shapes": self.shapes,
            "cursorAssets": self.cursor_assets,
            "cursors": cursors,
        }

        if active is not None:
            payload["cursor"] = active._cursor_payload()

        if self.background_name:
            payload["picName"] = self.background_name
        if self.background_data:
            payload["picData"] = self.background_data

        return payload


_STATE = _State()


class _Screen:
    def setup(
        self,
        width: Number = 600,
        height: Number = 600,
        startx: Optional[Number] = None,
        starty: Optional[Number] = None,
    ) -> None:
        del startx, starty
        _STATE.width = max(1, min(1200, int(_finite(width, 600))))
        _STATE.height = max(1, min(900, int(_finite(height, 600))))

    def screensize(
        self,
        canvwidth: Optional[Number] = None,
        canvheight: Optional[Number] = None,
        bg: Optional[Color] = None,
    ) -> Tuple[int, int]:
        if canvwidth is not None:
            _STATE.width = max(1, min(1200, int(_finite(canvwidth, _STATE.width))))
        if canvheight is not None:
            _STATE.height = max(1, min(900, int(_finite(canvheight, _STATE.height))))
        if bg is not None:
            self.bgcolor(bg)
        return _STATE.width, _STATE.height

    def window_width(self) -> int:
        return _STATE.width

    def window_height(self) -> int:
        return _STATE.height

    def title(self, text: Optional[str] = None) -> str:
        if text is not None:
            _STATE.title = str(text)
        return _STATE.title

    def bgcolor(self, *args: Any) -> str:
        if args:
            value: Any = args[0] if len(args) == 1 else args[:3]
            _STATE.background = _css_color(value, _STATE.colormode)
        return _STATE.background

    def bgpic(self, picname: Optional[str] = None) -> Optional[str]:
        if picname is None:
            return _STATE.background_name

        if picname in {"nopic", "None", ""}:
            _STATE.background_name = None
            _STATE.background_data = None
            return None

        name = str(picname)
        _STATE.background_name = name
        asset = _load_svg_data(name) if name.lower().endswith(".svg") or name.startswith("data:") else None
        _STATE.background_data = asset["dataUrl"] if asset else None
        return name

    def register_shape(
        self,
        name: str,
        shape: Any = None,
        *,
        width: Optional[Number] = None,
        height: Optional[Number] = None,
        size: Optional[Number] = None,
        rotate: bool = False,
    ) -> None:
        del shape
        shape_name = str(name)
        asset = _load_svg_data(shape_name)

        if shape_name.lower().endswith(".svg") and asset is None:
            raise TurtleGraphicsError(
                "Could not find or read the SVG Turtle shape: "
                + shape_name
                + ". Keep the SVG inside the imported project and use the exact filename."
            )

        if asset is not None:
            if size is not None:
                requested = max(4.0, _finite(size, 42.0))
                ratio = asset["width"] / max(asset["height"], 1.0)
                if ratio >= 1:
                    asset["width"] = requested
                    asset["height"] = requested / ratio
                else:
                    asset["height"] = requested
                    asset["width"] = requested * ratio
            if width is not None:
                asset["width"] = max(4.0, _finite(width, asset["width"]))
            if height is not None:
                asset["height"] = max(4.0, _finite(height, asset["height"]))
            asset["rotate"] = bool(rotate)
            _STATE.cursor_assets[shape_name] = asset

        # Match normal Turtle behaviour: registration itself does not fail just
        # because a browser project resolver will provide the file later.
        _STATE.registered_shapes.add(shape_name)

    addshape = register_shape

    def getshapes(self) -> List[str]:
        return sorted(_STATE.registered_shapes)

    def tracer(self, n: Optional[Number] = None, delay: Optional[Number] = None) -> int:
        if n is not None:
            _STATE.tracer = max(0, int(_finite(n, 1)))
        if delay is not None:
            _STATE.delay = max(0, int(_finite(delay, 10)))
        return _STATE.tracer

    def delay(self, delay: Optional[Number] = None) -> int:
        if delay is not None:
            _STATE.delay = max(0, int(_finite(delay, 10)))
        return _STATE.delay

    def update(self) -> None:
        return None

    def mode(self, mode: Optional[str] = None) -> str:
        if mode is not None:
            normalized = str(mode).lower()
            if normalized not in {"standard", "logo", "world"}:
                raise ValueError("mode must be 'standard', 'logo', or 'world'")
            _STATE.mode = normalized
        return _STATE.mode

    def colormode(self, mode: Optional[Number] = None) -> float:
        if mode is not None:
            selected = _finite(mode, 255)
            if selected not in {1.0, 255.0}:
                raise TurtleGraphicsError("bad color sequence")
            _STATE.colormode = selected
        return _STATE.colormode

    def clear(self) -> None:
        _STATE.append({"k": "C"})

    reset = clear

    def ontimer(self, fun: Callable[[], Any], t: Number = 0) -> None:
        del t
        # Python runs to completion before the browser replays commands. Calling
        # the function now preserves deterministic educational code and avoids
        # a callback that could never execute after the process exits.
        if callable(fun):
            fun()

    def listen(self, *args: Any, **kwargs: Any) -> None:
        del args, kwargs

    def onkey(self, *args: Any, **kwargs: Any) -> None:
        del args, kwargs

    onkeypress = onkey
    onkeyrelease = onkey

    def bye(self) -> None:
        _STATE.closed = True

    def mainloop(self) -> None:
        _emit_turtle_output()

    def getcanvas(self) -> None:
        return None


_SCREEN = _Screen()


class TurtleGraphicsError(Exception):
    pass


class Vec2D(tuple):
    def __new__(cls, x: Number, y: Number) -> "Vec2D":
        return tuple.__new__(cls, (_finite(x), _finite(y)))

    def __add__(self, other: Iterable[Number]) -> "Vec2D":
        ox, oy = other
        return Vec2D(self[0] + ox, self[1] + oy)

    def __sub__(self, other: Iterable[Number]) -> "Vec2D":
        ox, oy = other
        return Vec2D(self[0] - ox, self[1] - oy)

    def __mul__(self, other: Number) -> "Vec2D":
        scalar = _finite(other, 1)
        return Vec2D(self[0] * scalar, self[1] * scalar)

    __rmul__ = __mul__

    def __abs__(self) -> float:
        return math.hypot(self[0], self[1])

    def rotate(self, angle: Number) -> "Vec2D":
        radians_value = math.radians(_finite(angle))
        cosine = math.cos(radians_value)
        sine = math.sin(radians_value)
        return Vec2D(
            self[0] * cosine - self[1] * sine,
            self[0] * sine + self[1] * cosine,
        )


class Turtle:
    _next_id = 0

    def __init__(
        self,
        shape: str = "classic",
        undobuffersize: Optional[int] = 1000,
        visible: bool = True,
    ) -> None:
        del undobuffersize
        self._id = Turtle._next_id
        Turtle._next_id += 1

        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0
        self._pendown = True
        self._pencolor = "black"
        self._fillcolor = "black"
        self._pensize = 1.0
        self._visible = bool(visible)
        self._shape = "classic"
        self._speed = 3
        self._stretch_wid = 1.0
        self._stretch_len = 1.0
        self._outline = 1.0
        self._resizemode = "noresize"
        self._filling = False
        self._fill_points: List[List[float]] = []

        _STATE.turtles.append(self)
        if _STATE.active_turtle is None:
            _STATE.active_turtle = self

        self.shape(shape)
        _STATE.append(self._event("V", v=self._visible))

    def _event(self, kind: str, **values: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "k": kind,
            "tid": self._id,
            "x": self._x,
            "y": self._y,
            "h": self._heading,
        }
        payload.update(values)
        return payload

    def _activate(self) -> None:
        _STATE.active_turtle = self

    def _shape_asset(self) -> Optional[Dict[str, Any]]:
        return _STATE.cursor_assets.get(self._shape)

    def _cursor_size(self) -> Tuple[float, float, bool]:
        asset = self._shape_asset()
        base_width = _finite(asset.get("width"), 22.0) if asset else 22.0
        base_height = _finite(asset.get("height"), 16.0) if asset else 16.0
        rotate = bool(asset.get("rotate", False)) if asset else True
        return (
            max(2.0, base_width * self._stretch_len),
            max(2.0, base_height * self._stretch_wid),
            rotate,
        )

    def _cursor_payload(self) -> Dict[str, Any]:
        width, height, rotate = self._cursor_size()
        return {
            "id": self._id,
            "x": self._x,
            "y": self._y,
            "h": self._heading,
            "visible": self._visible,
            "shape": self._shape,
            "color": self._pencolor,
            "width": width,
            "height": height,
            "rotate": rotate,
        }

    def _record_shape_change(self) -> None:
        width, height, rotate = self._cursor_size()
        _STATE.append(self._event(
            "I",
            n=self._shape,
            c=self._pencolor,
            sw=width,
            sh=height,
            r=rotate,
        ))

    def forward(self, distance: Number) -> None:
        self._activate()
        length = _finite(distance)
        radians_value = math.radians(self._heading)
        new_x = self._x + math.cos(radians_value) * length
        new_y = self._y + math.sin(radians_value) * length
        self._move_to(new_x, new_y)

    fd = forward

    def backward(self, distance: Number) -> None:
        self.forward(-_finite(distance))

    back = backward
    bk = backward

    def _move_to(self, x: Number, y: Number) -> None:
        old_x, old_y = self._x, self._y
        self._x, self._y = _finite(x), _finite(y)

        if self._filling:
            self._fill_points.append([self._x, self._y])

        if self._pendown:
            _STATE.append({
                "k": "l",
                "tid": self._id,
                "x1": old_x,
                "y1": old_y,
                "x2": self._x,
                "y2": self._y,
                "h": self._heading,
                "c": self._pencolor,
                "w": self._pensize,
            })
        else:
            _STATE.append({
                "k": "M",
                "tid": self._id,
                "x1": old_x,
                "y1": old_y,
                "x2": self._x,
                "y2": self._y,
                "h": self._heading,
            })

    def goto(self, x: Union[Number, Iterable[Number]], y: Optional[Number] = None) -> None:
        if y is None:
            try:
                target_x, target_y = x  # type: ignore[misc]
            except Exception as error:
                raise TypeError("goto() requires x and y or a two-item position") from error
        else:
            target_x, target_y = x, y
        self._activate()
        self._move_to(target_x, target_y)

    setpos = goto
    setposition = goto

    def setx(self, x: Number) -> None:
        self.goto(x, self._y)

    def sety(self, y: Number) -> None:
        self.goto(self._x, y)

    def home(self) -> None:
        self.goto(0, 0)
        self.setheading(0)

    def left(self, angle: Number) -> None:
        self._activate()
        self._heading = (self._heading + _finite(angle)) % 360
        _STATE.append(self._event("R"))

    lt = left

    def right(self, angle: Number) -> None:
        self.left(-_finite(angle))

    rt = right

    def setheading(self, to_angle: Number) -> None:
        self._activate()
        self._heading = _finite(to_angle) % 360
        _STATE.append(self._event("R"))

    seth = setheading

    def heading(self) -> float:
        return self._heading

    def position(self) -> Vec2D:
        return Vec2D(self._x, self._y)

    pos = position

    def xcor(self) -> float:
        return self._x

    def ycor(self) -> float:
        return self._y

    def towards(self, x: Union[Number, Iterable[Number]], y: Optional[Number] = None) -> float:
        if y is None:
            target_x, target_y = x  # type: ignore[misc]
        else:
            target_x, target_y = x, y
        return math.degrees(math.atan2(_finite(target_y) - self._y, _finite(target_x) - self._x)) % 360

    def distance(self, x: Union[Number, Iterable[Number]], y: Optional[Number] = None) -> float:
        if isinstance(x, Turtle):
            target_x, target_y = x.xcor(), x.ycor()
        elif y is None:
            target_x, target_y = x  # type: ignore[misc]
        else:
            target_x, target_y = x, y
        return math.hypot(_finite(target_x) - self._x, _finite(target_y) - self._y)

    def penup(self) -> None:
        self._pendown = False

    pu = penup
    up = penup

    def pendown(self) -> None:
        self._pendown = True

    pd = pendown
    down = pendown

    def isdown(self) -> bool:
        return self._pendown

    def pensize(self, width: Optional[Number] = None) -> float:
        if width is not None:
            self._pensize = max(0.1, _finite(width, 1))
        return self._pensize

    width = pensize

    def pencolor(self, *args: Any) -> str:
        if args:
            value: Any = args[0] if len(args) == 1 else args[:3]
            self._pencolor = _css_color(value, _STATE.colormode)
            self._record_shape_change()
        return self._pencolor

    def fillcolor(self, *args: Any) -> str:
        if args:
            value: Any = args[0] if len(args) == 1 else args[:3]
            self._fillcolor = _css_color(value, _STATE.colormode)
        return self._fillcolor

    def color(self, *args: Any) -> Tuple[str, str]:
        if not args:
            return self._pencolor, self._fillcolor
        if len(args) == 1:
            self.pencolor(args[0])
            self.fillcolor(args[0])
        elif len(args) == 2:
            self.pencolor(args[0])
            self.fillcolor(args[1])
        else:
            self.pencolor(args[:3])
            self.fillcolor(args[:3])
        return self._pencolor, self._fillcolor

    def begin_fill(self) -> None:
        self._filling = True
        self._fill_points = [[self._x, self._y]]

    def end_fill(self) -> None:
        if self._filling and len(self._fill_points) >= 3:
            _STATE.append({
                "k": "F",
                "tid": self._id,
                "pts": self._fill_points,
                "fc": self._fillcolor,
                "pc": self._pencolor,
                "pw": self._pensize,
            })
        self._filling = False
        self._fill_points = []

    def filling(self) -> bool:
        return self._filling

    def dot(self, size: Optional[Number] = None, *color: Any) -> None:
        diameter = max(1.0, _finite(size, max(self._pensize + 4, self._pensize * 2)))
        selected: Any
        if color:
            selected = color[0] if len(color) == 1 else color[:3]
        else:
            selected = self._pencolor
        _STATE.append(self._event(
            "D",
            r=diameter / 2,
            c=_css_color(selected, _STATE.colormode),
        ))

    def write(
        self,
        arg: Any,
        move: bool = False,
        align: str = "left",
        font: Tuple[str, Number, str] = ("Arial", 8, "normal"),
    ) -> None:
        family = str(font[0]) if len(font) > 0 else "Arial"
        size = max(1, int(_finite(font[1], 8))) if len(font) > 1 else 8
        style = str(font[2]) if len(font) > 2 else "normal"
        weight = "bold" if "bold" in style.lower() else "normal"
        italic = "italic " if "italic" in style.lower() else ""
        _STATE.append(self._event(
            "T",
            txt=str(arg),
            c=self._pencolor,
            align=str(align),
            font=f"{italic}{weight} {size}px {family}",
        ))
        if move:
            # Approximate the text width, matching desktop Turtle's optional move.
            self._move_to(self._x + len(str(arg)) * size * 0.6, self._y)

    def circle(self, radius: Number, extent: Optional[Number] = None, steps: Optional[int] = None) -> None:
        radius_value = _finite(radius)
        extent_value = 360.0 if extent is None else _finite(extent)
        if steps is None:
            steps = max(8, min(180, int(abs(extent_value) / 6) + 1))
        else:
            steps = max(1, int(steps))

        step_angle = extent_value / steps
        step_length = 2 * abs(radius_value) * math.sin(math.radians(abs(step_angle)) / 2)
        turn_sign = 1 if radius_value >= 0 else -1

        self.left(turn_sign * step_angle / 2)
        for _ in range(steps):
            self.forward(step_length)
            self.left(turn_sign * step_angle)
        self.right(turn_sign * step_angle / 2)

    def clear(self) -> None:
        # The browser renderer currently has one accumulated canvas. C therefore
        # clears the drawing layer for all turtles, matching the existing shim.
        _STATE.append(self._event("C"))

    def reset(self) -> None:
        self.clear()
        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0
        self._pendown = True
        self._pencolor = "black"
        self._fillcolor = "black"
        self._pensize = 1.0
        self._visible = True
        self._shape = "classic"
        self._speed = 3
        self._stretch_wid = 1.0
        self._stretch_len = 1.0
        self._record_shape_change()
        _STATE.append(self._event("V", v=True))

    def showturtle(self) -> None:
        self._visible = True
        _STATE.append(self._event("V", v=True))

    st = showturtle

    def hideturtle(self) -> None:
        self._visible = False
        _STATE.append(self._event("V", v=False))

    ht = hideturtle

    def isvisible(self) -> bool:
        return self._visible

    def shape(self, name: Optional[str] = None) -> str:
        if name is None:
            return self._shape

        shape_name = str(name)
        if shape_name.lower().endswith(".svg") and shape_name not in _STATE.cursor_assets:
            _SCREEN.register_shape(shape_name)

        _STATE.registered_shapes.add(shape_name)
        self._shape = shape_name
        self._record_shape_change()
        return self._shape

    def shapesize(
        self,
        stretch_wid: Optional[Number] = None,
        stretch_len: Optional[Number] = None,
        outline: Optional[Number] = None,
    ) -> Tuple[float, float, float]:
        if stretch_wid is not None:
            self._stretch_wid = max(0.05, _finite(stretch_wid, 1))
        if stretch_len is not None:
            self._stretch_len = max(0.05, _finite(stretch_len, self._stretch_wid))
        elif stretch_wid is not None:
            self._stretch_len = self._stretch_wid
        if outline is not None:
            self._outline = max(0.0, _finite(outline, 1))
        self._record_shape_change()
        return self._stretch_wid, self._stretch_len, self._outline

    turtlesize = shapesize

    def resizemode(self, rmode: Optional[str] = None) -> str:
        if rmode is not None:
            self._resizemode = str(rmode)
        return self._resizemode

    def speed(self, speed: Optional[Union[str, Number]] = None) -> int:
        if speed is None:
            return self._speed
        names = {
            "fastest": 0,
            "fast": 10,
            "normal": 6,
            "slow": 3,
            "slowest": 1,
        }
        if isinstance(speed, str):
            selected = names.get(speed.lower(), 3)
        else:
            selected = int(round(_finite(speed, 3)))
        self._speed = max(0, min(10, selected))
        self._activate()
        return self._speed

    def stamp(self) -> int:
        width, height, rotate = self._cursor_size()
        stamp_id = len(_STATE.shapes) + 1
        _STATE.append(self._event(
            "S",
            sid=stamp_id,
            n=self._shape,
            c=self._pencolor,
            sw=width,
            sh=height,
            r=rotate,
        ))
        return stamp_id

    def clearstamp(self, stampid: int) -> None:
        del stampid

    def clearstamps(self, n: Optional[int] = None) -> None:
        del n

    def pen(self, pen: Optional[Dict[str, Any]] = None, **pendict: Any) -> Dict[str, Any]:
        values = {
            "shown": self._visible,
            "pendown": self._pendown,
            "pencolor": self._pencolor,
            "fillcolor": self._fillcolor,
            "pensize": self._pensize,
            "speed": self._speed,
            "resizemode": self._resizemode,
            "stretchfactor": (self._stretch_wid, self._stretch_len),
            "outline": self._outline,
        }
        changes: Dict[str, Any] = {}
        if pen:
            changes.update(pen)
        changes.update(pendict)
        if not changes:
            return values

        if "shown" in changes:
            self.showturtle() if changes["shown"] else self.hideturtle()
        if "pendown" in changes:
            self.pendown() if changes["pendown"] else self.penup()
        if "pencolor" in changes:
            self.pencolor(changes["pencolor"])
        if "fillcolor" in changes:
            self.fillcolor(changes["fillcolor"])
        if "pensize" in changes:
            self.pensize(changes["pensize"])
        if "speed" in changes:
            self.speed(changes["speed"])
        if "resizemode" in changes:
            self.resizemode(changes["resizemode"])
        if "stretchfactor" in changes:
            stretch = changes["stretchfactor"]
            self.shapesize(stretch[0], stretch[1])
        if "outline" in changes:
            self._outline = _finite(changes["outline"], 1)
        return self.pen()

    def getscreen(self) -> _Screen:
        return _SCREEN

    getturtle = lambda self: self
    getpen = lambda self: self

    def clone(self) -> "Turtle":
        copy = Turtle(self._shape, visible=self._visible)
        copy._x = self._x
        copy._y = self._y
        copy._heading = self._heading
        copy._pendown = self._pendown
        copy._pencolor = self._pencolor
        copy._fillcolor = self._fillcolor
        copy._pensize = self._pensize
        copy._speed = self._speed
        copy._stretch_wid = self._stretch_wid
        copy._stretch_len = self._stretch_len
        copy._record_shape_change()
        _STATE.append(copy._event("M", x1=0, y1=0, x2=copy._x, y2=copy._y))
        return copy

    def undo(self) -> None:
        if _STATE.shapes:
            _STATE.shapes.pop()

    def degrees(self, fullcircle: Number = 360.0) -> None:
        del fullcircle

    def radians(self) -> None:
        return None


RawTurtle = Turtle
RawPen = Turtle
Pen = Turtle


def Screen() -> _Screen:
    return _SCREEN


# Module-level default turtle, created lazily like CPython turtle.
_DEFAULT_TURTLE: Optional[Turtle] = None


def _get_default_turtle() -> Turtle:
    global _DEFAULT_TURTLE
    if _DEFAULT_TURTLE is None:
        _DEFAULT_TURTLE = Turtle()
    return _DEFAULT_TURTLE


def _method_wrapper(name: str) -> Callable[..., Any]:
    def call(*args: Any, **kwargs: Any) -> Any:
        return getattr(_get_default_turtle(), name)(*args, **kwargs)
    call.__name__ = name
    return call


def _screen_wrapper(name: str) -> Callable[..., Any]:
    def call(*args: Any, **kwargs: Any) -> Any:
        return getattr(_SCREEN, name)(*args, **kwargs)
    call.__name__ = name
    return call


def _emit_turtle_output() -> None:
    if _STATE.emitted:
        return
    _STATE.emitted = True

    payload = _STATE.serialize()
    encoded_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    try:
        handle = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".turtle.json",
            prefix="browser_coder_",
            delete=False,
        )
        try:
            handle.write(encoded_json)
            handle.flush()
        finally:
            handle.close()
        print(_FILE_MARKER + handle.name)
        return
    except Exception:
        pass

    fallback = base64.b64encode(encoded_json.encode("utf-8")).decode("ascii")
    print(_INLINE_MARKER + fallback)


def done() -> None:
    _emit_turtle_output()


mainloop = done
exitonclick = done
bye = _SCREEN.bye


# Build the injected turtle module before user code imports it.
_turtle_module = types.ModuleType("turtle")
_turtle_module.__doc__ = __doc__

_exports: Dict[str, Any] = {
    "Turtle": Turtle,
    "RawTurtle": RawTurtle,
    "RawPen": RawPen,
    "Pen": Pen,
    "Screen": Screen,
    "TurtleScreen": _Screen,
    "TurtleGraphicsError": TurtleGraphicsError,
    "Vec2D": Vec2D,
    "done": done,
    "mainloop": mainloop,
    "exitonclick": exitonclick,
    "bye": bye,
}

for _name in [
    "forward", "fd", "backward", "back", "bk", "left", "lt", "right", "rt",
    "goto", "setpos", "setposition", "setx", "sety", "home", "setheading", "seth",
    "heading", "position", "pos", "xcor", "ycor", "towards", "distance",
    "penup", "pu", "up", "pendown", "pd", "down", "isdown", "pensize", "width",
    "pencolor", "fillcolor", "color", "begin_fill", "end_fill", "filling", "dot",
    "write", "circle", "clear", "reset", "showturtle", "st", "hideturtle", "ht",
    "isvisible", "shape", "shapesize", "turtlesize", "resizemode", "speed", "stamp",
    "clearstamp", "clearstamps", "pen", "getscreen", "getturtle", "getpen", "clone",
    "undo", "degrees", "radians",
]:
    _exports[_name] = _method_wrapper(_name)

for _name in [
    "setup", "screensize", "window_width", "window_height", "title", "bgcolor", "bgpic",
    "register_shape", "addshape", "getshapes", "tracer", "delay", "update", "mode",
    "colormode", "ontimer", "listen", "onkey", "onkeypress", "onkeyrelease",
]:
    _exports[_name] = _screen_wrapper(_name)

for _name, _value in _exports.items():
    setattr(_turtle_module, _name, _value)

_turtle_module.__all__ = sorted(_exports)
sys.modules["turtle"] = _turtle_module

atexit.register(_emit_turtle_output)
