import {
  turtleCanvasEl,
} from "./dom";
import * as monaco from 'monaco-editor';
import { runtime } from '../app/runtime.ts';
import { getPopupWindow, hidePopupWindow, showPopupWindow } from "./popup-window";
import { t } from '../i18n/index.ts';

// Id of the shared popup window the turtle drawing is rendered into.
const TURTLE_WINDOW_ID = 'turtle-window';

// ── Turtle graphics renderer ─────────────────────────────────────────────────
// Animated step-by-step replay of the drawing commands captured by the Python
// shim, with a moving turtle cursor - just like a real IDE.
//
// Architecture: double-buffer
//   offscreen canvas  - all shapes accumulated so far (never erased mid-run)
//   visible canvas    - offscreen snapshot + cursor composited on top each frame
//
// Coordinate system:
//   Python turtle: origin at centre, y increases upward
//   HTML canvas:   origin at top-left, y increases downward
//   → canvasX = canvasWidth/2  + turtleX
//   → canvasY = canvasHeight/2 - turtleY
// ─────────────────────────────────────────────────────────────────────────────

export interface TurtleShape {
  k: string;
  ln?: number;
  [key: string]: unknown;
}

/** How a turtle cursor looks: shape name, colours, stretch, outline, tilt. */
export interface TurtleLook {
  sh: string;   // shape name ('classic', 'turtle', … or a registered one)
  fc: string;   // fill colour
  pc: string;   // outline (pen) colour
  sw: number;   // stretch across the heading  (shapesize stretch_wid)
  sl: number;   // stretch along the heading   (shapesize stretch_len)
  ow: number;   // outline width
  tl: number;   // tilt angle in degrees
}

/** A turtle's final resting state, drawn once the run is complete. */
export interface TurtleCursor extends Partial<TurtleLook> {
  x?:   number;
  y?:   number;
  h?:   number;
  vis?: boolean;
}

export interface TurtleSvgShape {
  data: string;       // embedded SVG data URL supplied by the Python shim
  w?: number;         // unscaled cursor width
  h?: number;         // unscaled cursor height
  rotate?: boolean;   // false keeps avatar/photo SVGs upright
}

export interface TurtleData {
  bg?:        string;
  w?:         number;
  h?:         number;
  tracer?:    number;
  speed?:     number;
  shapes?:    TurtleShape[];
  cursors?:   TurtleCursor[];
  polys?:     Record<string, number[][]>;          // polygon register_shape()
  svgShapes?: Record<string, TurtleSvgShape>;      // optional SVG cursors
  pic?:       string;   // bgpic() argument, exactly as the program wrote it
  picData?:   string;   // that picture as a data URL, resolved by the frontend
}

// Animation RAF id (requestAnimationFrame) - null when idle
let turtleAnimRafId: number | null = null;
let turtleReplayTimer: number | null = null;
let turtleReplayDecorations: monaco.editor.IEditorDecorationsCollection | null = null;

// Background picture (bgpic) of the drawing currently on screen. Module-level
// because it is needed both while painting the background and later, whenever
// the program clears the canvas - and because only one drawing is ever
// rendered at a time.
let turtleBgImage: HTMLImageElement | null = null;

// Optional SVG cursor images. These remain empty for every existing non-SVG
// Turtle program, so the original polygon renderer stays on its old path.
let turtleSvgImages = new Map<string, HTMLImageElement>();
let turtleSvgAssets: Record<string, TurtleSvgShape> = {};

// Incremented by every renderTurtle()/clearTurtleCanvas() call so a background
// picture that finishes loading late can tell it belongs to a run that has
// already been replaced, and drop itself instead of painting over the new one.
let turtleRenderSeq = 0;

// ── Built-in cursor shapes ───────────────────────────────────────────────────
// Same polygons Python's turtle module uses. They are defined pointing "up"
// (+y); drawTurtleCursor() rotates them onto the turtle's heading.
const TURTLE_SHAPE_POLYS: Record<string, number[][]> = {
  classic:  [[0, 0], [-5, -9], [0, -7], [5, -9]],
  arrow:    [[-10, 0], [10, 0], [0, 10]],
  square:   [[10, -10], [10, 10], [-10, 10], [-10, -10]],
  triangle: [[10, -5.77], [0, 11.55], [-10, -5.77]],
  circle: [
    [10, 0], [9.51, 3.09], [8.09, 5.88], [5.88, 8.09], [3.09, 9.51],
    [0, 10], [-3.09, 9.51], [-5.88, 8.09], [-8.09, 5.88], [-9.51, 3.09],
    [-10, 0], [-9.51, -3.09], [-8.09, -5.88], [-5.88, -8.09], [-3.09, -9.51],
    [0, -10], [3.09, -9.51], [5.88, -8.09], [8.09, -5.88], [9.51, -3.09],
  ],
  turtle: [
    [0, 16], [-2, 14], [-1, 10], [-4, 7], [-7, 9], [-9, 8], [-6, 5], [-7, 1],
    [-5, -3], [-8, -6], [-6, -8], [-4, -5], [0, -7], [4, -5], [6, -8], [8, -6],
    [5, -3], [7, 1], [6, 5], [9, 8], [7, 9], [4, 7], [1, 10], [2, 14],
  ],
};

// The look a cursor has before the program changes anything. Must stay in sync
// with the shim's defaults (_DEF_SHAPE / _DEF_CURSOR_* / _DEF_SCALE in
// languages/python/turtle_shim.py): the shim only sends a 'SH' event once the
// appearance actually changes, so the two ends have to start from the same one.
const DEFAULT_LOOK: TurtleLook = {
  sh: 'turtle', fc: 'lightgreen', pc: 'darkgreen', sw: 1.5, sl: 1.5, ow: 1, tl: 0,
};

/** Merge the look fields of a shim event/cursor over an existing look. */
function mergeLook(base: TurtleLook, src: Record<string, unknown>): TurtleLook {
  const num = (v: unknown, fallback: number) =>
    (typeof v === 'number' && isFinite(v)) ? v : fallback;
  return {
    sh: typeof src.sh === 'string' ? src.sh : base.sh,
    fc: typeof src.fc === 'string' ? src.fc : base.fc,
    pc: typeof src.pc === 'string' ? src.pc : base.pc,
    sw: num(src.sw, base.sw),
    sl: num(src.sl, base.sl),
    ow: num(src.ow, base.ow),
    tl: num(src.tl, base.tl),
  };
}

/**
 * Resolve the floating turtle window and its canvas, building them on demand.
 *
 * The turtle drawing lives in its own popup window (not inside the Output
 * panel) so it never covers or collides with stdout/stderr/prints - both stay
 * visible at once, exactly like a real IDE where the turtle canvas opens in a
 * separate window. The window shell itself is the shared one every graphics
 * output uses; see popup-window.ts.
 */
function getTurtleElements(): { output: HTMLElement; canvas: HTMLCanvasElement; body: HTMLElement } | null {
  const popup = getPopupWindow(
    TURTLE_WINDOW_ID,
    `\uD83D\uDC22 ${t('turtle.graphics')}`,
    () => clearTurtleCanvas(),   // closing also stops any running animation
  );
  if (!popup) return null;

  let canvas = document.getElementById('turtle-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'turtle-canvas';
    popup.bodyEl.appendChild(canvas);
  } else if (canvas.parentElement !== popup.bodyEl) {
    popup.bodyEl.appendChild(canvas);
  }

  popup.bodyEl.classList.add('turtle-popup-body');

  return { output: popup.windowEl, canvas, body: popup.bodyEl };
}

function stopTurtleReplay(): void {
  if (turtleReplayTimer !== null) {
    window.clearInterval(turtleReplayTimer);
    turtleReplayTimer = null;
  }
}

function highlightTurtleLine(line: unknown, reveal = false): void {
  const editor = runtime.editor;
  const model = editor?.getModel();
  if (!editor || !model || !Number.isInteger(line) || Number(line) < 1 || Number(line) > model.getLineCount()) {
    turtleReplayDecorations?.clear();
    return;
  }
  const lineNumber = Number(line);
  turtleReplayDecorations ??= editor.createDecorationsCollection([]);
  turtleReplayDecorations.set([{
    range: new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber)),
    options: { isWholeLine: true, className: 'turtle-replay-code-line' },
  }]);
  if (reveal) editor.revealLineInCenter(lineNumber);
}

interface TurtleReplayControls {
  setProgress(value: number, reveal?: boolean): void;
}

function createTurtleReplayControls(
  body: HTMLElement,
  shapes: TurtleShape[],
  renderAt: (count: number) => void,
): TurtleReplayControls {
  stopTurtleReplay();
  body.querySelector('#turtle-replay-controls')?.remove();

  const controls = document.createElement('div');
  controls.id = 'turtle-replay-controls';
  controls.className = 'turtle-replay-controls';

  const back = document.createElement('button');
  back.type = 'button';
  back.dataset.replayAction = 'back';
  back.textContent = '◀';
  back.title = t('turtle.previousStep');

  const play = document.createElement('button');
  play.type = 'button';
  play.dataset.replayAction = 'play';
  play.textContent = `▶ ${t('turtle.replay')}`;
  play.title = t('turtle.playPause');

  const forward = document.createElement('button');
  forward.type = 'button';
  forward.dataset.replayAction = 'forward';
  forward.textContent = '▶';
  forward.title = t('turtle.nextStep');

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(shapes.length);
  range.value = String(shapes.length);
  range.setAttribute('aria-label', t('turtle.position'));

  const speed = document.createElement('select');
  speed.title = t('turtle.speed');
  speed.dataset.replayAction = 'speed';
  for (const value of [0.5, 1, 2]) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    if (value === 1) option.selected = true;
    speed.appendChild(option);
  }

  const label = document.createElement('span');
  label.className = 'turtle-replay-label';

  const setProgress = (raw: number, reveal = false) => {
    const value = Math.min(shapes.length, Math.max(0, Math.round(raw)));
    range.value = String(value);
    label.textContent = t('turtle.stepOf', { step: value, total: shapes.length });
    const shape = value > 0 ? shapes[value - 1] : null;
    highlightTurtleLine(shape?.ln, reveal);
  };

  const seek = (value: number, reveal = true) => {
    if (turtleAnimRafId !== null) {
      cancelAnimationFrame(turtleAnimRafId);
      turtleAnimRafId = null;
    }
    stopTurtleReplay();
    play.textContent = `▶ ${t('turtle.replay')}`;
    setProgress(value, reveal);
    renderAt(Number(range.value));
  };

  range.addEventListener('input', () => seek(Number(range.value)));
  back.addEventListener('click', () => seek(Number(range.value) - 1));
  forward.addEventListener('click', () => seek(Number(range.value) + 1));
  play.addEventListener('click', () => {
    if (turtleReplayTimer !== null) {
      stopTurtleReplay();
      play.textContent = `▶ ${t('turtle.replay')}`;
      return;
    }
    if (Number(range.value) >= shapes.length) seek(0, true);
    play.textContent = `⏸ ${t('turtle.pause')}`;
    const delay = Math.max(35, 240 / Number(speed.value));
    turtleReplayTimer = window.setInterval(() => {
      const next = Number(range.value) + 1;
      setProgress(next, false);
      renderAt(next);
      if (next >= shapes.length) {
        stopTurtleReplay();
        play.textContent = `▶ ${t('turtle.replay')}`;
      }
    }, delay);
  });

  controls.append(back, play, forward, range, speed, label);
  body.appendChild(controls);
  setProgress(shapes.length, false);
  return { setProgress };
}

/**
 * Draw a turtle cursor at canvas position (cx, cy).
 *
 * The polygon lives in "shape space", pointing up (+y), and is mapped onto the
 * heading exactly the way Python's turtle does it: shape +y follows the
 * heading, shape +x points to its right. shapesize() stretch and tilt are
 * applied first, in shape space.
 */
function drawTurtleCursor(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  headingDeg: number,
  look: TurtleLook,
  polys?: Record<string, number[][]>,
): void {
  if (look.sh === 'blank') return;

  // SVG cursor branch. Existing built-in and polygon shapes never enter here.
  const svgImage = turtleSvgImages.get(look.sh);
  const svgAsset = turtleSvgAssets[look.sh];
  if (svgImage && svgAsset) {
    const baseWidth = Math.max(2, Number(svgAsset.w ?? 42));
    const baseHeight = Math.max(2, Number(svgAsset.h ?? 42));
    const drawWidth = baseWidth * look.sl;
    const drawHeight = baseHeight * look.sw;

    ctx.save();
    ctx.translate(cx, cy);

    if (svgAsset.rotate === true) {
      // SVG images are authored upright. Heading 90 points up in Turtle,
      // therefore heading 90 requires no canvas rotation.
      ctx.rotate((90 - headingDeg - look.tl) * Math.PI / 180);
    } else if (look.tl !== 0) {
      ctx.rotate(-look.tl * Math.PI / 180);
    }

    try {
      ctx.drawImage(
        svgImage,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight,
      );
    } catch (_e) {
      // An unusable SVG must not break normal Turtle rendering.
    }
    ctx.restore();
    return;
  }

  const poly = polys?.[look.sh] ?? TURTLE_SHAPE_POLYS[look.sh] ?? TURTLE_SHAPE_POLYS.classic;
  if (!poly || poly.length < 2) return;

  const hRad = headingDeg * Math.PI / 180;
  const sinH = Math.sin(hRad), cosH = Math.cos(hRad);
  const tRad = look.tl * Math.PI / 180;
  const sinT = Math.sin(tRad), cosT = Math.cos(tRad);

  // Stretch + tilt matrix, matching turtle's _shapetrafo
  const t11 =  look.sw * cosT, t12 = look.sl * sinT;
  const t21 = -look.sw * sinT, t22 = look.sl * cosT;

  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const px = poly[i][0], py = poly[i][1];
    const sx = t11 * px + t12 * py;
    const sy = t21 * px + t22 * py;
    // shape space → turtle space, then → canvas (whose y grows downward)
    const x = cx + (sinH * sx + cosH * sy);
    const y = cy - (cosH * sx - sinH * sy);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = look.fc;
  ctx.fill();
  if (look.ow > 0) {
    ctx.strokeStyle = look.pc;
    ctx.lineWidth   = look.ow;
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw the turtles where they came to rest, once the drawing is finished. */
function drawFinalCursors(
  ctx: CanvasRenderingContext2D,
  cursors: TurtleCursor[] | undefined,
  cw: number, ch: number,
  polys?: Record<string, number[][]>,
): void {
  if (!cursors) return;
  for (const c of cursors) {
    if (c.vis === false) continue;
    drawTurtleCursor(
      ctx,
      cw / 2 + (c.x ?? 0),
      ch / 2 - (c.y ?? 0),
      c.h ?? 0,
      mergeLook(DEFAULT_LOOK, c as Record<string, unknown>),
      polys,
    );
  }
}

/**
 * Paint a canvas background: the background colour, then the bgpic picture on
 * top of it.
 *
 * The picture is centred and scaled to fit while keeping its aspect ratio, so a
 * maze authored for a square screen still lines up with turtle coordinates
 * after setup() changes the window size.
 */
function paintTurtleBackground(
  sctx: CanvasRenderingContext2D,
  cw: number, ch: number,
  bg: string,
): void {
  sctx.fillStyle = bg;
  sctx.fillRect(0, 0, cw, ch);

  const img = turtleBgImage;
  if (!img) return;

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  try {
    if (iw > 0 && ih > 0) {
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      sctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    } else {
      // An SVG with only a viewBox (no width/height) has no intrinsic size in
      // some browsers. Stretching it over the canvas is the useful fallback.
      sctx.drawImage(img, 0, 0, cw, ch);
    }
  } catch (_e) { /* a broken picture must never break the drawing */ }
}

/** Draw a single shape onto `sctx`. */
function drawTurtleShape(
  sctx: CanvasRenderingContext2D,
  s: TurtleShape,
  cw: number, ch: number,
  bg: string,
  polys?: Record<string, number[][]>,
): void {
  const tx = (x: number) => cw / 2 + x;
  const ty = (y: number) => ch / 2 - y;
  sctx.save();
  sctx.lineCap  = 'round';
  sctx.lineJoin = 'round';
  try {
    switch (s.k) {
      case 'l': {
        sctx.beginPath();
        sctx.moveTo(tx(s.x1 as number), ty(s.y1 as number));
        sctx.lineTo(tx(s.x2 as number), ty(s.y2 as number));
        sctx.strokeStyle = String(s.c ?? 'black');
        sctx.lineWidth   = Number(s.w ?? 1);
        sctx.stroke();
        break;
      }
      case 'F': {
        const pts = s.pts as number[][];
        if (!pts || pts.length < 2) break;
        sctx.beginPath();
        sctx.moveTo(tx(pts[0][0]), ty(pts[0][1]));
        for (let i = 1; i < pts.length; i++) sctx.lineTo(tx(pts[i][0]), ty(pts[i][1]));
        sctx.closePath();
        sctx.fillStyle = String(s.fc ?? 'black');
        sctx.fill();
        if (s.pc) {
          sctx.strokeStyle = String(s.pc);
          sctx.lineWidth   = Number(s.pw ?? 1);
          sctx.stroke();
        }
        break;
      }
      case 'D': {
        sctx.beginPath();
        sctx.arc(tx(s.x as number), ty(s.y as number), Math.max(0.5, Number(s.r ?? 5)), 0, Math.PI * 2);
        sctx.fillStyle = String(s.c ?? 'black');
        sctx.fill();
        break;
      }
      case 'T': {
        sctx.font         = String(s.font ?? '12px Arial');
        sctx.fillStyle    = String(s.c ?? 'black');
        sctx.textAlign    = (s.align ?? 'left') as CanvasTextAlign;
        sctx.textBaseline = 'alphabetic';
        sctx.fillText(String(s.txt ?? ''), tx(s.x as number), ty(s.y as number));
        break;
      }
      case 'C': {
        // clear() wipes the drawing but keeps the screen's background, which
        // includes the bgpic picture - same as real turtle.
        sctx.clearRect(0, 0, cw, ch);
        paintTurtleBackground(sctx, cw, ch, bg);
        break;
      }
      case 'S': {
        // A stamp is an imprint of the cursor: same shape, colours and size.
        // Payloads from before shape support only carry the pen colour `c`;
        // those render the way they always did - a plain black arrowhead.
        const legacy: TurtleLook = {
          ...DEFAULT_LOOK,
          sh: 'classic', sw: 1, sl: 1,
          fc: String(s.c ?? 'black'),
          pc: String(s.c ?? 'black'),
        };
        drawTurtleCursor(
          sctx,
          tx(s.x as number), ty(s.y as number),
          (s.h as number) ?? 0,
          mergeLook(legacy, s),
          polys,
        );
        break;
      }
    }
  } catch (_e) { /* skip malformed shapes */ }
  sctx.restore();
}

/** Repaint exactly the first `count` recorded commands for slider scrubbing. */
function drawTurtlePrefix(
  ctx: CanvasRenderingContext2D,
  shapes: TurtleShape[],
  count: number,
  cw: number, ch: number,
  bg: string,
  cursors?: TurtleCursor[],
  polys?: Record<string, number[][]>,
): void {
  paintTurtleBackground(ctx, cw, ch, bg);

  let x = 0, y = 0, heading = 0, visible = true;
  let look: TurtleLook = DEFAULT_LOOK;
  const end = Math.min(shapes.length, Math.max(0, count));

  for (let index = 0; index < end; index++) {
    const shape = shapes[index];
    drawTurtleShape(ctx, shape, cw, ch, bg, polys);
    switch (shape.k) {
      case 'l': {
        const dx = Number(shape.x2) - Number(shape.x1);
        const dy = Number(shape.y2) - Number(shape.y1);
        x = Number(shape.x2); y = Number(shape.y2);
        if (dx || dy) heading = Math.atan2(dy, dx) * 180 / Math.PI;
        break;
      }
      case 'M': x = Number(shape.x); y = Number(shape.y); break;
      case 'F': {
        const points = shape.pts as number[][] | undefined;
        if (points?.length) [x, y] = points[points.length - 1];
        break;
      }
      case 'D': case 'T': x = Number(shape.x); y = Number(shape.y); break;
      case 'S':
        x = Number(shape.x); y = Number(shape.y);
        heading = Number(shape.h ?? heading);
        break;
      case 'HT': visible = false; break;
      case 'ST': visible = true; break;
      case 'H': heading = Number(shape.h ?? heading); break;
      case 'SH': look = mergeLook(look, shape); break;
    }
  }

  if (end >= shapes.length) {
    drawFinalCursors(ctx, cursors, cw, ch, polys);
  } else if (visible) {
    drawTurtleCursor(ctx, cw / 2 + x, ch / 2 - y, heading, look, polys);
  }
}

// ── Pixel-per-second speeds for each turtle speed level (1–10) ───────────────
// Calibrated to match real Python IDLE turtle feel.
// speed(3) is the default (real turtle default) - feels educational and visible.
// speed(0) / tracer(0) are handled separately as "instant".
const TURTLE_PX_PER_SEC: Record<number, number> = {
  1: 100, 2: 200, 3: 350, 4: 600,
  5: 1000, 6: 1600, 7: 2500, 8: 4000, 9: 6500, 10: 10000,
};

/**
 * Render a finished turtle program.
 *
 * When the program set a background picture with bgpic(), the picture has to be
 * decoded before anything can be painted, so the drawing starts once the image
 * has loaded (or failed). Everything else renders immediately.
 */
export interface TurtleRenderOptions {
  /** Paint the state reached so far immediately, without replay animation. */
  readonly live?: boolean;
}

/**
 * Is there anything to show?
 *
 * ## Why this is a function and not three copies of one condition
 *
 * A drawing reaches the IDE from three places - the end of an ordinary run, a
 * debugger pause, and a Step-Up host message - and each decided for itself whether
 * the payload was worth a window. Two of them asked this question; the debugger
 * pause did not, and only checked that it had been handed an object at all.
 *
 * That was enough to reproduce the bug. The Python turtle shim is loaded whenever
 * ANY file in the project imports turtle, because a helper module may be the one
 * that draws - so debugging a file with no turtle code in it still got a snapshot,
 * of an untouched canvas, on every single pause. The one caller that did not ask
 * opened a blank 600x600 window and left it there.
 *
 * So the question is asked once, here, and enforced at the entry point below where
 * no caller can skip it. The callers still ask it themselves first, to avoid the
 * work of resolving a background picture for a drawing that will not be shown.
 *
 * Shapes or cursors, not screen settings: `bgcolor` on a canvas nothing was drawn
 * on is not a drawing, and this has always been the rule the finished-run path
 * applied. The Python shim now withholds the payload under exactly this condition,
 * so the two sides cannot disagree about what counts.
 */
export function hasTurtleDrawing(data: TurtleData | null | undefined): boolean {
  if (!data) return false;
  return (data.shapes?.length ?? 0) > 0 || (data.cursors?.length ?? 0) > 0;
}

export function renderTurtle(data: TurtleData, options: TurtleRenderOptions = {}): void {
  // Nothing to draw means no window, however this payload arrived. The check is
  // here rather than only in the callers because `drawTurtleData` shows the window
  // BEFORE it looks at the content, so a caller that forgets cannot be caught
  // further down - which is exactly how the debugger pause path went wrong.
  if (!hasTurtleDrawing(data)) return;

  // Cancel a running animation right away: even while an image is loading, the
  // previous drawing must not keep animating onto the canvas.
  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }
  stopTurtleReplay();

  const seq = ++turtleRenderSeq;
  turtleBgImage = null;
  turtleSvgImages = new Map<string, HTMLImageElement>();
  turtleSvgAssets = data.svgShapes ?? {};

  const svgEntries = Object.entries(turtleSvgAssets);

  // Preserve the original fast path exactly for every existing Turtle program.
  // Image loading is introduced only when bgpic or an SVG cursor is present.
  if (!data.picData && svgEntries.length === 0) {
    drawTurtleData(data, options.live === true);
    return;
  }

  let pendingImages = (data.picData ? 1 : 0) + svgEntries.length;

  const imageFinished = () => {
    pendingImages -= 1;
    if (pendingImages === 0 && seq === turtleRenderSeq) {
      drawTurtleData(data, options.live === true);
    }
  };

  if (data.picData) {
    const picture = new Image();
    picture.onload = () => {
      if (seq === turtleRenderSeq) turtleBgImage = picture;
      imageFinished();
    };
    picture.onerror = imageFinished;
    picture.src = data.picData;
  }

  for (const [name, asset] of svgEntries) {
    const image = new Image();
    image.onload = () => {
      if (seq === turtleRenderSeq) turtleSvgImages.set(name, image);
      imageFinished();
    };
    image.onerror = imageFinished;
    image.src = asset.data;
  }
}

function drawTurtleData(data: TurtleData, live = false): void {
  // ── Cancel any previous animation ──────────────────────────────────────────
  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }

  const cw      = (data.w && data.w > 0) ? Math.min(data.w, 1200) : 600;
  const ch      = (data.h && data.h > 0) ? Math.min(data.h, 900)  : 600;
  const bg      = data.bg ?? 'white';
  const shapes  = data.shapes ?? [];
  const polys   = data.polys;
  const cursors = data.cursors;

  // ── Setup visible canvas ───────────────────────────────────────────────────
  const turtleElements = getTurtleElements();
  if (!turtleElements) return;
  const { output: turtleWindow, canvas: turtleCanvas, body: turtleBody } = turtleElements;

  turtleCanvas.width  = cw;
  turtleCanvas.height = ch;
  const context = turtleCanvas.getContext('2d');
  if (context === null) return;

  // Keep a permanently non-null, explicitly typed alias. TypeScript may not
  // preserve null narrowing for `context` inside requestAnimationFrame callbacks.
  const ctx: CanvasRenderingContext2D = context;

  paintTurtleBackground(ctx, cw, ch, bg);

  // ── Scale the canvas to fit the screen while preserving aspect ratio ───────
  // The canvas keeps its full internal resolution (cw × ch); CSS max-* only
  // shrinks the on-screen size, so drawings stay crisp on small viewports.
  const maxCanvasW = Math.min(cw, Math.floor(window.innerWidth  * 0.6));
  const maxCanvasH = Math.min(ch, Math.floor(window.innerHeight * 0.7));
  turtleCanvas.style.maxWidth  = maxCanvasW + 'px';
  turtleCanvas.style.maxHeight = maxCanvasH + 'px';

  // ── Show the popup window ───────────────────────────────────────────────────
  showPopupWindow(turtleWindow);

  if (live) {
    // A debugger step is already the animation clock. Paint this snapshot and wait
    // for the student's next command.
    turtleBody.querySelector('#turtle-replay-controls')?.remove();
    drawTurtlePrefix(ctx, shapes, shapes.length, cw, ch, bg, cursors, polys);
    return;
  }

  const replay = createTurtleReplayControls(turtleBody, shapes, count => {
    drawTurtlePrefix(ctx, shapes, count, cw, ch, bg, cursors, polys);
  });

  // Nothing was drawn, but the turtles themselves are still worth showing -
  // that is what a real turtle window looks like after a program that only
  // moves the cursor around.
  if (shapes.length === 0) {
    turtleBody.querySelector('#turtle-replay-controls')?.remove();
    drawFinalCursors(ctx, cursors, cw, ch, polys);
    return;
  }

  const tx = (x: number) => cw / 2 + x;
  const ty = (y: number) => ch / 2 - y;

  // ── Off-screen accumulation buffer (completed shapes only) ─────────────────
  const offscreen = document.createElement('canvas');
  offscreen.width  = cw;
  offscreen.height = ch;
  const octx = offscreen.getContext('2d')!;
  paintTurtleBackground(octx, cw, ch, bg);

  // ── Animation mode ─────────────────────────────────────────────────────────
  const tracerVal = data.tracer ?? 1;
  const speedVal  = data.speed  ?? 3;          // default matches shim default (3)
  const INSTANT_LIMIT = 3000;                  // too many shapes → draw at once

  // Bookkeeping events (cursor moves, appearance changes, show/hide) put
  // nothing on the canvas, so they must not push a drawing into instant mode.
  const BOOKKEEPING = new Set(['M', 'SH', 'H', 'HT', 'ST']);
  let drawCount = 0;
  for (const s of shapes) if (!BOOKKEEPING.has(s.k)) drawCount++;

  if (tracerVal === 0 || speedVal === 0 || drawCount > INSTANT_LIMIT) {
    for (const s of shapes) drawTurtleShape(octx, s, cw, ch, bg, polys);
    ctx.drawImage(offscreen, 0, 0);
    drawFinalCursors(ctx, cursors, cw, ch, polys);
    replay.setProgress(shapes.length);
    return;
  }

  // ── Pixels per second for this speed ──────────────────────────────────────
  const clampedSpeed = Math.min(10, Math.max(1, Math.round(speedVal)));
  const pxPerSec = TURTLE_PX_PER_SEC[clampedSpeed] ?? 350;

  // ── Animated state ────────────────────────────────────────────────────────
  let curX = 0, curY = 0, curH = 0, curVisible = true;
  let curLook: TurtleLook = DEFAULT_LOOK;
  let shapeIdx    = 0;
  let lineProgress = 0; // 0..1 fractional progress within current 'l' shape
  let lastTime: number | null = null;

  function animFrame(time: number): void {
    // Cap dt at 100 ms so a tab-hidden burst doesn't jump the turtle
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    // Pixel budget for this frame
    let budget = pxPerSec * dt;

    // ── Advance through shapes using the pixel budget ──────────────────────
    while (budget >= 0 && shapeIdx < shapes.length) {
      const s = shapes[shapeIdx];

      if (s.k === 'l') {
        const dx  = (s.x2 as number) - (s.x1 as number);
        const dy  = (s.y2 as number) - (s.y1 as number);
        const len = Math.hypot(dx, dy);

        if (len < 0.5) {
          // Zero-length line - commit and move on
          drawTurtleShape(octx, s, cw, ch, bg, polys);
          curX = s.x2 as number; curY = s.y2 as number;
          curH = Math.atan2(dy, dx) * 180 / Math.PI;
          shapeIdx++; lineProgress = 0;
          replay.setProgress(shapeIdx);
          budget -= 1;
          continue;
        }

        // How much further along this line can we move this frame?
        const advance = budget / len;
        const newProg = lineProgress + advance;

        if (newProg >= 1) {
          // Complete this line: commit to offscreen, consume exact cost
          budget -= (1 - lineProgress) * len;
          lineProgress = 0;
          drawTurtleShape(octx, s, cw, ch, bg, polys);
          curX = s.x2 as number; curY = s.y2 as number;
          curH = Math.atan2(dy, dx) * 180 / Math.PI;
          shapeIdx++;
          replay.setProgress(shapeIdx);
        } else {
          // Partial: update progress and consume the whole budget
          budget = -1; // stop the while loop
          lineProgress = newProg;
          curX = (s.x1 as number) + dx * lineProgress;
          curY = (s.y1 as number) + dy * lineProgress;
          curH = Math.atan2(dy, dx) * 180 / Math.PI;
        }
      } else {
        // Non-line shapes: draw instantly, cost a tiny flat amount
        if (!BOOKKEEPING.has(s.k)) {
          drawTurtleShape(octx, s, cw, ch, bg, polys);
        }
        switch (s.k) {
          case 'M':  curX = s.x as number; curY = s.y as number; break;
          case 'F': {
            const pts = s.pts as number[][];
            if (pts?.length) { curX = pts[pts.length-1][0]; curY = pts[pts.length-1][1]; }
            break;
          }
          case 'D': case 'T': curX = s.x as number; curY = s.y as number; break;
          case 'S':
            curX = s.x as number; curY = s.y as number;
            curH = (s.h as number) ?? curH;
            break;
          case 'HT': curVisible = false; break;
          case 'ST': curVisible = true;  break;
          case 'H':  curH = Number(s.h ?? curH); break;
          case 'SH': curLook = mergeLook(curLook, s); break;
        }
        shapeIdx++; lineProgress = 0;
        replay.setProgress(shapeIdx);
        // Flat cost keeps non-line shapes visible briefly; a pure appearance
        // change draws nothing, so it must not eat into the frame budget.
        if (s.k !== 'SH') budget -= 5;
      }
    }

    // ── Render frame ──────────────────────────────────────────────────────────
    // 1. All completed shapes (offscreen buffer)
    ctx.drawImage(offscreen, 0, 0);

    // 2. Partial current line (not yet committed to offscreen)
    if (lineProgress > 0 && shapeIdx < shapes.length && shapes[shapeIdx].k === 'l') {
      const s = shapes[shapeIdx];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx(s.x1 as number), ty(s.y1 as number));
      ctx.lineTo(tx(curX), ty(curY));
      ctx.strokeStyle = String(s.c ?? 'black');
      ctx.lineWidth   = Number(s.w ?? 1);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Cursor overlay - while drawing, the single animated cursor; once the
    //    replay is over, every turtle at its final position (a program can use
    //    several Turtle() objects, all of which stay on screen at the end).
    const finished = shapeIdx >= shapes.length && lineProgress <= 0;
    if (finished && cursors) {
      drawFinalCursors(ctx, cursors, cw, ch, polys);
    } else if (curVisible) {
      drawTurtleCursor(ctx, tx(curX), ty(curY), curH, curLook, polys);
    }

    // ── Continue or finish ────────────────────────────────────────────────────
    if (!finished) {
      turtleAnimRafId = requestAnimationFrame(animFrame);
    } else {
      turtleAnimRafId = null;
    }
  }

  turtleAnimRafId = requestAnimationFrame(animFrame);
}

/** Cancel any running animation, hide the popup window, and clear its pixels. */
export function clearTurtleCanvas(): void {
  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }
  stopTurtleReplay();
  turtleReplayDecorations?.clear();

  // Also invalidate a background picture that is still loading, so a slow
  // decode from the previous run cannot draw into the cleared canvas.
  turtleRenderSeq++;
  turtleBgImage = null;
  turtleSvgImages = new Map<string, HTMLImageElement>();
  turtleSvgAssets = {};

  // Normal code execution calls this even when the page has no turtle UI.
  // Missing optional elements must therefore be a no-op, never a run failure.
  const canvas = turtleCanvasEl ?? document.getElementById('turtle-canvas') as HTMLCanvasElement | null;
  document.getElementById('turtle-replay-controls')?.remove();

  hidePopupWindow(TURTLE_WINDOW_ID);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

function updateTurtleTranslations(): void {
  const title = document.getElementById(`${TURTLE_WINDOW_ID}-title`);
  if (title) title.textContent = `\uD83D\uDC22 ${t('turtle.graphics')}`;

  const controls = document.getElementById('turtle-replay-controls');
  if (!controls) return;
  const back = controls.querySelector<HTMLElement>('[data-replay-action="back"]');
  const play = controls.querySelector<HTMLElement>('[data-replay-action="play"]');
  const forward = controls.querySelector<HTMLElement>('[data-replay-action="forward"]');
  const range = controls.querySelector<HTMLInputElement>('input[type="range"]');
  const speed = controls.querySelector<HTMLElement>('[data-replay-action="speed"]');
  const label = controls.querySelector<HTMLElement>('.turtle-replay-label');

  if (back) back.title = t('turtle.previousStep');
  if (play) {
    play.title = t('turtle.playPause');
    play.textContent = `${turtleReplayTimer === null ? '▶' : '⏸'} ${t(turtleReplayTimer === null ? 'turtle.replay' : 'turtle.pause')}`;
  }
  if (forward) forward.title = t('turtle.nextStep');
  if (range) range.setAttribute('aria-label', t('turtle.position'));
  if (speed) speed.title = t('turtle.speed');
  if (label && range) {
    label.textContent = t('turtle.stepOf', { step: range.value, total: range.max });
  }
}

window.addEventListener('languageChanged', updateTurtleTranslations);
