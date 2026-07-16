import {
  panelEl,
  turtleOutputEl,
  turtleCanvasEl,
} from "./dom";

// ── Turtle graphics renderer ─────────────────────────────────────────────────
// Animated step-by-step replay of the drawing commands captured by the Python
// shim, with a moving turtle cursor — just like a real IDE.
//
// Architecture: double-buffer
//   offscreen canvas  — all shapes accumulated so far (never erased mid-run)
//   visible canvas    — offscreen snapshot + cursor composited on top each frame
//
// Coordinate system:
//   Python turtle: origin at centre, y increases upward
//   HTML canvas:   origin at top-left, y increases downward
//   → canvasX = canvasWidth/2  + turtleX
//   → canvasY = canvasHeight/2 - turtleY
// ─────────────────────────────────────────────────────────────────────────────

export interface TurtleShape {
  k: string;
  [key: string]: unknown;
}

export interface TurtleData {
  bg?:     string;
  w?:      number;
  h?:      number;
  tracer?: number;
  speed?:  number;
  shapes?: TurtleShape[];
}

// Animation RAF id (requestAnimationFrame) — null when idle
let turtleAnimRafId: number | null = null;

/**
 * Resolve the turtle UI lazily. Older deployments do not include the turtle
 * elements in index.html, so create them on demand instead of crashing every
 * normal (non-turtle) run when clearTurtleCanvas() is called.
 */
function getTurtleElements(): { output: HTMLElement; canvas: HTMLCanvasElement } | null {
  let output = turtleOutputEl ?? document.getElementById('turtle-output');
  let canvas = turtleCanvasEl ?? document.getElementById('turtle-canvas') as HTMLCanvasElement | null;

  if (!output) {
    output = document.createElement('div');
    output.id = 'turtle-output';
    output.className = 'hidden';
    output.style.overflow = 'auto';
    output.style.padding = '8px 12px';
    output.style.textAlign = 'center';
    output.style.background = 'var(--bg-panel, #1e1e1e)';
    panelEl.appendChild(output);
  }

  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'turtle-canvas';
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.margin = '0 auto';
    canvas.style.background = '#fff';
    output.appendChild(canvas);
  } else if (canvas.parentElement !== output) {
    output.appendChild(canvas);
  }

  return { output, canvas };
}

/** Draw the green turtle-arrow cursor at canvas position (cx, cy). */
function drawTurtleCursor(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  headingDeg: number,
): void {
  const rad = -headingDeg * Math.PI / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(0, 170, 0, 0.90)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth   = 0.8;
  ctx.stroke();
  ctx.restore();
}

/** Draw a single shape onto `sctx`. */
function drawTurtleShape(
  sctx: CanvasRenderingContext2D,
  s: TurtleShape,
  cw: number, ch: number,
  bg: string,
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
        sctx.clearRect(0, 0, cw, ch);
        sctx.fillStyle = bg;
        sctx.fillRect(0, 0, cw, ch);
        break;
      }
      case 'S': {
        const sx  = tx(s.x as number);
        const sy  = ty(s.y as number);
        const rad = -(s.h as number ?? 0) * Math.PI / 180;
        sctx.save();
        sctx.translate(sx, sy);
        sctx.rotate(rad);
        sctx.beginPath();
        sctx.moveTo(10, 0);
        sctx.lineTo(-7, -5);
        sctx.lineTo(-4, 0);
        sctx.lineTo(-7, 5);
        sctx.closePath();
        sctx.fillStyle = String(s.c ?? 'black');
        sctx.fill();
        sctx.restore();
        break;
      }
    }
  } catch (_e) { /* skip malformed shapes */ }
  sctx.restore();
}

// ── Pixel-per-second speeds for each turtle speed level (1–10) ───────────────
// Calibrated to match real Python IDLE turtle feel.
// speed(3) is the default (real turtle default) — feels educational and visible.
// speed(0) / tracer(0) are handled separately as "instant".
const TURTLE_PX_PER_SEC: Record<number, number> = {
  1: 100, 2: 200, 3: 350, 4: 600,
  5: 1000, 6: 1600, 7: 2500, 8: 4000, 9: 6500, 10: 10000,
};

export function renderTurtle(data: TurtleData): void {
  // ── Cancel any previous animation ──────────────────────────────────────────
  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }

  const cw     = (data.w && data.w > 0) ? Math.min(data.w, 1200) : 600;
  const ch     = (data.h && data.h > 0) ? Math.min(data.h, 900)  : 600;
  const bg     = data.bg ?? 'white';
  const shapes = data.shapes ?? [];

  // ── Setup visible canvas ───────────────────────────────────────────────────
  const turtleElements = getTurtleElements();
  if (!turtleElements) return;
  const { output: turtleOutput, canvas: turtleCanvas } = turtleElements;

  turtleCanvas.width  = cw;
  turtleCanvas.height = ch;
  const context = turtleCanvas.getContext('2d');
  if (context === null) return;

  // Keep a permanently non-null, explicitly typed alias. TypeScript may not
  // preserve null narrowing for `context` inside requestAnimationFrame callbacks.
  const ctx: CanvasRenderingContext2D = context;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  // ── Show panel + expand to fit ─────────────────────────────────────────────
  turtleOutput.classList.remove('hidden');
  const targetH = Math.min(ch + 80, Math.floor(window.innerHeight * 0.72));
  if (panelEl.offsetHeight < targetH) panelEl.style.height = targetH + 'px';

  if (shapes.length === 0) return;

  const tx = (x: number) => cw / 2 + x;
  const ty = (y: number) => ch / 2 - y;

  // ── Off-screen accumulation buffer (completed shapes only) ─────────────────
  const offscreen = document.createElement('canvas');
  offscreen.width  = cw;
  offscreen.height = ch;
  const octx = offscreen.getContext('2d')!;
  octx.fillStyle = bg;
  octx.fillRect(0, 0, cw, ch);

  // ── Animation mode ─────────────────────────────────────────────────────────
  const tracerVal = data.tracer ?? 1;
  const speedVal  = data.speed  ?? 3;          // default matches shim default (3)
  const INSTANT_LIMIT = 3000;                  // too many shapes → draw at once

  if (tracerVal === 0 || speedVal === 0 || shapes.length > INSTANT_LIMIT) {
    for (const s of shapes) drawTurtleShape(octx, s, cw, ch, bg);
    ctx.drawImage(offscreen, 0, 0);
    return;
  }

  // ── Pixels per second for this speed ──────────────────────────────────────
  const clampedSpeed = Math.min(10, Math.max(1, Math.round(speedVal)));
  const pxPerSec = TURTLE_PX_PER_SEC[clampedSpeed] ?? 350;

  // ── Animated state ────────────────────────────────────────────────────────
  let curX = 0, curY = 0, curH = 0, curVisible = true;
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
          // Zero-length line — commit and move on
          drawTurtleShape(octx, s, cw, ch, bg);
          curX = s.x2 as number; curY = s.y2 as number;
          curH = Math.atan2(dy, dx) * 180 / Math.PI;
          shapeIdx++; lineProgress = 0;
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
          drawTurtleShape(octx, s, cw, ch, bg);
          curX = s.x2 as number; curY = s.y2 as number;
          curH = Math.atan2(dy, dx) * 180 / Math.PI;
          shapeIdx++;
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
        if (s.k !== 'M' && s.k !== 'HT' && s.k !== 'ST') {
          drawTurtleShape(octx, s, cw, ch, bg);
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
        }
        shapeIdx++; lineProgress = 0;
        budget -= 5; // flat cost keeps non-line shapes visible briefly
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

    // 3. Cursor overlay
    if (curVisible) drawTurtleCursor(ctx, tx(curX), ty(curY), curH);

    // ── Continue or finish ────────────────────────────────────────────────────
    if (shapeIdx < shapes.length || lineProgress > 0) {
      turtleAnimRafId = requestAnimationFrame(animFrame);
    } else {
      turtleAnimRafId = null;
    }
  }

  turtleAnimRafId = requestAnimationFrame(animFrame);
}

/** Cancel any running animation, hide the canvas, and clear its pixels. */
export function clearTurtleCanvas(): void {
  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }

  // Normal code execution calls this even when the page has no turtle UI.
  // Missing optional elements must therefore be a no-op, never a run failure.
  const output = turtleOutputEl ?? document.getElementById('turtle-output');
  const canvas = turtleCanvasEl ?? document.getElementById('turtle-canvas') as HTMLCanvasElement | null;

  output?.classList.add('hidden');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}
