import { useEffect, useState } from "react";
import type {
  FaceMeshConstructorLocal,
  FaceResultsLocal,
  HandResults,
  HandsConstructor,
  Landmark,
  CocoSsdNamespace,
  CocoSsdModel,
  DetectedObject,
  TfNamespace,
  TrackedObject,
} from "../interfaces/hand-tracking.interface";

declare const Hands: HandsConstructor;
declare const FaceMesh: FaceMeshConstructorLocal;
declare const cocoSsd: CocoSsdNamespace;
declare const tf: TfNamespace;

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

const MESH_POINTS = [
  10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176,
  148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389, 251,
  284, 332, 297, 338,

  70, 63, 105, 66, 107, 336, 296, 334, 293, 300,

  33, 160, 159, 158, 133, 153, 144, 362, 385, 386, 387, 263, 373, 380,

  168, 6, 197, 195, 5, 4, 48, 64, 98, 278, 294, 327,

  61, 40, 37, 0, 267, 270, 291, 321, 405, 17, 181, 91,

  205, 425,
];

const MESH_EDGES: [number, number][] = [
  [10, 109],
  [109, 67],
  [67, 103],
  [103, 54],
  [54, 21],
  [21, 162],
  [162, 127],
  [127, 234],
  [234, 93],
  [93, 132],
  [132, 58],
  [58, 172],
  [172, 136],
  [136, 150],
  [150, 149],
  [149, 176],
  [176, 148],
  [148, 152],
  [152, 377],
  [377, 400],
  [400, 378],
  [378, 379],
  [379, 365],
  [365, 397],
  [397, 288],
  [288, 361],
  [361, 323],
  [323, 454],
  [454, 356],
  [356, 389],
  [389, 251],
  [251, 284],
  [284, 332],
  [332, 297],
  [297, 338],
  [338, 10],

  [109, 105],
  [109, 70],
  [67, 70],
  [67, 63],
  [103, 63],
  [103, 105],
  [338, 334],
  [338, 296],
  [297, 296],
  [297, 293],
  [332, 293],
  [332, 334],

  [70, 63],
  [63, 105],
  [105, 66],
  [66, 107],
  [336, 296],
  [296, 334],
  [334, 293],
  [293, 300],

  [107, 168],
  [66, 160],
  [105, 33],
  [63, 132],
  [70, 93],
  [336, 168],
  [296, 387],
  [334, 263],
  [293, 361],
  [300, 323],

  [33, 160],
  [160, 159],
  [159, 158],
  [158, 133],
  [133, 153],
  [153, 144],
  [144, 33],
  [362, 385],
  [385, 386],
  [386, 387],
  [387, 263],
  [263, 373],
  [373, 380],
  [380, 362],

  [133, 168],
  [362, 168],
  [159, 6],
  [386, 6],

  [168, 6],
  [6, 197],
  [197, 195],
  [195, 5],
  [5, 4],
  [4, 48],
  [4, 278],
  [48, 64],
  [64, 98],
  [98, 5],
  [278, 294],
  [294, 327],
  [327, 5],

  [98, 205],
  [327, 425],
  [205, 132],
  [425, 361],
  [205, 93],
  [425, 323],

  [98, 61],
  [98, 40],
  [327, 291],
  [327, 270],
  [4, 0],

  [61, 40],
  [40, 37],
  [37, 0],
  [0, 267],
  [267, 270],
  [270, 291],
  [291, 321],
  [321, 405],
  [405, 17],
  [17, 181],
  [181, 91],
  [91, 61],

  [17, 152],
  [91, 172],
  [321, 397],
  [61, 58],
  [291, 288],

  [205, 58],
  [425, 288],
  [93, 58],
  [323, 288],
];

function drawHand(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
) {
  const x = (i: number) => lm[i].x * w;
  const y = (i: number) => lm[i].y * h;

  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(x(a), y(a));
    ctx.lineTo(x(b), y(b));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    const isTip = FINGERTIPS.includes(i);
    const radius = isTip ? 4 : 2.5;
    ctx.beginPath();
    ctx.arc(x(i), y(i), radius, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

const FACE_OUTLINE_RING = [
  10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176,
  148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389, 251,
  284, 332, 297, 338, 10,
];

const KEY_POINTS = [10, 152, 234, 454, 33, 133, 362, 263, 4, 61, 291, 107, 336];

function drawFace(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
) {
  const x = (i: number) => lm[i].x * w;
  const y = (i: number) => lm[i].y * h;

  const outlinePts = FACE_OUTLINE_RING.map((i) => ({ x: x(i), y: y(i) }));
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(outlinePts[0].x, outlinePts[0].y);
  for (let i = 1; i < outlinePts.length - 1; i++) {
    const midX = (outlinePts[i].x + outlinePts[i + 1].x) / 2;
    const midY = (outlinePts[i].y + outlinePts[i + 1].y) / 2;
    ctx.quadraticCurveTo(outlinePts[i].x, outlinePts[i].y, midX, midY);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 0.75;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of MESH_EDGES) {
    ctx.beginPath();
    ctx.moveTo(x(a), y(a));
    ctx.lineTo(x(b), y(b));
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  for (const i of MESH_POINTS) {
    ctx.beginPath();
    ctx.arc(x(i), y(i), KEY_POINTS.includes(i) ? 2.2 : 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const IOU_MATCH_THRESHOLD = 0.3;
const MAX_MISSED_FRAMES = 5;
const SMOOTHING_FACTOR = 0.35;
const MIN_CONFIDENCE = 0.45;

const OBJECT_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFD93D",
  "#6BCB77",
  "#4D96FF",
  "#FF6FB5",
  "#C780FA",
  "#FFA45B",
];

function getColorForClass(className: string) {
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = className.charCodeAt(i) + ((hash << 5) - hash);
  }
  return OBJECT_COLORS[Math.abs(hash) % OBJECT_COLORS.length];
}

function computeIOU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;
  const unionArea = aw * ah + bw * bh - interArea;
  return unionArea <= 0 ? 0 : interArea / unionArea;
}

function lerpBbox(
  prev: [number, number, number, number],
  next: [number, number, number, number],
  factor: number,
): [number, number, number, number] {
  return [
    prev[0] + (next[0] - prev[0]) * factor,
    prev[1] + (next[1] - prev[1]) * factor,
    prev[2] + (next[2] - prev[2]) * factor,
    prev[3] + (next[3] - prev[3]) * factor,
  ];
}

function createTrackedObjectFactory() {
  let nextTrackId = 0;

  return function updateTrackedObjects(
    tracked: TrackedObject[],
    detections: DetectedObject[],
  ): TrackedObject[] {
    const filtered = detections.filter((d) => d.score >= MIN_CONFIDENCE);
    const usedDetectionIdx = new Set<number>();
    const updated: TrackedObject[] = [];

    for (const t of tracked) {
      let bestIdx = -1;
      let bestIOU = 0;
      for (let i = 0; i < filtered.length; i++) {
        if (usedDetectionIdx.has(i)) continue;
        if (filtered[i].class !== t.class) continue;
        const iou = computeIOU(t.bbox, filtered[i].bbox);
        if (iou > bestIOU) {
          bestIOU = iou;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1 && bestIOU >= IOU_MATCH_THRESHOLD) {
        const det = filtered[bestIdx];
        usedDetectionIdx.add(bestIdx);
        updated.push({
          id: t.id,
          bbox: det.bbox,
          class: det.class,
          score: det.score,
          missedFrames: 0,
          smoothedBbox: lerpBbox(t.smoothedBbox, det.bbox, SMOOTHING_FACTOR),
        });
      } else if (t.missedFrames < MAX_MISSED_FRAMES) {
        updated.push({
          ...t,
          missedFrames: t.missedFrames + 1,
        });
      }
    }

    for (let i = 0; i < filtered.length; i++) {
      if (usedDetectionIdx.has(i)) continue;
      const det = filtered[i];
      updated.push({
        id: nextTrackId++,
        bbox: det.bbox,
        class: det.class,
        score: det.score,
        missedFrames: 0,
        smoothedBbox: det.bbox,
      });
    }

    return updated;
  };
}

function drawObjects(
  ctx: CanvasRenderingContext2D,
  objects: TrackedObject[],
  w: number,
) {
  for (const obj of objects) {
    const alpha =
      obj.missedFrames === 0
        ? 1
        : Math.max(0, 1 - obj.missedFrames / MAX_MISSED_FRAMES);

    const [x, y, bw, bh] = obj.smoothedBbox;
    const mirroredX = w - x - bw;
    const color = getColorForClass(obj.class);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(mirroredX, y, bw, bh);

    const label = `${obj.class} ${Math.round(obj.score * 100)}%`;
    ctx.font = "14px sans-serif";
    const textWidth = ctx.measureText(label).width;

    ctx.fillStyle = color;
    ctx.fillRect(mirroredX, y - 20, textWidth + 10, 20);

    ctx.fillStyle = "#000000";
    ctx.fillText(label, mirroredX + 5, y - 5);
    ctx.restore();
  }
}

export function useTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  const [objectCount, setObjectCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 640;
    canvas.height = 480;

    let latestHandLandmarks: Landmark[][] = [];
    let latestFaceLandmarks: Landmark[][] = [];
    let latestObjects: TrackedObject[] = [];
    let objectModel: CocoSsdModel | null = null;
    const updateTrackedObjects = createTrackedObjectFactory();

    const hands = new Hands({
      locateFile: (f: string) => `/mediapipe/hands/${f}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });
    hands.onResults((results: HandResults) => {
      latestHandLandmarks = results.multiHandLandmarks ?? [];
      setHandCount(latestHandLandmarks.length);
    });

    const faceMesh = new FaceMesh({
      locateFile: (f: string) => `/mediapipe/face_mesh/${f}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 4,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults((results: FaceResultsLocal) => {
      latestFaceLandmarks = results.multiFaceLandmarks ?? [];
      setFaceCount(latestFaceLandmarks.length);
    });

    let animId = 0;
    let detectId = 0;
    let objectDetectTimeoutId: number | null = null;
    let objectDetectFrameId = 0;
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    const renderLoop = () => {
      if (cancelled) return;

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -w, 0, w, h);
      ctx.restore();

      drawObjects(ctx, latestObjects, w);

      for (const lm of latestFaceLandmarks) {
        const mirroredLm = lm.map((p) => ({ ...p, x: 1 - p.x }));
        drawFace(ctx, mirroredLm, w, h);
      }

      for (const lm of latestHandLandmarks) {
        const mirroredLm = lm.map((p) => ({ ...p, x: 1 - p.x }));
        drawHand(ctx, mirroredLm, w, h);
      }

      animId = requestAnimationFrame(renderLoop);
    };

    const detectLoop = async () => {
      if (cancelled) return;
      if (video.readyState === 4) {
        await hands.send({ image: video });
        await faceMesh.send({ image: video });
      }
      if (cancelled) return;
      detectId = requestAnimationFrame(detectLoop);
    };

    const objectDetectLoop = async () => {
      if (cancelled) return;
      if (objectModel && video.readyState === 4) {
        try {
          const predictions = await objectModel.detect(video);
          if (cancelled) return;
          latestObjects = updateTrackedObjects(latestObjects, predictions);
          setObjectCount(
            latestObjects.filter((o) => o.missedFrames === 0).length,
          );
        } catch (err) {
          console.error(err);
        }
      }
      if (cancelled) return;
      objectDetectTimeoutId = window.setTimeout(() => {
        if (cancelled) return;
        objectDetectFrameId = requestAnimationFrame(objectDetectLoop);
      }, 200);
    };

    const initObjectModel = async () => {
      try {
        await tf.setBackend("webgl");
        await tf.ready();
        const model = await cocoSsd.load({ base: "mobilenet_v2" });
        if (cancelled) return;
        objectModel = model;
      } catch (err) {
        console.error("โหลด object detection model ไม่สำเร็จ:", err);
      }
    };

    initObjectModel();

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video
            .play()
            .then(() => {
              setStatus("tracking...");
              detectLoop().catch(console.error);
              objectDetectLoop().catch(console.error);
              renderLoop();
            })
            .catch(console.error);
        };
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus(`❌ Error: ${err.message}`);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      cancelAnimationFrame(detectId);
      if (objectDetectTimeoutId !== null) clearTimeout(objectDetectTimeoutId);
      cancelAnimationFrame(objectDetectFrameId);
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      hands.close().catch(() => {});
      faceMesh.close().catch(() => {});
    };
  }, [videoRef, canvasRef]);

  return { status, handCount, faceCount, objectCount };
}
