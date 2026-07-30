import {
  panelEl,
  turtleOutputEl,
  turtleCanvasEl,
} from "./dom";

// ── Browser Turtle renderer with native SVG cursor support ───────────────────
//
// Compatible with the existing browser-coder Turtle JSON and with the extended
// data emitted by languages/python/turtle_shim.py in this bundle.
//
// New fields:
//   cursorAssets: { [shapeName]: { dataUrl, width, height, rotate } }
//   cursor:       final/default cursor state
//   cursors:      final states for multiple turtles
//
// New action kinds:
//   M  pen-up movement
//   R  heading change
//   V  visibility change
//   I  cursor image/shape change
//
// Existing l/F/D/T/C/S actions remain supported.
// ─────────────────────────────────────────────────────────────────────────────

export interface TurtleShape {
  k: string;
  [key: string]: unknown;
}

export interface TurtleCursorAsset {
  dataUrl?: string;
  width?: number;
  height?: number;
  rotate?: boolean;
}

export interface TurtleCursorState {
  id?: number;
  x?: number;
  y?: number;
  h?: number;
  visible?: boolean;
  shape?: string;
  color?: string;
  width?: number;
  height?: number;
  rotate?: boolean;
}

export interface TurtleData {
  bg?: string;
  w?: number;
  h?: number;
  tracer?: number;
  speed?: number;
  delay?: number;
  title?: string;
  shapes?: TurtleShape[];

  // Existing projects/server versions may use any of these names.
  picData?: string;
  picUrl?: string;
  bgpic?: string;
  backgroundImage?: string;

  cursorAssets?: Record<string, TurtleCursorAsset>;
  cursor?: TurtleCursorState;
  cursors?: TurtleCursorState[];
}

interface RuntimeCursor {
  id: number;
  x: number;
  y: number;
  h: number;
  visible: boolean;
  shape: string;
  color: string;
  width: number;
  height: number;
  rotate: boolean;
}

type ImageMap = Map<string, HTMLImageElement>;

let turtleAnimRafId: number | null = null;
let turtleRenderGeneration = 0;

const BUILTIN_CURSOR_WIDTH = 22;
const BUILTIN_CURSOR_HEIGHT = 16;
const TURN_DURATION_MS = 90;
const COMMAND_PAUSE_MS = 12;

const TURTLE_PX_PER_SEC: Record<number, number> = {
  1: 100,
  2: 200,
  3: 350,
  4: 600,
  5: 1000,
  6: 1600,
  7: 2500,
  8: 4000,
  9: 6500,
  10: 10000,
};

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function turtleId(shape: TurtleShape): number {
  return Math.max(0, Math.trunc(finiteNumber(shape.tid, 0)));
}

function imageSource(data: TurtleData): string | null {
  const candidates = [
    data.picData,
    data.picUrl,
    data.bgpic,
    data.backgroundImage,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function preloadImages(data: TurtleData): Promise<{
  background: HTMLImageElement | null;
  cursors: ImageMap;
}> {
  const cursorImages: ImageMap = new Map();
  const tasks: Promise<void>[] = [];

  for (const [name, asset] of Object.entries(data.cursorAssets ?? {})) {
    if (!asset || typeof asset.dataUrl !== "string" || !asset.dataUrl) continue;
    tasks.push(
      loadImage(asset.dataUrl).then((image) => {
        if (image) cursorImages.set(name, image);
      }),
    );
  }

  let background: HTMLImageElement | null = null;
  const source = imageSource(data);
  if (source) {
    tasks.push(
      loadImage(source).then((image) => {
        background = image;
      }),
    );
  }

  await Promise.all(tasks);
  return { background, cursors: cursorImages };
}

function cloneCursor(source: TurtleCursorState | undefined, id: number): RuntimeCursor {
  return {
    id,
    x: finiteNumber(source?.x, 0),
    y: finiteNumber(source?.y, 0),
    h: finiteNumber(source?.h, 0),
    visible: boolValue(source?.visible, true),
    shape: typeof source?.shape === "string" ? source.shape : "classic",
    color: typeof source?.color === "string" ? source.color : "rgba(0, 170, 0, 0.90)",
    width: Math.max(2, finiteNumber(source?.width, BUILTIN_CURSOR_WIDTH)),
    height: Math.max(2, finiteNumber(source?.height, BUILTIN_CURSOR_HEIGHT)),
    rotate: boolValue(source?.rotate, true),
  };
}

function initialCursorMap(data: TurtleData): Map<number, RuntimeCursor> {
  const cursors = new Map<number, RuntimeCursor>();

  if (Array.isArray(data.cursors)) {
    for (const cursor of data.cursors) {
      const id = Math.max(0, Math.trunc(finiteNumber(cursor.id, cursors.size)));
      cursors.set(id, cloneCursor(cursor, id));
    }
  }

  if (cursors.size === 0) {
    const id = Math.max(0, Math.trunc(finiteNumber(data.cursor?.id, 0)));
    cursors.set(id, cloneCursor(data.cursor, id));
  }

  // Replay starts at Turtle's standard initial state. Shape-change actions will
  // apply custom SVGs at the correct point in the command stream.
  for (const cursor of cursors.values()) {
    cursor.x = 0;
    cursor.y = 0;
    cursor.h = 0;
    cursor.visible = true;
    cursor.shape = "classic";
    cursor.width = BUILTIN_CURSOR_WIDTH;
    cursor.height = BUILTIN_CURSOR_HEIGHT;
    cursor.rotate = true;
  }

  return cursors;
}

function applyLeadingCursorEvents(
  shapes: TurtleShape[],
  cursors: Map<number, RuntimeCursor>,
  data: TurtleData,
): void {
  // Apply setup-only cursor commands before the first visible movement. This
  // prevents a one-frame flash of the built-in turtle before a registered SVG
  // shape is selected. The commands remain in the replay and are idempotent.
  for (const shape of shapes) {
    if (shape.k === "I" || shape.k === "V" || shape.k === "R") {
      applyCursorEvent(shape, cursors, data);
      continue;
    }
    if (shape.k === "M" || shape.k === "l") break;
  }
}

function cursorFor(cursors: Map<number, RuntimeCursor>, id: number): RuntimeCursor {
  let cursor = cursors.get(id);
  if (!cursor) {
    cursor = cloneCursor(undefined, id);
    cursors.set(id, cursor);
  }
  return cursor;
}

function drawBuiltinCursor(
  ctx: CanvasRenderingContext2D,
  cursor: RuntimeCursor,
): void {
  const shape = cursor.shape.toLowerCase();
  const width = Math.max(4, cursor.width);
  const height = Math.max(4, cursor.height);

  ctx.fillStyle = cursor.color;
  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();

  if (shape === "circle") {
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (shape === "square") {
    ctx.rect(-width / 2, -height / 2, width, height);
  } else if (shape === "triangle") {
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(-width / 2, -height / 2);
    ctx.lineTo(-width / 2, height / 2);
    ctx.closePath();
  } else if (shape === "turtle") {
    // A compact turtle silhouette. It remains a fallback only; registered SVG
    // shapes are drawn by drawCursor() below.
    ctx.ellipse(0, 0, width * 0.34, height * 0.38, 0, 0, Math.PI * 2);
    ctx.moveTo(width * 0.34, 0);
    ctx.ellipse(width * 0.43, 0, width * 0.11, height * 0.13, 0, 0, Math.PI * 2);
  } else {
    // classic / arrow
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(-width * 0.32, -height * 0.34);
    ctx.lineTo(-width * 0.16, 0);
    ctx.lineTo(-width * 0.32, height * 0.34);
    ctx.closePath();
  }

  ctx.fill();
  ctx.stroke();
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  cursor: RuntimeCursor,
  images: ImageMap,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!cursor.visible) return;

  const cx = canvasWidth / 2 + cursor.x;
  const cy = canvasHeight / 2 - cursor.y;
  const image = images.get(cursor.shape);

  ctx.save();
  ctx.translate(cx, cy);
  if (cursor.rotate) {
    ctx.rotate(-cursor.h * Math.PI / 180);
  }

  if (image) {
    const width = Math.max(2, cursor.width);
    const height = Math.max(2, cursor.height);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
  } else {
    ctx.rotate(cursor.rotate ? 0 : -cursor.h * Math.PI / 180);
    drawBuiltinCursor(ctx, cursor);
  }

  ctx.restore();
}

function drawAllCursors(
  ctx: CanvasRenderingContext2D,
  cursors: Map<number, RuntimeCursor>,
  images: ImageMap,
  canvasWidth: number,
  canvasHeight: number,
): void {
  for (const cursor of cursors.values()) {
    drawCursor(ctx, cursor, images, canvasWidth, canvasHeight);
  }
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  shape: TurtleShape,
  images: ImageMap,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const cursor = cloneCursor({
    id: turtleId(shape),
    x: finiteNumber(shape.x, 0),
    y: finiteNumber(shape.y, 0),
    h: finiteNumber(shape.h, 0),
    visible: true,
    shape: typeof shape.n === "string" ? shape.n : "classic",
    color: typeof shape.c === "string" ? shape.c : "black",
    width: finiteNumber(shape.sw, BUILTIN_CURSOR_WIDTH),
    height: finiteNumber(shape.sh, BUILTIN_CURSOR_HEIGHT),
    rotate: boolValue(shape.r, true),
  }, turtleId(shape));

  drawCursor(ctx, cursor, images, canvasWidth, canvasHeight);
}

function paintBase(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string,
  backgroundImage: HTMLImageElement | null,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  if (backgroundImage) {
    ctx.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight);
  }
}

function drawTurtleShape(
  ctx: CanvasRenderingContext2D,
  shape: TurtleShape,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string,
  backgroundImage: HTMLImageElement | null,
  images: ImageMap,
): void {
  const tx = (x: number) => canvasWidth / 2 + x;
  const ty = (y: number) => canvasHeight / 2 - y;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  try {
    switch (shape.k) {
      case "l": {
        ctx.beginPath();
        ctx.moveTo(tx(finiteNumber(shape.x1)), ty(finiteNumber(shape.y1)));
        ctx.lineTo(tx(finiteNumber(shape.x2)), ty(finiteNumber(shape.y2)));
        ctx.strokeStyle = String(shape.c ?? "black");
        ctx.lineWidth = Math.max(0.1, finiteNumber(shape.w, 1));
        ctx.stroke();
        break;
      }

      case "F": {
        const points = shape.pts as unknown;
        if (!Array.isArray(points) || points.length < 2) break;
        const normalized = points.filter(
          (point): point is [number, number] =>
            Array.isArray(point) && point.length >= 2,
        );
        if (normalized.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(tx(finiteNumber(normalized[0][0])), ty(finiteNumber(normalized[0][1])));
        for (let index = 1; index < normalized.length; index += 1) {
          ctx.lineTo(tx(finiteNumber(normalized[index][0])), ty(finiteNumber(normalized[index][1])));
        }
        ctx.closePath();
        ctx.fillStyle = String(shape.fc ?? "black");
        ctx.fill();
        if (shape.pc) {
          ctx.strokeStyle = String(shape.pc);
          ctx.lineWidth = Math.max(0.1, finiteNumber(shape.pw, 1));
          ctx.stroke();
        }
        break;
      }

      case "D": {
        ctx.beginPath();
        ctx.arc(
          tx(finiteNumber(shape.x)),
          ty(finiteNumber(shape.y)),
          Math.max(0.5, finiteNumber(shape.r, 5)),
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = String(shape.c ?? "black");
        ctx.fill();
        break;
      }

      case "T": {
        ctx.font = String(shape.font ?? "12px Arial");
        ctx.fillStyle = String(shape.c ?? "black");
        ctx.textAlign = String(shape.align ?? "left") as CanvasTextAlign;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(
          String(shape.txt ?? ""),
          tx(finiteNumber(shape.x)),
          ty(finiteNumber(shape.y)),
        );
        break;
      }

      case "C": {
        paintBase(ctx, canvasWidth, canvasHeight, backgroundColor, backgroundImage);
        break;
      }

      case "S": {
        drawStamp(ctx, shape, images, canvasWidth, canvasHeight);
        break;
      }
    }
  } catch {
    // A malformed user drawing command should not break the complete preview.
  }

  ctx.restore();
}

function applyCursorEvent(
  shape: TurtleShape,
  cursors: Map<number, RuntimeCursor>,
  data: TurtleData,
): void {
  const cursor = cursorFor(cursors, turtleId(shape));

  if (shape.k === "R") {
    cursor.h = finiteNumber(shape.h, cursor.h);
    cursor.x = finiteNumber(shape.x, cursor.x);
    cursor.y = finiteNumber(shape.y, cursor.y);
    return;
  }

  if (shape.k === "V") {
    cursor.visible = boolValue(shape.v, cursor.visible);
    cursor.x = finiteNumber(shape.x, cursor.x);
    cursor.y = finiteNumber(shape.y, cursor.y);
    cursor.h = finiteNumber(shape.h, cursor.h);
    return;
  }

  if (shape.k === "I") {
    const name = typeof shape.n === "string" ? shape.n : cursor.shape;
    const asset = data.cursorAssets?.[name];
    cursor.shape = name;
    cursor.color = typeof shape.c === "string" ? shape.c : cursor.color;
    cursor.width = Math.max(
      2,
      finiteNumber(shape.sw, finiteNumber(asset?.width, cursor.width)),
    );
    cursor.height = Math.max(
      2,
      finiteNumber(shape.sh, finiteNumber(asset?.height, cursor.height)),
    );
    cursor.rotate = boolValue(shape.r, boolValue(asset?.rotate, cursor.rotate));
    cursor.x = finiteNumber(shape.x, cursor.x);
    cursor.y = finiteNumber(shape.y, cursor.y);
    cursor.h = finiteNumber(shape.h, cursor.h);
  }
}

function syncCursorToShape(shape: TurtleShape, cursors: Map<number, RuntimeCursor>): void {
  const cursor = cursorFor(cursors, turtleId(shape));
  if (shape.k === "l" || shape.k === "M") {
    cursor.x = finiteNumber(shape.x2, cursor.x);
    cursor.y = finiteNumber(shape.y2, cursor.y);
    cursor.h = finiteNumber(shape.h, cursor.h);
  } else if (["D", "T", "S"].includes(shape.k)) {
    cursor.x = finiteNumber(shape.x, cursor.x);
    cursor.y = finiteNumber(shape.y, cursor.y);
    cursor.h = finiteNumber(shape.h, cursor.h);
  }
}

function renderSnapshot(
  visibleContext: CanvasRenderingContext2D,
  offscreen: HTMLCanvasElement,
  cursors: Map<number, RuntimeCursor>,
  images: ImageMap,
  canvasWidth: number,
  canvasHeight: number,
): void {
  visibleContext.clearRect(0, 0, canvasWidth, canvasHeight);
  visibleContext.drawImage(offscreen, 0, 0);
  drawAllCursors(visibleContext, cursors, images, canvasWidth, canvasHeight);
}

function renderInstant(
  data: TurtleData,
  context: CanvasRenderingContext2D,
  offscreen: HTMLCanvasElement,
  offscreenContext: CanvasRenderingContext2D,
  cursors: Map<number, RuntimeCursor>,
  images: ImageMap,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string,
  backgroundImage: HTMLImageElement | null,
): void {
  for (const shape of data.shapes ?? []) {
    if (["R", "V", "I"].includes(shape.k)) {
      applyCursorEvent(shape, cursors, data);
      continue;
    }

    if (shape.k === "M") {
      syncCursorToShape(shape, cursors);
      continue;
    }

    drawTurtleShape(
      offscreenContext,
      shape,
      canvasWidth,
      canvasHeight,
      backgroundColor,
      backgroundImage,
      images,
    );
    syncCursorToShape(shape, cursors);
  }

  renderSnapshot(context, offscreen, cursors, images, canvasWidth, canvasHeight);
}

function resolveTurtleCanvas(): HTMLCanvasElement | null {
  return (
    turtleCanvasEl ??
    (document.getElementById("turtle-canvas") as HTMLCanvasElement | null)
  );
}

function resolveTurtleOutput(): HTMLElement | null {
  return (
    turtleOutputEl ??
    document.getElementById("turtle-output")
  );
}

function resolveOutputPanel(): HTMLElement | null {
  return (
    panelEl ??
    document.getElementById("panel")
  );
}

function hasImageAssets(data: TurtleData): boolean {
  if (imageSource(data)) return true;

  return Object.values(data.cursorAssets ?? {}).some(
    (asset) => Boolean(asset?.dataUrl),
  );
}

export function clearTurtleCanvas(): void {
  turtleRenderGeneration += 1;

  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }

  const canvas = resolveTurtleCanvas();
  const output = resolveTurtleOutput();

  if (canvas) {
    const context = canvas.getContext("2d");

    if (context) {
      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height,
      );
    }
  }

  output?.classList.add("hidden");
}

export function renderTurtle(data: TurtleData): void {
  const generation = ++turtleRenderGeneration;

  if (turtleAnimRafId !== null) {
    cancelAnimationFrame(turtleAnimRafId);
    turtleAnimRafId = null;
  }

  // Only the canvas is required. The output wrapper and resizable panel are
  // optional UI helpers and must never be allowed to cancel Turtle rendering.
  const canvas = resolveTurtleCanvas();
  const output = resolveTurtleOutput();
  const panel = resolveOutputPanel();

  if (!canvas) {
    console.error(
      "Turtle renderer could not start because #turtle-canvas is missing.",
    );
    return;
  }

  const canvasWidth =
    data.w && data.w > 0
      ? Math.min(data.w, 1200)
      : 600;
  const canvasHeight =
    data.h && data.h > 0
      ? Math.min(data.h, 900)
      : 600;
  const backgroundColor = data.bg ?? "white";

  // Open the preview immediately. This is deliberately done before SVG/image
  // preloading so ordinary Turtle programs never depend on the asset loader.
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  output?.classList.remove("hidden");

  const initialContext = canvas.getContext("2d");
  if (!initialContext) return;
  paintBase(
    initialContext,
    canvasWidth,
    canvasHeight,
    backgroundColor,
    null,
  );

  if (panel) {
    const targetHeight = Math.min(
      canvasHeight + 80,
      Math.floor(window.innerHeight * 0.72),
    );

    if (panel.offsetHeight < targetHeight) {
      panel.style.height = `${targetHeight}px`;
    }
  }

  const renderPrepared = (
    background: HTMLImageElement | null,
    images: ImageMap,
  ): void => {
    if (generation !== turtleRenderGeneration) return;

    // Re-setting dimensions intentionally clears the temporary loading frame.
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const maybeContext = canvas.getContext("2d");
    if (!maybeContext) return;
    const context: CanvasRenderingContext2D = maybeContext;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvasWidth;
    offscreen.height = canvasHeight;

    const maybeOffscreenContext = offscreen.getContext("2d");
    if (!maybeOffscreenContext) return;
    const offscreenContext: CanvasRenderingContext2D = maybeOffscreenContext;

    paintBase(
      offscreenContext,
      canvasWidth,
      canvasHeight,
      backgroundColor,
      background,
    );

    const shapes = data.shapes ?? [];
    const runtimeCursors = initialCursorMap(data);
    applyLeadingCursorEvents(shapes, runtimeCursors, data);

    renderSnapshot(
      context,
      offscreen,
      runtimeCursors,
      images,
      canvasWidth,
      canvasHeight,
    );

    if (shapes.length === 0) return;

    const tracerValue = data.tracer ?? 1;
    const speedValue = data.speed ?? 3;
    const instantLimit = 3000;

    if (
      tracerValue === 0 ||
      speedValue === 0 ||
      shapes.length > instantLimit
    ) {
      renderInstant(
        data,
        context,
        offscreen,
        offscreenContext,
        runtimeCursors,
        images,
        canvasWidth,
        canvasHeight,
        backgroundColor,
        background,
      );
      return;
    }

    const clampedSpeed = Math.min(
      10,
      Math.max(1, Math.round(speedValue)),
    );
    const pixelsPerSecond =
      TURTLE_PX_PER_SEC[clampedSpeed] ?? 350;

    let shapeIndex = 0;
    let movementProgress = 0;
    let turnProgress = 0;
    let lastTime: number | null = null;
    let commandPauseRemaining = 0;

    function animate(time: number): void {
      if (generation !== turtleRenderGeneration) return;

      const deltaSeconds =
        lastTime === null
          ? 0
          : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      let pixelBudget = pixelsPerSecond * deltaSeconds;
      let timeBudgetMs = deltaSeconds * 1000;

      while (shapeIndex < shapes.length) {
        const shape = shapes[shapeIndex];

        if (commandPauseRemaining > 0) {
          const used = Math.min(
            commandPauseRemaining,
            timeBudgetMs,
          );
          commandPauseRemaining -= used;
          timeBudgetMs -= used;

          if (commandPauseRemaining > 0) break;
        }

        if (shape.k === "l" || shape.k === "M") {
          const cursor = cursorFor(
            runtimeCursors,
            turtleId(shape),
          );
          const startX = finiteNumber(shape.x1, cursor.x);
          const startY = finiteNumber(shape.y1, cursor.y);
          const endX = finiteNumber(shape.x2, startX);
          const endY = finiteNumber(shape.y2, startY);
          const dx = endX - startX;
          const dy = endY - startY;
          const length = Math.hypot(dx, dy);

          if (length < 0.01) {
            if (shape.k === "l") {
              drawTurtleShape(
                offscreenContext,
                shape,
                canvasWidth,
                canvasHeight,
                backgroundColor,
                background,
                images,
              );
            }

            cursor.x = endX;
            cursor.y = endY;
            cursor.h = finiteNumber(shape.h, cursor.h);
            shapeIndex += 1;
            movementProgress = 0;
            continue;
          }

          const remainingDistance =
            (1 - movementProgress) * length;

          if (pixelBudget >= remainingDistance) {
            if (shape.k === "l") {
              drawTurtleShape(
                offscreenContext,
                shape,
                canvasWidth,
                canvasHeight,
                backgroundColor,
                background,
                images,
              );
            }

            cursor.x = endX;
            cursor.y = endY;
            cursor.h = finiteNumber(
              shape.h,
              Math.atan2(dy, dx) * 180 / Math.PI,
            );
            pixelBudget -= remainingDistance;
            shapeIndex += 1;
            movementProgress = 0;
            commandPauseRemaining = COMMAND_PAUSE_MS;
            continue;
          }

          if (pixelBudget > 0) {
            movementProgress += pixelBudget / length;
            cursor.x = startX + dx * movementProgress;
            cursor.y = startY + dy * movementProgress;
            cursor.h = finiteNumber(
              shape.h,
              Math.atan2(dy, dx) * 180 / Math.PI,
            );
            pixelBudget = 0;
          }

          break;
        }

        if (shape.k === "R") {
          const cursor = cursorFor(
            runtimeCursors,
            turtleId(shape),
          );
          const target = finiteNumber(shape.h, cursor.h);
          const start = cursor.h;
          const difference =
            ((target - start + 540) % 360) - 180;
          const progressAdvance =
            timeBudgetMs / TURN_DURATION_MS;
          const nextProgress = Math.min(
            1,
            turnProgress + progressAdvance,
          );

          cursor.h =
            start +
            difference *
              (nextProgress - turnProgress) /
              Math.max(1 - turnProgress, 0.0001);
          turnProgress = nextProgress;
          timeBudgetMs = 0;

          if (turnProgress >= 1) {
            cursor.h = target;
            cursor.x = finiteNumber(shape.x, cursor.x);
            cursor.y = finiteNumber(shape.y, cursor.y);
            shapeIndex += 1;
            turnProgress = 0;
            commandPauseRemaining = COMMAND_PAUSE_MS;
          }

          break;
        }

        if (shape.k === "V" || shape.k === "I") {
          applyCursorEvent(shape, runtimeCursors, data);
          shapeIndex += 1;
          commandPauseRemaining = COMMAND_PAUSE_MS;
          continue;
        }

        drawTurtleShape(
          offscreenContext,
          shape,
          canvasWidth,
          canvasHeight,
          backgroundColor,
          background,
          images,
        );
        syncCursorToShape(shape, runtimeCursors);
        shapeIndex += 1;
        commandPauseRemaining = COMMAND_PAUSE_MS;
      }

      renderSnapshot(
        context,
        offscreen,
        runtimeCursors,
        images,
        canvasWidth,
        canvasHeight,
      );

      if (shapeIndex < shapes.length) {
        turtleAnimRafId = requestAnimationFrame(animate);
      } else {
        turtleAnimRafId = null;
      }
    }

    turtleAnimRafId = requestAnimationFrame(animate);
  };

  // Ordinary Turtle drawings are rendered synchronously. SVG/background image
  // programs use the async loader, but the panel is already open and visible.
  if (!hasImageAssets(data)) {
    renderPrepared(null, new Map());
    return;
  }

  void preloadImages(data)
    .then(({ background, cursors: images }) => {
      renderPrepared(background, images);
    })
    .catch((error: unknown) => {
      console.error("Turtle image preload failed:", error);

      // Keep the Turtle preview functional with built-in cursor fallbacks even
      // when a malformed SVG or browser image decoder rejects an asset.
      renderPrepared(null, new Map());
    });
}
