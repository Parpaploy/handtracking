import { useEffect, useRef, useState, useCallback } from "react";
import type {
  DragState,
  HandResult,
  HandResults,
  newHandsInstance,
} from "../interfaces/hand-tracking.interface";
import type { Landmark } from "@mediapipe/hands";

declare const Hands: new (opts: {
  locateFile: (f: string) => string;
}) => newHandsInstance;

const FINGERTIP_IDX = [4, 8, 12, 16, 20];
const HAND_CONNECTIONS: [number, number][] = [
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

const GRID = 3;
const SLIDE_COOLDOWN_MS = 300;
const HOLD_TO_CONFIRM_MS = 3000;
const PINCH_THRESHOLD = 0.07;

const DRAG_COMMIT_PX = 28;

export type Phase = "resize" | "puzzle";

export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UsePuzzleHandTrackingReturn {
  phase: Phase;
  status: string;
  handCount: number;
  moveCount: number;
  solved: boolean;
  holdProgress: number;
  frameBox: FrameBox;
  resetPuzzle: () => void;
}

function mirrorLandmarks(lm: Landmark[]): Landmark[] {
  return lm.map((p) => ({ ...p, x: 1 - p.x }));
}

function dist2(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pinchMidpoint(
  lm: Landmark[],
  W: number,
  H: number,
): { x: number; y: number } {
  return {
    x: ((lm[4].x + lm[8].x) / 2) * W,
    y: ((lm[4].y + lm[8].y) / 2) * H,
  };
}

function isPinching(lm: Landmark[]): boolean {
  return dist2(lm[4], lm[8]) < PINCH_THRESHOLD;
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    ctx.beginPath();
    ctx.arc(
      lm[i].x * w,
      lm[i].y * h,
      FINGERTIP_IDX.includes(i) ? 4 : 2.5,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawPinchDot(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  pinching: boolean,
  color: string,
  progress: number,
) {
  const r = pinching ? 10 : 6;
  ctx.beginPath();
  ctx.arc(mx, my, r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = color.replace("0.9", "0.3");
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fillStyle = pinching ? color : color.replace("0.9", "0.4");
  ctx.fill();

  if (pinching && progress > 0) {
    ctx.beginPath();
    ctx.arc(mx, my, r + 8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

function buildShuffledTiles(): number[] {
  const n = GRID * GRID;
  let arr: number[];
  do {
    arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  } while (!isSolvable(arr));
  return arr;
}

function isSolvable(arr: number[]): boolean {
  const empty = GRID * GRID - 1;
  let inv = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] !== empty && arr[j] !== empty && arr[i] > arr[j]) inv++;
    }
  }
  return inv % 2 === 0;
}

function captureFrame(
  vid: HTMLVideoElement,
  box: FrameBox,
  canvasW: number,
  canvasH: number,
): HTMLCanvasElement {
  const fc = document.createElement("canvas");
  fc.width = Math.round(box.w);
  fc.height = Math.round(box.h);
  const fctx = fc.getContext("2d")!;
  fctx.save();
  fctx.scale(-1, 1);
  fctx.drawImage(
    vid,
    ((canvasW - box.x - box.w) / canvasW) * vid.videoWidth,
    (box.y / canvasH) * vid.videoHeight,
    (box.w / canvasW) * vid.videoWidth,
    (box.h / canvasH) * vid.videoHeight,
    -fc.width,
    0,
    fc.width,
    fc.height,
  );
  fctx.restore();
  return fc;
}

function getTileAt(px: number, py: number, box: FrameBox): number {
  const tw = box.w / GRID;
  const th = box.h / GRID;
  const col = Math.floor((px - box.x) / tw);
  const row = Math.floor((py - box.y) / th);
  if (col < 0 || col >= GRID || row < 0 || row >= GRID) return -1;
  return row * GRID + col;
}

export function usePuzzleHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  camCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>,
): UsePuzzleHandTrackingReturn {
  const [phase, setPhase] = useState<Phase>("resize");
  const [status, setStatus] = useState("กำลังโหลด mediapipe...");
  const [handCount, setHandCount] = useState(0);
  const [moveCount, setMoveCount] = useState(0);
  const [solved, setSolved] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [frameBox, setFrameBox] = useState<FrameBox>({
    x: 160,
    y: 100,
    w: 320,
    h: 280,
  });

  const phaseRef = useRef<Phase>("resize");
  const frameBoxRef = useRef<FrameBox>({ x: 160, y: 100, w: 320, h: 280 });
  const tilesRef = useRef<number[]>([]);
  const emptyIdxRef = useRef(GRID * GRID - 1);
  const puzzleImgRef = useRef<HTMLCanvasElement | null>(null);
  const moveCountRef = useRef(0);
  const solvedRef = useRef(false);
  const holdStartRef = useRef<number | null>(null);
  const lastSlideRef = useRef(0);

  const dragRef = useRef<Map<string, DragState>>(new Map());

  const updateFrameBox = useCallback((box: FrameBox) => {
    const prev = frameBoxRef.current;
    frameBoxRef.current = box;
    if (
      box.x !== prev.x ||
      box.y !== prev.y ||
      box.w !== prev.w ||
      box.h !== prev.h
    ) {
      setFrameBox(box);
    }
  }, []);

  const enterPuzzle = useCallback(() => {
    const vid = videoRef.current;
    const camCanvas = camCanvasRef.current;
    if (!vid || !camCanvas) return;
    puzzleImgRef.current = captureFrame(
      vid,
      frameBoxRef.current,
      camCanvas.width,
      camCanvas.height,
    );
    tilesRef.current = buildShuffledTiles();
    emptyIdxRef.current = tilesRef.current.indexOf(GRID * GRID - 1);
    moveCountRef.current = 0;
    solvedRef.current = false;
    dragRef.current.clear();
    phaseRef.current = "puzzle";
    setPhase("puzzle");
    setMoveCount(0);
    setSolved(false);
    setHoldProgress(0);
  }, [videoRef, camCanvasRef]);

  const resetPuzzle = useCallback(() => {
    phaseRef.current = "resize";
    puzzleImgRef.current = null;
    holdStartRef.current = null;
    dragRef.current.clear();
    setPhase("resize");
    setMoveCount(0);
    setSolved(false);
    setHoldProgress(0);
  }, []);

  const commitSlide = useCallback((tileIdx: number) => {
    if (solvedRef.current) return false;
    const now = Date.now();
    if (now - lastSlideRef.current < SLIDE_COOLDOWN_MS) return false;
    const ec = emptyIdxRef.current % GRID;
    const er = Math.floor(emptyIdxRef.current / GRID);
    const tc = tileIdx % GRID;
    const tr = Math.floor(tileIdx / GRID);
    const adj =
      (Math.abs(ec - tc) === 1 && er === tr) ||
      (Math.abs(er - tr) === 1 && ec === tc);
    if (!adj) return false;

    [tilesRef.current[tileIdx], tilesRef.current[emptyIdxRef.current]] = [
      tilesRef.current[emptyIdxRef.current],
      tilesRef.current[tileIdx],
    ];
    emptyIdxRef.current = tileIdx;
    moveCountRef.current++;
    lastSlideRef.current = now;
    setMoveCount(moveCountRef.current);
    if (tilesRef.current.every((v, i) => v === i)) {
      solvedRef.current = true;
      setSolved(true);
    }
    return true;
  }, []);

  const drawResize = useCallback(
    (
      ovCtx: CanvasRenderingContext2D,
      landmarks: Landmark[][],
      handedness: HandResult[],
      W: number,
      H: number,
    ) => {
      ovCtx.clearRect(0, 0, W, H);

      let leftLm: Landmark[] | null = null;
      let rightLm: Landmark[] | null = null;
      for (let hi = 0; hi < landmarks.length; hi++) {
        const m = mirrorLandmarks(landmarks[hi]);
        if (handedness[hi]?.label === "Left") leftLm = m;
        else rightLm = m;
      }

      const leftPinching = leftLm ? isPinching(leftLm) : false;
      const rightPinching = rightLm ? isPinching(rightLm) : false;
      const bothPinching = leftPinching && rightPinching;

      for (let hi = 0; hi < landmarks.length; hi++) {
        const m = mirrorLandmarks(landmarks[hi]);
        const isLeft = handedness[hi]?.label === "Left";
        drawSkeleton(
          ovCtx,
          m,
          W,
          H,
          isLeft ? "rgba(255,140,0,0.7)" : "rgba(0,200,255,0.7)",
        );
      }

      if (leftLm && rightLm) {
        const lMid = pinchMidpoint(leftLm, W, H);
        const rMid = pinchMidpoint(rightLm, W, H);
        const fx = Math.min(lMid.x, rMid.x);
        const fy = Math.min(lMid.y, rMid.y);
        const fw = Math.max(80, Math.abs(rMid.x - lMid.x));
        const fh = Math.max(60, Math.abs(rMid.y - lMid.y));
        const newBox: FrameBox = { x: fx, y: fy, w: fw, h: fh };
        updateFrameBox(newBox);

        ovCtx.strokeStyle = "rgba(93,202,165,0.4)";
        ovCtx.lineWidth = 1;
        ovCtx.setLineDash([4, 4]);
        ovCtx.beginPath();
        ovCtx.moveTo(lMid.x, lMid.y);
        ovCtx.lineTo(rMid.x, rMid.y);
        ovCtx.stroke();
        ovCtx.setLineDash([]);

        if (bothPinching) {
          if (holdStartRef.current === null) holdStartRef.current = Date.now();
          const elapsed = (Date.now() - holdStartRef.current) / 1000;
          const progress = Math.min(1, elapsed / (HOLD_TO_CONFIRM_MS / 1000));
          setHoldProgress(progress);

          ovCtx.fillStyle = `rgba(93,202,165,${0.05 + progress * 0.2})`;
          ovCtx.fillRect(newBox.x, newBox.y, newBox.w, newBox.h);

          ovCtx.strokeStyle = `rgba(93,202,165,${0.4 + progress * 0.6})`;
          ovCtx.lineWidth = 2;
          ovCtx.setLineDash([6, 4]);
          ovCtx.strokeRect(newBox.x, newBox.y, newBox.w, newBox.h);
          ovCtx.setLineDash([]);

          const remain = Math.max(0, HOLD_TO_CONFIRM_MS / 1000 - elapsed);
          ovCtx.fillStyle = "#5DCAA5";
          ovCtx.font = `bold ${Math.round(20 + progress * 12)}px sans-serif`;
          ovCtx.textAlign = "center";
          ovCtx.textBaseline = "middle";
          ovCtx.fillText(
            remain > 0 ? String(Math.ceil(remain)) : "✓",
            newBox.x + newBox.w / 2,
            newBox.y + newBox.h / 2,
          );

          drawPinchDot(
            ovCtx,
            lMid.x,
            lMid.y,
            true,
            "rgba(255,140,0,0.9)",
            progress,
          );
          drawPinchDot(
            ovCtx,
            rMid.x,
            rMid.y,
            true,
            "rgba(0,200,255,0.9)",
            progress,
          );

          if (progress >= 1) {
            holdStartRef.current = null;
            enterPuzzle();
          }
        } else {
          holdStartRef.current = null;
          setHoldProgress(0);
          ovCtx.strokeStyle = "#5DCAA5";
          ovCtx.lineWidth = 2;
          ovCtx.setLineDash([6, 4]);
          ovCtx.strokeRect(newBox.x, newBox.y, newBox.w, newBox.h);
          ovCtx.setLineDash([]);
          drawPinchDot(
            ovCtx,
            lMid.x,
            lMid.y,
            leftPinching,
            "rgba(255,140,0,0.9)",
            0,
          );
          drawPinchDot(
            ovCtx,
            rMid.x,
            rMid.y,
            rightPinching,
            "rgba(0,200,255,0.9)",
            0,
          );
        }
      } else {
        holdStartRef.current = null;
        setHoldProgress(0);
        const box = frameBoxRef.current;
        ovCtx.strokeStyle = "rgba(93,202,165,0.3)";
        ovCtx.lineWidth = 1.5;
        ovCtx.setLineDash([6, 4]);
        ovCtx.strokeRect(box.x, box.y, box.w, box.h);
        ovCtx.setLineDash([]);
        for (let hi = 0; hi < landmarks.length; hi++) {
          const m = mirrorLandmarks(landmarks[hi]);
          const isLeft = handedness[hi]?.label === "Left";
          const mid = pinchMidpoint(m, W, H);
          drawPinchDot(
            ovCtx,
            mid.x,
            mid.y,
            isPinching(m),
            isLeft ? "rgba(255,140,0,0.9)" : "rgba(0,200,255,0.9)",
            0,
          );
        }
      }
    },
    [updateFrameBox, enterPuzzle],
  );

  const drawPuzzle = useCallback(
    (
      ovCtx: CanvasRenderingContext2D,
      landmarks: Landmark[][],
      handedness: HandResult[],
      W: number,
      H: number,
    ) => {
      ovCtx.clearRect(0, 0, W, H);

      const box = frameBoxRef.current;
      const img = puzzleImgRef.current;
      const tw = box.w / GRID;
      const th = box.h / GRID;
      const drag = dragRef.current;

      const handsThisFrame = new Map<
        string,
        { lm: Landmark[]; pinching: boolean; mid: { x: number; y: number } }
      >();
      for (let hi = 0; hi < landmarks.length; hi++) {
        const m = mirrorLandmarks(landmarks[hi]);
        const key = handedness[hi]?.label ?? "Right";
        handsThisFrame.set(key, {
          lm: m,
          pinching: isPinching(m),
          mid: pinchMidpoint(m, W, H),
        });
      }

      for (const key of drag.keys()) {
        const hand = handsThisFrame.get(key);
        if (!hand || !hand.pinching) drag.delete(key);
      }

      for (const [key, hand] of handsThisFrame) {
        if (!hand.pinching) continue;
        const { mid } = hand;

        if (!drag.has(key)) {
          const tileIdx = getTileAt(mid.x, mid.y, box);
          if (tileIdx !== -1 && tileIdx !== emptyIdxRef.current) {
            const ec = emptyIdxRef.current % GRID;
            const er = Math.floor(emptyIdxRef.current / GRID);
            const tc = tileIdx % GRID;
            const tr = Math.floor(tileIdx / GRID);
            let axis: "h" | "v" | null = null;
            if (Math.abs(ec - tc) === 1 && er === tr) axis = "h";
            else if (Math.abs(er - tr) === 1 && ec === tc) axis = "v";

            if (axis !== null) {
              drag.set(key, {
                tileIdx,
                startX: mid.x,
                startY: mid.y,
                axis,
                committed: false,
              });
            }
          }
        } else {
          const state = drag.get(key)!;
          if (state.committed) continue;

          const dx = mid.x - state.startX;
          const dy = mid.y - state.startY;

          const ec = emptyIdxRef.current % GRID;
          const er = Math.floor(emptyIdxRef.current / GRID);
          const tc = state.tileIdx % GRID;
          const tr = Math.floor(state.tileIdx / GRID);

          const expectedDx = (ec - tc) * tw;
          const expectedDy = (er - tr) * th;

          const dotProduct =
            dx * Math.sign(expectedDx) + dy * Math.sign(expectedDy);

          if (dotProduct >= DRAG_COMMIT_PX) {
            const slid = commitSlide(state.tileIdx);
            if (slid) {
              state.committed = true;
            }
          }
        }
      }

      const dragOffsets = new Map<number, { ox: number; oy: number }>();
      for (const [key, state] of drag) {
        if (state.committed) continue;
        const hand = handsThisFrame.get(key);
        if (!hand) continue;
        const { mid } = hand;
        const dx = mid.x - state.startX;
        const dy = mid.y - state.startY;
        const ec = emptyIdxRef.current % GRID;
        const er = Math.floor(emptyIdxRef.current / GRID);
        const tc = state.tileIdx % GRID;
        const tr = Math.floor(state.tileIdx / GRID);

        let ox = 0,
          oy = 0;
        if (state.axis === "h") {
          const dir = Math.sign(ec - tc);
          ox = Math.max(0, Math.min(tw, dx * dir)) * dir;
        } else {
          const dir = Math.sign(er - tr);
          oy = Math.max(0, Math.min(th, dy * dir)) * dir;
        }
        dragOffsets.set(state.tileIdx, { ox, oy });
      }

      const draggedTileIdxs = new Set(dragOffsets.keys());

      for (let i = 0; i < GRID * GRID; i++) {
        const val = tilesRef.current[i];
        if (val === GRID * GRID - 1) continue;
        if (draggedTileIdxs.has(i)) continue;

        const col = i % GRID;
        const row = Math.floor(i / GRID);
        const dx = box.x + col * tw;
        const dy = box.y + row * th;

        if (img) {
          const srcCol = val % GRID;
          const srcRow = Math.floor(val / GRID);
          ovCtx.drawImage(
            img,
            srcCol * (img.width / GRID),
            srcRow * (img.height / GRID),
            img.width / GRID,
            img.height / GRID,
            dx,
            dy,
            tw,
            th,
          );
        }
        ovCtx.strokeStyle = "rgba(255,255,255,0.25)";
        ovCtx.lineWidth = 1;
        ovCtx.strokeRect(dx + 0.5, dy + 0.5, tw - 1, th - 1);
      }

      const ec = emptyIdxRef.current % GRID;
      const er =
        emptyIdxRef.current > 0 ? Math.floor(emptyIdxRef.current / GRID) : 0;
      ovCtx.fillStyle = "rgba(0,0,0,0.6)";
      ovCtx.fillRect(box.x + ec * tw, box.y + er * th, tw, th);

      for (const [tileIdx, { ox, oy }] of dragOffsets) {
        const val = tilesRef.current[tileIdx];
        if (val === GRID * GRID - 1) continue;
        const col = tileIdx % GRID;
        const row = Math.floor(tileIdx / GRID);
        const dx = box.x + col * tw + ox;
        const dy = box.y + row * th + oy;

        if (img) {
          const srcCol = val % GRID;
          const srcRow = Math.floor(val / GRID);

          ovCtx.save();
          ovCtx.globalAlpha = 0.95;
          ovCtx.drawImage(
            img,
            srcCol * (img.width / GRID),
            srcRow * (img.height / GRID),
            img.width / GRID,
            img.height / GRID,
            dx - 2,
            dy - 2,
            tw + 4,
            th + 4,
          );
          ovCtx.restore();
        }
        ovCtx.strokeStyle = "rgba(255,255,255,0.7)";
        ovCtx.lineWidth = 2;
        ovCtx.strokeRect(dx - 2 + 0.5, dy - 2 + 0.5, tw + 3, th + 3);
      }

      ovCtx.strokeStyle = solvedRef.current ? "#FFD700" : "#5DCAA5";
      ovCtx.lineWidth = 2;
      ovCtx.strokeRect(box.x, box.y, box.w, box.h);

      for (const [key, hand] of handsThisFrame) {
        const { lm, pinching, mid } = hand;
        const isLeft = key === "Left";
        const color = isLeft ? "rgba(255,140,0,0.7)" : "rgba(0,200,255,0.7)";
        const accent = isLeft ? "rgba(255,140,0,0.9)" : "rgba(0,200,255,0.9)";
        drawSkeleton(ovCtx, lm, W, H, color);

        const state = drag.get(key);
        if (pinching && state && !state.committed) {
          const tc = state.tileIdx % GRID;
          const tr = Math.floor(state.tileIdx / GRID);
          const emptyC = emptyIdxRef.current % GRID;
          const emptyR = Math.floor(emptyIdxRef.current / GRID);
          const arrowX =
            box.x + (tc + 0.5) * tw + Math.sign(emptyC - tc) * tw * 0.35;
          const arrowY =
            box.y + (tr + 0.5) * th + Math.sign(emptyR - tr) * th * 0.35;

          ovCtx.save();
          ovCtx.strokeStyle = accent;
          ovCtx.lineWidth = 1.5;
          ovCtx.setLineDash([4, 3]);
          ovCtx.beginPath();
          ovCtx.moveTo(box.x + (tc + 0.5) * tw, box.y + (tr + 0.5) * th);
          ovCtx.lineTo(arrowX, arrowY);
          ovCtx.stroke();
          ovCtx.setLineDash([]);
          ovCtx.restore();
        }

        drawPinchDot(ovCtx, mid.x, mid.y, pinching, accent, 0);
      }
    },
    [commitSlide],
  );

  useEffect(() => {
    const video = videoRef.current;
    const camCanvas = camCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video || !camCanvas || !overlay) return;

    const camCtx = camCanvas.getContext("2d");
    const ovCtx = overlay.getContext("2d");
    if (!camCtx || !ovCtx) return;

    camCanvas.width = overlay.width = 720;
    camCanvas.height = overlay.height = 560;

    const hands = new Hands({
      locateFile: (f) => `/mediapipe/hands/${f}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results: HandResults) => {
      const W = camCanvas.width;
      const H = camCanvas.height;
      camCtx.save();
      camCtx.scale(-1, 1);
      camCtx.drawImage(results.image, -W, 0, W, H);
      camCtx.restore();

      const lms = results.multiHandLandmarks ?? [];
      const hds = results.multiHandedness ?? [];
      setHandCount(lms.length);
      setStatus(lms.length > 0 ? `${lms.length} มือ` : "ไม่พบมือ");

      if (phaseRef.current === "resize") drawResize(ovCtx, lms, hds, W, H);
      else drawPuzzle(ovCtx, lms, hds, W, H);
    });

    let animId: number;
    let cancelled = false;
    let activeStream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 720, height: 560 } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play().then(() => {
            if (cancelled) return;
            setStatus("ไม่พบมือ");
            const loop = async () => {
              if (cancelled) return;
              if (video.readyState === 4) await hands.send({ image: video });
              if (cancelled) return;
              animId = requestAnimationFrame(loop);
            };
            loop().catch(console.error);
          });
        };
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus(`❌ ${err.message}`);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      hands.close().catch(() => {});
    };
  }, [videoRef, camCanvasRef, overlayCanvasRef, drawResize, drawPuzzle]);

  return {
    phase,
    status,
    handCount,
    moveCount,
    solved,
    holdProgress,
    frameBox,
    resetPuzzle,
  };
}
