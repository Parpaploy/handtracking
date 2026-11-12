import { useEffect, useRef, useState } from "react";
import { HandLandmarker } from "@mediapipe/tasks-vision";
import { getSharedFileset } from "../lib/mediapipe-fileset";
import {
  createLandmarkFilter,
  filterLandmarks,
  resetLandmarkFilter,
  type LandmarkFilter,
  type OneEuroParams,
} from "../lib/one-euro";
import {
  CAMERA_CONSTRAINTS,
  MAX_HANDS,
  createHandIdTracker,
  drawVideoCover,
  mapToStage,
  resizeKeepingContent,
  syncCanvasToDisplay,
} from "../lib/stage";
import type { Landmark, DrawMode } from "../interfaces/hand-tracking.interface";

const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const FINGERTIPS = [4, 8, 12, 16, 20];
// Gestures are read from MediaPipe's 3D world landmarks, and every
// distance is divided by the hand's own size (wrist ↔ middle knuckle), so
// they work the same for any camera angle and any player distance.
//
// Pinch: thumb tip ↔ index tip gap. Starts below ON, holds until above OFF.
const PINCH_ON = 0.45;
const PINCH_OFF = 0.75;
// Curl: fingertip ↔ palm centre. A folded finger tucks its tip into the
// palm (~0.35–0.5); a pinching index sits out in front (~0.7+).
const CURLED_BELOW = 0.55;
const INDEX_OUT_ABOVE = 0.62;

// Timings in ms (frame counts would stretch when many hands lower the FPS).
const PINCH_START_MS = 60; // pinch must hold this long to start a stroke
const RELEASE_GRACE_MS = 220; // stroke survives a brief release / flicker
const MISSING_GRACE_MS = 300; // stroke survives the hand vanishing briefly
const FIST_ON_MS = 130; // fist must hold this long to start erasing
const FIST_OFF_MS = 150; // fist must open this long to stop erasing
const ERASE_COOLDOWN_MS = 350; // no drawing right after erasing
const DWELL_PICK_MS = 800; // point still at a circle this long to pick it
const DWELL_STILL_PX = 25; // …without the fingertip drifting further than this
const PINCH_PICK_MS = 300; // or pinch on the same circle this long
const REBIND_MS = 3000; // a lost hand's colour can be reclaimed this long
const REBIND_DIST = 0.3; // …by a new hand appearing this close (normalised)
// Stroke points are committed a few frames late, so when a pinch turns
// into a fist the "closing" motion can be thrown away instead of drawn.
const STROKE_DELAY_FRAMES = 4;
// Never join a stroke across a jump bigger than this (px).
const MAX_JOIN_PX = 160;

// 1€ smoothing on landmarks (normalised units): steady when slow,
// responsive when moving fast.
const FILTER: OneEuroParams = { minCutoff: 1.4, beta: 6, dCutoff: 1 };
// World landmarks are in metres (smaller numbers), so a stronger beta.
const WORLD_FILTER: OneEuroParams = { minCutoff: 2, beta: 20, dCutoff: 1 };

const PALETTE_COLORS = [
  // "#FF6B6B",
  // "#FF9F43",
  // "#FFEAA7",
  // "#55EFC4",
  // "#00CEC9",
  // "#74B9FF",
  // "#A29BFE",
  // "#FD79A8",
  // "#FFFFFF",

  "#000000",
  "#FFFFFF",
  "#FF4D4D",
  "#FF9900",
  "#FFE600",
  "#4DFF91",
  "#4DC8FF",
  "#B44DFF",
  "#FF4DB8",
];
// ---------- palette: colour circles + pen circles, in the header row ----------

type PenType = "pen" | "neon" | "marker" | "rainbow";

const PENS: { pen: PenType; label: string }[] = [
  { pen: "pen", label: "ปากกา" },
  { pen: "neon", label: "เรืองแสง" },
  { pen: "marker", label: "ไฮไลต์" },
  { pen: "rainbow", label: "สายรุ้ง" },
];
const PEN_LABEL = Object.fromEntries(
  PENS.map((p) => [p.pen, p.label]),
) as Record<PenType, string>;

type PaletteItem =
  | { kind: "color"; color: string }
  | { kind: "pen"; pen: PenType; label: string };

const PALETTE_ITEMS: PaletteItem[] = [
  ...PALETTE_COLORS.map((color) => ({ kind: "color" as const, color })),
  ...PENS.map((p) => ({ kind: "pen" as const, ...p })),
];

const SWATCH_R = 19;
const ITEM_GAP = 12;
const GROUP_GAP = 30; // extra space between the colours and the pens
// Vertical centre of the circles: lines up with the header buttons.
const PALETTE_CY = 38;
const HIT_MARGIN = 8;

// Default colours handed to new hands so each player starts different.
const HAND_COLORS = [
  "#FF4D4D",
  "#4DC8FF",
  "#FFE600",
  "#4DFF91",
  "#B44DFF",
  "#FF9900",
];

type PaletteCircle = { cx: number; cy: number; r: number; item: PaletteItem };

function getPaletteCircles(canvasW: number): PaletteCircle[] {
  const d = SWATCH_R * 2;
  const n = PALETTE_ITEMS.length;
  const totalW = n * d + (n - 1) * ITEM_GAP + GROUP_GAP;
  let x = (canvasW - totalW) / 2 + SWATCH_R;
  return PALETTE_ITEMS.map((item, i) => {
    if (i > 0 && item.kind === "pen" && PALETTE_ITEMS[i - 1].kind === "color")
      x += GROUP_GAP;
    const c = { cx: x, cy: PALETTE_CY, r: SWATCH_R, item };
    x += d + ITEM_GAP;
    return c;
  });
}

/** Inside the palette row (with a margin), not just on a circle. */
function isOverPalette(px: number, py: number, canvasW: number) {
  const cs = getPaletteCircles(canvasW);
  const first = cs[0];
  const last = cs[cs.length - 1];
  return (
    px >= first.cx - first.r - 24 &&
    px <= last.cx + last.r + 24 &&
    py >= PALETTE_CY - SWATCH_R - 24 &&
    py <= PALETTE_CY + SWATCH_R + 30
  );
}

function getHoveredItem(px: number, py: number, canvasW: number): number {
  const cs = getPaletteCircles(canvasW);
  for (let i = 0; i < cs.length; i++) {
    if (Math.hypot(px - cs[i].cx, py - cs[i].cy) <= cs[i].r + HIT_MARGIN)
      return i;
  }
  return -1;
}

type PaletteHand = {
  color: string;
  pen: PenType;
  dwellIdx: number;
  progress: number;
};

function itemApplied(h: { color: string; pen: PenType }, item: PaletteItem) {
  return item.kind === "color" ? h.color === item.color : h.pen === item.pen;
}

/** Little sample stroke inside a pen circle. */
function drawPenGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pen: PenType,
) {
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 4);
    ctx.bezierCurveTo(cx - 4, cy - 10, cx + 2, cy + 10, cx + 10, cy - 4);
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pen === "pen") {
    path();
    ctx.strokeStyle = "#433d35";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if (pen === "neon") {
    path();
    ctx.shadowColor = "#3fd0ff";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#3fd0ff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
    path();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (pen === "marker") {
    path();
    ctx.strokeStyle = "rgba(255,200,0,0.6)";
    ctx.lineWidth = 9;
    ctx.stroke();
  } else {
    const g = ctx.createLinearGradient(cx - 10, cy, cx + 10, cy);
    ["#ff4d4d", "#ffb84d", "#ffe600", "#4dff91", "#4dc8ff", "#b44dff"].forEach(
      (c, i, a) => g.addColorStop(i / (a.length - 1), c),
    );
    path();
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPalette(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  hoveredIdx: number,
  hands: PaletteHand[],
) {
  const circles = getPaletteCircles(canvasW);

  circles.forEach(({ cx, cy, r: baseR, item }, i) => {
    const hovered = i === hoveredIdx;
    const users = hands.filter((h) => itemApplied(h, item)).length;
    const r = baseR + (hovered ? 3 : 0);

    // Body with a soft drop shadow (no strip behind the palette).
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle =
      item.kind === "color" ? item.color : "rgba(255,255,255,0.94)";
    ctx.fill();
    ctx.restore();

    // Rings: thin dark hairline (so white stays visible) + white ring.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + (users ? 3.5 : 1.5), 0, Math.PI * 2);
    ctx.strokeStyle = users || hovered ? "#ffffff" : "rgba(255,255,255,0.75)";
    ctx.lineWidth = users ? 3 : 1.5;
    ctx.stroke();

    if (item.kind === "pen") drawPenGlyph(ctx, cx, cy, item.pen);

    // One dot under the circle per hand using it.
    for (let k = 0; k < users; k++) {
      ctx.beginPath();
      ctx.arc(
        cx + (k - (users - 1) / 2) * 9,
        cy + baseR + 11,
        3,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    // Name under a hovered pen.
    if (hovered && item.kind === "pen") {
      ctx.save();
      ctx.font = "600 12px 'IBM Plex Sans Thai', sans-serif";
      const tw = ctx.measureText(item.label).width;
      const ly = cy + baseR + 26;
      ctx.fillStyle = "rgba(43,39,34,0.85)";
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2 - 10, ly - 11, tw + 20, 22, 11);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.label, cx, ly + 1);
      ctx.restore();
    }
  });

  // Dwell progress rings.
  for (const h of hands) {
    if (h.dwellIdx < 0 || h.progress <= 0) continue;
    const c = circles[h.dwellIdx];
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      c.cx,
      c.cy,
      c.r + 8,
      -Math.PI / 2,
      -Math.PI / 2 + h.progress * Math.PI * 2,
    );
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }
}

type P3 = { x: number; y: number; z: number };

function dist3(a: P3, b: P3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

type HandFeatures = {
  /** Thumb–index tip gap ÷ hand size. */
  pinch: number;
  /** Fingertip ↔ palm-centre ÷ hand size, for index, middle, ring, pinky. */
  curl: [number, number, number, number];
};

function handFeatures(wl: P3[]): HandFeatures {
  const size = dist3(wl[0], wl[9]) || 1e-6;
  const palm = { x: 0, y: 0, z: 0 };
  for (const i of [0, 5, 9, 13, 17]) {
    palm.x += wl[i].x / 5;
    palm.y += wl[i].y / 5;
    palm.z += wl[i].z / 5;
  }
  const c = (tip: number) => dist3(wl[tip], palm) / size;
  return {
    pinch: dist3(wl[4], wl[8]) / size,
    curl: [c(8), c(12), c(16), c(20)],
  };
}

type Pt = { x: number; y: number };

type HandMode = "idle" | "draw" | "pick" | "erase";

type HandDrawState = {
  mode: HandMode;
  color: string;
  filter: LandmarkFilter;
  worldFilter: LandmarkFilter;
  /** Last committed stroke point. */
  /** Points of the stroke being drawn (re-rendered as one smooth curve). */
  points: Pt[];
  /** Layer needs re-rendering from `points`. */
  dirty: boolean;
  /** Points waiting STROKE_DELAY_FRAMES before being drawn. */
  pending: Pt[];
  /** Timestamps (ms) when the current condition started, or null. */
  pinchSince: number | null;
  releaseSince: number | null;
  fistSince: number | null;
  openSince: number | null;
  cooldownUntil: number;
  seenAt: number;
  feat: HandFeatures | null;
  /** Last wrist position (normalised) and MediaPipe handedness label. */
  wrist: Pt;
  label: string;
  dwellIdx: number;
  dwellSince: number;
  dwellAnchor: Pt;
  /** Pinch-pick: circle being held and since when. */
  pickIdx: number;
  pickSince: number;
  /** After a pick, nothing more is picked until the hand leaves the palette. */
  needLeave: boolean;
  pen: PenType;
  /** Rainbow: distance already baked, so the hue continues smoothly. */
  hueOffset: number;
  /** The live stroke is rendered here as one path, then laid onto the
   *  drawing when it ends (marker at partial opacity). */
  layer: HTMLCanvasElement | null;
};

const MARKER_ALPHA = 0.4;
// Rainbow pen: how fast the hue turns along the line (degrees per px).
const RAINBOW_DEG_PER_PX = 0.5;
// Long strokes are "baked" onto the drawing in chunks so re-rendering the
// live stroke every frame stays cheap.
const BAKE_POINTS = 240;
// Ignore jitter: a new point must move at least this far (px).
const MIN_POINT_STEP = 2;

/** Opacity a hand's stroke layer is laid down with. */
function layerAlpha(st: { pen: PenType }) {
  return st.pen === "marker" ? MARKER_ALPHA : 1;
}

function ensureLayer(st: HandDrawState, w: number, h: number) {
  if (!st.layer) st.layer = document.createElement("canvas");
  if (st.layer.width !== w || st.layer.height !== h) {
    st.layer.width = w;
    st.layer.height = h;
    st.dirty = true;
  }
}

/** Smooth path through the points: quadratic curves via midpoints. */
function tracePath(c: CanvasRenderingContext2D, pts: Pt[]) {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    c.lineTo(pts[0].x + 0.01, pts[0].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last.x, last.y);
}

/** Redraw the whole live stroke onto the hand's layer as one path, so
 *  glow / translucency never double up where pieces meet. */
function renderLayer(st: HandDrawState) {
  const layer = st.layer;
  const lc = layer?.getContext("2d");
  if (!layer || !lc) return;
  lc.clearRect(0, 0, layer.width, layer.height);
  st.dirty = false;
  const pts = st.points;
  if (pts.length === 0) return;

  lc.save();
  lc.lineCap = "round";
  lc.lineJoin = "round";
  switch (st.pen) {
    case "pen":
      tracePath(lc, pts);
      lc.strokeStyle = st.color;
      lc.lineWidth = 4;
      lc.stroke();
      break;
    case "marker":
      tracePath(lc, pts);
      lc.strokeStyle = st.color;
      lc.lineWidth = 24;
      lc.stroke();
      break;
    case "neon":
      tracePath(lc, pts);
      lc.shadowColor = st.color;
      lc.shadowBlur = 18;
      lc.strokeStyle = st.color;
      lc.lineWidth = 7;
      lc.stroke();
      lc.shadowBlur = 0;
      tracePath(lc, pts);
      lc.strokeStyle = "#ffffff";
      lc.lineWidth = 2.5;
      lc.stroke();
      break;
    case "rainbow": {
      // One short curve piece per point. Each piece gets a gradient from
      // the hue at its start to the hue at its end (hue = distance
      // travelled), so the colour flows with no visible steps.
      lc.lineWidth = 7;
      const hueAt = (d: number) =>
        `hsl(${(d * RAINBOW_DEG_PER_PX) % 360} 95% 60%)`;
      let len = st.hueOffset;
      let from = pts[0];
      if (pts.length === 1) {
        tracePath(lc, pts);
        lc.strokeStyle = hueAt(len);
        lc.stroke();
      }
      for (let i = 1; i < pts.length; i++) {
        const isLast = i === pts.length - 1;
        const to = isLast
          ? pts[i]
          : {
              x: (pts[i].x + pts[i + 1].x) / 2,
              y: (pts[i].y + pts[i + 1].y) / 2,
            };
        const pieceLen = Math.hypot(to.x - from.x, to.y - from.y);
        const g = lc.createLinearGradient(from.x, from.y, to.x, to.y);
        g.addColorStop(0, hueAt(len));
        g.addColorStop(1, hueAt(len + pieceLen));
        len += pieceLen;
        lc.beginPath();
        lc.moveTo(from.x, from.y);
        if (isLast) lc.lineTo(to.x, to.y);
        else lc.quadraticCurveTo(pts[i].x, pts[i].y, to.x, to.y);
        lc.strokeStyle = g;
        lc.stroke();
        from = to;
      }
      break;
    }
  }
  lc.restore();
}

function strokeLength(pts: Pt[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Lay the live stroke onto the drawing and clear the layer. */
function flushLayer(dctx: CanvasRenderingContext2D, st: HandDrawState) {
  if (!st.layer || st.points.length === 0) return;
  if (st.dirty) renderLayer(st);
  dctx.save();
  dctx.globalCompositeOperation = "source-over";
  dctx.globalAlpha = layerAlpha(st);
  dctx.drawImage(st.layer, 0, 0);
  dctx.restore();
  st.layer.getContext("2d")?.clearRect(0, 0, st.layer.width, st.layer.height);
}

function commitPoint(dctx: CanvasRenderingContext2D, st: HandDrawState, p: Pt) {
  ensureLayer(st, dctx.canvas.width, dctx.canvas.height);
  const prev = st.points[st.points.length - 1];
  if (prev) {
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (d < MIN_POINT_STEP) return;
    if (d > MAX_JOIN_PX) {
      // Big jump (hand reappeared elsewhere): don't draw a line across.
      flushLayer(dctx, st);
      st.points = [];
      st.hueOffset = 0;
    }
  }
  st.points.push(p);
  st.dirty = true;
  if (st.points.length > BAKE_POINTS) {
    // Bake the older part; keep a short overlap so the curve continues.
    const keep = st.points.slice(-3);
    st.hueOffset += strokeLength(st.points.slice(0, -2));
    flushLayer(dctx, st);
    st.points = keep;
    st.dirty = true;
  }
}

/** End the stroke; `keepPending` draws the queued tail, otherwise drops it. */
function endStroke(
  dctx: CanvasRenderingContext2D,
  st: HandDrawState,
  keepPending: boolean,
) {
  if (keepPending) for (const p of st.pending) commitPoint(dctx, st, p);
  flushLayer(dctx, st);
  st.pending = [];
  st.points = [];
  st.hueOffset = 0;
}

function palmCenter(lm: Landmark[], w: number, h: number) {
  const idx = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of idx) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: (x / idx.length) * w, y: (y / idx.length) * h };
}

function eraserRadius(lm: Landmark[], w: number, h: number) {
  const span = Math.hypot((lm[5].x - lm[17].x) * w, (lm[5].y - lm[17].y) * h);
  return Math.min(90, Math.max(22, span * 0.9));
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
  color: string,
) {
  const x = (i: number) => lm[i].x * w;
  const y = (i: number) => lm[i].y * h;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(x(a), y(a));
    ctx.lineTo(x(b), y(b));
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    ctx.beginPath();
    ctx.arc(x(i), y(i), FINGERTIPS.includes(i) ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = i === 8 ? color : "#FFFFFF";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

/** `?debug` in the URL shows each hand's gesture numbers for tuning. */
function drawDebug(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  f: HandFeatures,
) {
  const lines = [
    `pinch ${f.pinch.toFixed(2)} (on<${PINCH_ON} off>${PINCH_OFF})`,
    `curl i${f.curl[0].toFixed(2)} m${f.curl[1].toFixed(2)} r${f.curl[2].toFixed(2)} p${f.curl[3].toFixed(2)}`,
  ];
  ctx.save();
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(x - 120, y + 44, 240, 36);
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, x - 114, y + 58 + i * 15));
  ctx.restore();
}

const MODE_LABEL: Record<HandMode, string> = {
  idle: "พร้อม",
  draw: "วาด",
  pick: "เลือกสี",
  erase: "ลบ",
};

function drawModeBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mode: HandMode,
  color: string,
  pen: PenType,
) {
  const label =
    mode === "erase"
      ? MODE_LABEL[mode]
      : `${MODE_LABEL[mode]} · ${PEN_LABEL[pen]}`;
  ctx.save();
  ctx.font = "600 13px 'IBM Plex Sans Thai', sans-serif";
  const tw = ctx.measureText(label).width;
  const bw = tw + 30;
  const bh = 24;
  const bx = x - bw / 2;
  const by = y + 14;
  ctx.fillStyle =
    mode === "erase"
      ? "rgba(220,70,70,0.9)"
      : mode === "draw"
        ? "rgba(193,95,60,0.92)"
        : "rgba(43,39,34,0.75)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx + 12, by + bh / 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, bx + 22, by + bh / 2 + 1);
  ctx.restore();
}

export function useDrawingHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [drawMode, setDrawMode] = useState<DrawMode>("idle");
  const [strokeColor, setStrokeColor] = useState("#000000");

  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeColorRef = useRef("#000000");

  useEffect(() => {
    strokeColorRef.current = strokeColor;
  }, [strokeColor]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    syncCanvasToDisplay(canvas);

    // Offscreen layer holding the strokes; composited every frame so the
    // hands and palette stay on top of the drawing.
    const drawingCanvas = document.createElement("canvas");
    drawingCanvas.width = canvas.width;
    drawingCanvas.height = canvas.height;
    drawingCanvasRef.current = drawingCanvas;
    const dctx = drawingCanvas.getContext("2d")!;

    const debug = new URLSearchParams(window.location.search).has("debug");
    const assignIds = createHandIdTracker(0.25, 10);
    const handStates = new Map<number, HandDrawState>();
    let lastCount = -1;
    let lastMode: DrawMode | null = null;

    let landmarker: HandLandmarker | null = null;
    let cancelled = false;
    let animId = 0;
    let activeStream: MediaStream | null = null;
    let lastVideoTime = -1;
    let lastTs = 0;

    const createLandmarker = async (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(await getSharedFileset(), {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "VIDEO",
        numHands: MAX_HANDS,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    const applyItem = (st: HandDrawState, item: PaletteItem) => {
      if (item.kind === "color") {
        st.color = item.color;
        strokeColorRef.current = item.color;
        setStrokeColor(item.color);
      } else {
        st.pen = item.pen;
      }
    };

    const processFrame = (
      rawHands: Landmark[][],
      worldHands: P3[][],
      labels: string[],
      dt: number,
      now: number,
    ) => {
      syncCanvasToDisplay(canvas);
      const w = canvas.width;
      const h = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      resizeKeepingContent(drawingCanvas, w, h);

      drawVideoCover(ctx, video, vw, vh, w, h);
      // Strokes go under the hands, cursors and palette.
      ctx.drawImage(drawingCanvas, 0, 0);
      // Live strokes still being drawn (one frame behind, under the hands).
      ctx.save();
      for (const st of handStates.values()) {
        if (!st.layer || st.points.length === 0) continue;
        if (st.dirty) renderLayer(st);
        ctx.globalAlpha = layerAlpha(st);
        ctx.drawImage(st.layer, 0, 0);
      }
      ctx.restore();

      const mapped = rawHands.map((lm) =>
        mapToStage(lm, vw, vh, w, h).map((p) => ({ ...p, x: 1 - p.x })),
      );
      const ids = assignIds(mapped);

      let anyDraw = false;
      let anyErase = false;
      let hoveredIdx = -1;
      const paletteHands: PaletteHand[] = [];

      for (let hi = 0; hi < mapped.length; hi++) {
        const id = ids[hi];
        const wristNow = { x: mapped[hi][0].x, y: mapped[hi][0].y };
        const label = labels[hi] ?? "";
        let st = handStates.get(id);
        if (!st) {
          // A "new" hand is often an old one whose ID slipped: reclaim the
          // nearest recently-lost hand (same side) so it keeps its colour
          // and, if quick enough, its stroke.
          let best: number | null = null;
          let bestD = REBIND_DIST;
          for (const [oid, os] of handStates) {
            if (os.seenAt === now || now - os.seenAt > REBIND_MS) continue;
            if (label && os.label && label !== os.label) continue;
            const d = Math.hypot(
              os.wrist.x - wristNow.x,
              os.wrist.y - wristNow.y,
            );
            if (d < bestD) {
              bestD = d;
              best = oid;
            }
          }
          if (best !== null) {
            st = handStates.get(best)!;
            handStates.delete(best);
            handStates.set(id, st);
          }
        }
        if (!st) {
          const inUse = new Set(
            [...handStates.values()]
              .filter((o) => now - o.seenAt < REBIND_MS)
              .map((o) => o.color),
          );
          const color =
            HAND_COLORS.find((c) => !inUse.has(c)) ??
            HAND_COLORS[handStates.size % HAND_COLORS.length];
          st = {
            mode: "idle",
            color,
            filter: createLandmarkFilter(),
            worldFilter: createLandmarkFilter(),
            points: [],
            dirty: false,
            pending: [],
            pinchSince: null,
            releaseSince: null,
            fistSince: null,
            openSince: null,
            cooldownUntil: 0,
            seenAt: now,
            feat: null,
            wrist: wristNow,
            label,
            dwellIdx: -1,
            dwellSince: 0,
            dwellAnchor: { x: 0, y: 0 },
            pickIdx: -1,
            pickSince: 0,
            needLeave: false,
            pen: "pen",
            hueOffset: 0,
            layer: null,
          };
          handStates.set(id, st);
        }
        st.wrist = wristNow;
        if (label) st.label = label;
        st.seenAt = now;

        const m = filterLandmarks(st.filter, mapped[hi], dt, FILTER);
        drawHand(ctx, m, w, h, st.color);

        const wl = worldHands[hi]
          ? filterLandmarks(st.worldFilter, worldHands[hi], dt, WORLD_FILTER)
          : null;
        if (!wl) continue;

        const f = handFeatures(wl);
        // 2D pinch (what the player sees) as a second opinion: the 3D
        // fingertip estimate is often a little off, so take the smaller.
        const size2d =
          Math.hypot((m[0].x - m[9].x) * w, (m[0].y - m[9].y) * h) || 1e-6;
        const pinch2d =
          Math.hypot((m[4].x - m[8].x) * w, (m[4].y - m[8].y) * h) / size2d;
        f.pinch = Math.min(f.pinch, pinch2d);
        st.feat = f;
        const [iCurl, mCurl, rCurl, pCurl] = f.curl;
        const othersCurled =
          (mCurl < CURLED_BELOW ? 1 : 0) +
          (rCurl < CURLED_BELOW ? 1 : 0) +
          (pCurl < CURLED_BELOW ? 1 : 0);
        // Fist: index tucked into the palm plus two more fingers.
        const fistRaw = iCurl < CURLED_BELOW && othersCurled >= 2;
        // Pinch: thumb touching an index finger that isn't tucked away.
        const indexOut = iCurl > INDEX_OUT_ABOVE;
        const pinchRaw = !fistRaw && indexOut && f.pinch < PINCH_ON;
        const pinchHeld = !fistRaw && f.pinch < PINCH_OFF;

        const midX = ((m[4].x + m[8].x) / 2) * w;
        const midY = ((m[4].y + m[8].y) / 2) * h;
        const swatchIdx = getHoveredItem(midX, midY, w);
        const tipSwatch = getHoveredItem(m[8].x * w, m[8].y * h, w);
        if (swatchIdx !== -1) hoveredIdx = swatchIdx;
        if (tipSwatch !== -1) hoveredIdx = tipSwatch;

        const tipX = m[8].x * w;
        const tipY = m[8].y * h;
        if (
          st.needLeave &&
          !isOverPalette(tipX, tipY, w) &&
          !isOverPalette(midX, midY, w)
        )
          st.needLeave = false;

        // Point (index out, not pinching) and hold still on a circle to pick
        // it for THIS hand. Passing hands don't trigger it.
        const pointing = indexOut && !pinchHeld && !fistRaw;
        if (
          (st.mode === "idle" || st.mode === "pick") &&
          pointing &&
          !st.needLeave
        ) {
          const drifted =
            Math.hypot(tipX - st.dwellAnchor.x, tipY - st.dwellAnchor.y) >
            DWELL_STILL_PX;
          if (tipSwatch !== st.dwellIdx || drifted) {
            st.dwellIdx = tipSwatch;
            st.dwellSince = now;
            st.dwellAnchor = { x: tipX, y: tipY };
          } else if (
            tipSwatch !== -1 &&
            !itemApplied(st, PALETTE_ITEMS[tipSwatch]) &&
            now - st.dwellSince >= DWELL_PICK_MS
          ) {
            applyItem(st, PALETTE_ITEMS[tipSwatch]);
            st.needLeave = true;
            st.dwellIdx = -1;
          }
        } else {
          st.dwellIdx = -1;
        }
        paletteHands.push({
          color: st.color,
          pen: st.pen,
          dwellIdx:
            st.mode === "pick" && st.pickIdx !== -1
              ? st.pickIdx
              : st.dwellIdx !== -1 &&
                  !itemApplied(st, PALETTE_ITEMS[st.dwellIdx])
                ? st.dwellIdx
                : -1,
          progress:
            st.mode === "pick" && st.pickIdx !== -1
              ? Math.min(1, (now - st.pickSince) / PINCH_PICK_MS)
              : Math.min(1, (now - st.dwellSince) / DWELL_PICK_MS),
        });

        st.fistSince = fistRaw ? (st.fistSince ?? now) : null;
        const fistHeld =
          st.fistSince !== null && now - st.fistSince >= FIST_ON_MS;

        // --- state machine: idle <-> draw / pick, idle <-> erase ---
        if (st.mode === "erase") {
          st.openSince = fistRaw ? null : (st.openSince ?? now);
          if (st.openSince !== null && now - st.openSince >= FIST_OFF_MS) {
            st.mode = "idle";
            st.cooldownUntil = now + ERASE_COOLDOWN_MS;
            st.pinchSince = null;
          }
        } else if (fistHeld) {
          // A held fist always wins: drop the stroke tail (the hand
          // closing) and switch to the eraser.
          endStroke(dctx, st, false);
          st.mode = "erase";
          st.openSince = null;
        } else if (st.mode === "draw" || st.mode === "pick") {
          st.releaseSince = pinchHeld ? null : (st.releaseSince ?? now);
          if (st.mode === "pick" && pinchHeld) {
            if (swatchIdx !== st.pickIdx) {
              // Moved to another circle: start its hold timer again.
              st.pickIdx = swatchIdx;
              st.pickSince = now;
            } else if (
              st.pickIdx !== -1 &&
              !st.needLeave &&
              !itemApplied(st, PALETTE_ITEMS[st.pickIdx]) &&
              now - st.pickSince >= PINCH_PICK_MS
            ) {
              applyItem(st, PALETTE_ITEMS[st.pickIdx]);
              st.needLeave = true;
            }
            if (!isOverPalette(midX, midY, w)) {
              // Picked a colour and dragged out of the palette: draw.
              st.mode = "draw";
              st.points = [];
              st.pending = [];
            }
          }
          if (
            st.releaseSince !== null &&
            now - st.releaseSince > RELEASE_GRACE_MS
          ) {
            endStroke(dctx, st, !fistRaw);
            st.mode = "idle";
            st.pinchSince = null;
            st.releaseSince = null;
          }
        } else {
          // idle
          st.pinchSince =
            pinchRaw && now >= st.cooldownUntil ? (st.pinchSince ?? now) : null;
          if (st.pinchSince !== null && now - st.pinchSince >= PINCH_START_MS) {
            st.releaseSince = null;
            if (isOverPalette(midX, midY, w)) {
              // Pinch inside the palette: pick only after holding on one
              // circle (see the "pick" branch), never instantly.
              st.mode = "pick";
              st.pickIdx = swatchIdx;
              st.pickSince = now;
            } else {
              st.mode = "draw";
              st.points = [];
              st.pending = [];
            }
          }
        }

        if (debug) drawDebug(ctx, m[0].x * w, m[0].y * h, f);

        // Small badge by the wrist showing what this hand is doing.
        drawModeBadge(ctx, m[0].x * w, m[0].y * h, st.mode, st.color, st.pen);

        // --- act on the mode ---
        if (st.mode === "erase") {
          anyErase = true;
          const c = palmCenter(m, w, h);
          const r = eraserRadius(m, w, h);
          dctx.save();
          dctx.globalCompositeOperation = "destination-out";
          dctx.beginPath();
          dctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          dctx.fillStyle = "rgba(0,0,0,1)";
          dctx.fill();
          dctx.restore();
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,100,100,0.85)";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (st.mode === "draw" && st.releaseSince === null) {
          anyDraw = true;
          st.pending.push({ x: midX, y: midY });
          while (st.pending.length > STROKE_DELAY_FRAMES) {
            commitPoint(dctx, st, st.pending.shift()!);
          }
          ctx.beginPath();
          ctx.arc(midX, midY, 8, 0, Math.PI * 2);
          ctx.fillStyle = st.color;
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Hands MediaPipe missed this frame keep their stroke for a few
      // frames; after that the stroke ends.
      for (const [id, st] of handStates) {
        if (st.seenAt === now) continue;
        const missed = now - st.seenAt;
        if (missed > 2000) {
          handStates.delete(id);
        } else if (missed > MISSING_GRACE_MS && st.mode !== "idle") {
          endStroke(dctx, st, st.mode === "draw");
          st.mode = "idle";
          st.pinchSince = null;
          st.fistSince = null;
          st.releaseSince = null;
          resetLandmarkFilter(st.filter);
          resetLandmarkFilter(st.worldFilter);
        }
      }

      drawPalette(ctx, w, hoveredIdx, paletteHands);

      if (mapped.length !== lastCount) {
        lastCount = mapped.length;
        setHandCount(mapped.length);
      }
      const mode: DrawMode = anyDraw ? "draw" : anyErase ? "erase" : "idle";
      if (mode !== lastMode) {
        lastMode = mode;
        setDrawMode(mode);
      }
    };

    const loop = () => {
      if (cancelled) return;
      if (
        landmarker &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        const ts = Math.max(lastTs + 1, Math.round(performance.now()));
        const dt = Math.min(Math.max((ts - lastTs) / 1000, 1 / 240), 1 / 5);
        lastTs = ts;
        try {
          const result = landmarker.detectForVideo(video, ts);
          processFrame(
            result.landmarks as Landmark[][],
            result.worldLandmarks as P3[][],
            (result.handedness ?? []).map((c) => c[0]?.categoryName ?? ""),
            dt,
            ts,
          );
        } catch (err) {
          console.error("hand detect ล้มเหลว:", err);
        }
      }
      animId = requestAnimationFrame(loop);
    };

    const start = async () => {
      try {
        landmarker = await createLandmarker("GPU");
      } catch (err) {
        console.warn("GPU delegate ใช้ไม่ได้ ใช้ CPU แทน:", err);
        landmarker = await createLandmarker("CPU");
      }
      if (cancelled) {
        landmarker.close();
        landmarker = null;
        return;
      }
      const stream =
        await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      activeStream = stream;
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = () => resolve();
      });
      await video.play();
      if (cancelled) return;
      setStatus("tracking...");
      animId = requestAnimationFrame(loop);
    };

    start().catch((err: Error) => {
      if (!cancelled) setStatus(`❌ Error: ${err.message}`);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      landmarker?.close();
      landmarker = null;
      drawingCanvasRef.current = null;
    };
  }, [videoRef, canvasRef]);

  const clearDrawing = () => {
    const dc = drawingCanvasRef.current;
    if (dc) dc.getContext("2d")?.clearRect(0, 0, dc.width, dc.height);
  };

  return {
    status,
    handCount,
    drawMode,
    clearDrawing,
    strokeColor,
    setStrokeColor,
  };
}
