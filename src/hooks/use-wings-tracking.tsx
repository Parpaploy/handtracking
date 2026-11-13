import { useEffect, useState } from "react";
import * as THREE from "three";
import {
  FaceLandmarker,
  ImageSegmenter,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getSharedFileset } from "../lib/mediapipe-fileset";
import {
  createAdaptiveDetector,
  type AdaptiveDetector,
} from "../lib/hand-detector";
import {
  createLandmarkFilter,
  filterLandmarks,
  type LandmarkFilter,
} from "../lib/one-euro";
import {
  CAMERA_CONSTRAINTS,
  createHandIdTracker,
  drawVideoCover,
  mapToStage,
  syncCanvasToDisplay,
} from "../lib/stage";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  WING_MODELS,
  buildModelRig,
  renderModelIcons,
  type WingRig,
} from "../lib/wing-models";

const MODEL_PATH = "/mediapipe/pose_landmarker/pose_landmarker_lite.task";
const MAX_PEOPLE = 4;

// Pose landmark indices.
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_WRIST = 15;
const R_WRIST = 16;

// Shoulders count as visible above ON, and stop counting only below OFF
// (hysteresis: no popping in and out around one threshold).
const VIS_ON = 0.5;
const VIS_OFF = 0.25;

// Smoothing. Landmarks: 1€ filter. Placement on top of that: exponential
// approach per second (higher = snappier).
const FILTER_2D = { minCutoff: 1.8, beta: 8, dCutoff: 1 };
const FILTER_3D = { minCutoff: 0.8, beta: 1.5, dCutoff: 1 };
const FOLLOW_ROT = 18;
const FOLLOW_SCALE = 12;

// A missed detection or two must not make wings blink: keep showing the
// last pose, fade out only after a real absence, fade back in on return.
const FADE_AFTER_MS = 250;
const FADE_OUT_PER_S = 4;
const FADE_IN_PER_S = 6;
const FORGET_AFTER_MS = 900;

// Picker (circles across the top of the stage, CSS px).
const PICK_R = 30;
const PICK_GAP = 16;
const PICK_CY = 112;

// Changing wings: point with an index finger (found by the hand model,
// which sees real fingertips) and hold it on a circle.
const DWELL_MS = 700;
const PICK_REACH = PICK_R + 14; // how close to a circle's centre counts
const PICK_GRACE_MS = 300; // the tip may slip off / drop out this long
const TIP_SMOOTH = 0.5;
// A hand belongs to the person whose pose wrist is nearest (stage units).
const HAND_OWNER_DIST = 0.18;
const MAX_HANDS = 2;

// Front or back: the pose model invents a face even from behind, so a
// real face detector decides. It runs every few frames to save power.
// Who is in front of the wings: a segmentation model made for webcams
// (much better close up, and on clothes that match the wall, than the
// pose model's own mask).
const SEGMENTER_PATH = "/mediapipe/image_segmenter/selfie_segmenter.tflite";
const FACE_MODEL_PATH = "/mediapipe/face_landmarker/face_landmarker.task";
const FACE_EVERY = 4;
// Switching side needs the clues to agree for this long — a single
// false face on the back of a head must not flip the wings.
const TURN_HOLD_MS = 600;
// Below this shoulder width (share of the stage) faces are too small to
// find reliably; fall back on the pose clues.
const FACE_MIN_SPAN = 0.07;
/** A face seen this recently → facing us. */
const FACE_FRESH_MS = 500;
/** No face for this long (close enough to see one) → back to us. */
const FACE_GONE_MS = 1100;
/** A new person must be seen this long before getting wings. */
const CONFIRM_MS = 300;
const DEBUG = new URLSearchParams(location.search).has("debug");
// ?nocut: skip the camera cut-out on top (to check the 3D body occluder)
const NO_CUT = new URLSearchParams(location.search).has("nocut");
const START_WING = new URLSearchParams(location.search).get("wing");

// Someone who drops out and comes back near the same spot keeps their wings.
const REBIND_MS = 4000;
const REBIND_DIST = 0.3;

const PERSON_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#4cc9f0"];

type P = { x: number; y: number; z: number; visibility?: number };

interface Person {
  id: number;
  style: number;
  color: string;
  filter2d: LandmarkFilter;
  filter3d: LandmarkFilter;
  lm: P[] | null;
  world: P[] | null;
  seenAt: number;
  alpha: number;
  shouldersOk: boolean;
  /** −1 facing the camera … +1 back to the camera (smoothed). */
  facing: number;
  /** Back to the camera: wings go on the camera side, in front of them. */
  back: boolean;
  /** False until the first front/back estimate (taken as-is, no wait). */
  facingKnown: boolean;
  /** Share of recent face checks that found a face on this head (0..1). */
  faceScore: number;
  /** When the clues started pointing the other way (0 = they agree). */
  turnSince: number;
  /** last time a real face was confirmed on this head */
  lastFaceAt: number;
  /** first seen (0 = someone we already knew) */
  bornAt: number;
  rig: WingRig | null;
  /** Invisible body shape in the 3D scene that hides wings behind it. */
  occluder: THREE.Mesh | null;
  rigStyle: number;
  placed: boolean;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  beat: number;
  drag: number;
  heave: number;
  quat: THREE.Quaternion;
  scale: number;
  pxPerM: number;
  changedAt: number;
}

const pickCircles = (w: number) => {
  const n = WING_MODELS.length;
  const total = n * PICK_R * 2 + (n - 1) * PICK_GAP;
  const x0 = (w - total) / 2 + PICK_R;
  return WING_MODELS.map((_, i) => ({
    x: x0 + i * (PICK_R * 2 + PICK_GAP),
    y: PICK_CY,
  }));
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Frame-rate independent approach factor. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** MediaPipe world point → our 3D space: x right on the (mirrored)
 *  screen, y up, z towards the camera. */
const HALF_TURN = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI,
);

const toV = (p: P) => new THREE.Vector3(-p.x, -p.y, -p.z);

export function useWingsTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [peopleCount, setPeopleCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Layers: camera (canvas) → 3D wings (glCanvas) → people cut out of
    // the camera image + effects + picker (overlay). The cut-out on top is
    // what puts the wings behind each body.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (err) {
      const msg = `❌ Error: เบราว์เซอร์นี้ใช้ WebGL ไม่ได้ (${String(err)})`;
      queueMicrotask(() => setStatus(msg));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    // Model wings are drawn as two halves, each trimmed by its own plane.
    renderer.localClippingEnabled = true;
    const glCanvas = renderer.domElement;
    glCanvas.className =
      "pointer-events-none absolute inset-0 block h-full w-full";
    canvas.after(glCanvas);
    const overlay = document.createElement("canvas");
    overlay.className =
      "pointer-events-none absolute inset-0 block h-full w-full";
    glCanvas.after(overlay);
    const octx = overlay.getContext("2d")!;

    const scene = new THREE.Scene();
    // Soft studio reflections so metallic model materials aren't black.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = 0.5;
    // Perspective camera placed so the z = 0 plane maps 1:1 to stage
    // pixels (x = px, y = −px): bodies line up, and the wings' depth
    // foreshortens like a real lens.
    const FOV = 28; // a gentle lens: depth shows, nothing looks warped
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f55, 1.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(0.35, 0.8, 1);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.8);
    rim.position.set(-0.6, 0.3, -1);
    scene.add(rim);

    // Light the wings like the room: average colour and brightness of the
    // camera picture, and which side is brighter.
    const probe = document.createElement("canvas");
    probe.width = 4;
    probe.height = 4;
    const pctx = probe.getContext("2d", { willReadFrequently: true })!;
    const room = { r: 1, g: 1, b: 1, lum: 0.5, side: 0 };
    let probeFrame = 0;
    const sampleRoom = () => {
      if (++probeFrame % 10 || !video.videoWidth) return;
      pctx.drawImage(video, 0, 0, 4, 4);
      const d = pctx.getImageData(0, 0, 4, 4).data;
      let r = 0,
        g = 0,
        b = 0,
        left = 0,
        right = 0;
      for (let i = 0; i < 16; i++) {
        const L = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;
        r += d[i * 4];
        g += d[i * 4 + 1];
        b += d[i * 4 + 2];
        // video is not mirrored: its left columns are the screen's right
        if (i % 4 < 2) right += L;
        else left += L;
      }
      const m = Math.max(r, g, b) || 1;
      const k = 0.15;
      room.r += (r / m - room.r) * k;
      room.g += (g / m - room.g) * k;
      room.b += (b / m - room.b) * k;
      room.lum += ((r + g + b) / (16 * 765) - room.lum) * k;
      room.side += ((right - left) / 8 - room.side) * k;
      const tint = new THREE.Color(
        0.5 + 0.5 * room.r,
        0.5 + 0.5 * room.g,
        0.5 + 0.5 * room.b,
      );
      const bright = clamp(room.lum / 0.45, 0.35, 1.4);
      hemi.color.copy(tint);
      hemi.intensity = 1.5 * bright;
      sun.color.copy(tint);
      sun.intensity = 1.6 * bright;
      sun.position.set(clamp(room.side * 4, -1, 1), 0.8, 1);
      scene.environmentIntensity = 0.5 * bright;
    };

    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarker | null = null;
    let lastVideoTime = -1;
    let lastTs = 0;
    let lastCount = -1;
    let nextStyle = 0;
    let colorIdx = 0;
    let glW = 0;
    let glH = 0;

    const assignIds = createHandIdTracker(0.25, 30);
    const assignHandIds = createHandIdTracker(0.18, 8);
    let hands: AdaptiveDetector | null = null;
    let faces: FaceLandmarker | null = null;
    let faceFrame = 0;
    let faceTs = 0;
    let lastFaceVideoTime = -1;
    /** Pointing hands by id: smoothed fingertip (CSS px) and dwell state. */
    const pointers = new Map<
      number,
      {
        x: number;
        y: number;
        seenAt: number;
        owner: number | null;
        idx: number;
        since: number;
        overAt: number;
        needLeave: boolean;
      }
    >();
    let lastHandVideoTime = -1;
    const people = new Map<number, Person>();
    const lost: {
      style: number;
      color: string;
      back: boolean;
      x: number;
      y: number;
      at: number;
    }[] = [];

    const maskCanvas = document.createElement("canvas");
    const personCanvas = document.createElement("canvas");
    let maskData: ImageData | null = null;
    let haveCutout = false;
    let cutoutSource = "-";
    let segmenter: ImageSegmenter | null = null;
    let segTs = 0;
    const selfieCanvas = document.createElement("canvas");
    let selfieData: ImageData | null = null;
    const backCanvas = document.createElement("canvas");
    let backData: ImageData | null = null;

    const icons: (HTMLCanvasElement | null)[] = WING_MODELS.map(() => null);
    renderModelIcons(WING_MODELS)
      .then((list) => list.forEach((icon, i) => (icons[i] = icon)))
      .catch(console.error);
    const tmp = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const targetQ = new THREE.Quaternion();

    const newPerson = (id: number, lm: P[], now: number): Person => {
      const cx = (lm[L_SHOULDER].x + lm[R_SHOULDER].x) / 2;
      const cy = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
      let best = -1;
      let bestD = REBIND_DIST;
      lost.forEach((l, i) => {
        const d = Math.hypot(l.x - cx, l.y - cy);
        if (now - l.at < REBIND_MS && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      let style: number;
      let color: string;
      let back: boolean | null = null;
      if (best !== -1) {
        ({ style, color, back } = lost[best]);
        lost.splice(best, 1);
      } else {
        const want = WING_MODELS.findIndex((m) => m.key === START_WING);
        style =
          nextStyle === 0 && want !== -1
            ? (nextStyle++, want)
            : nextStyle++ % WING_MODELS.length;
        color = PERSON_COLORS[colorIdx++ % PERSON_COLORS.length];
      }
      return {
        id,
        style,
        color,
        filter2d: createLandmarkFilter(),
        filter3d: createLandmarkFilter(),
        lm: null,
        world: null,
        seenAt: now,
        alpha: 0,
        shouldersOk: false,
        facing: back ? 1 : -1,
        back: back ?? false,
        facingKnown: back !== null,
        faceScore: 1,
        turnSince: 0,
        lastFaceAt: now,
        bornAt: best !== -1 ? 0 : now,
        rig: null,
        occluder: null,
        rigStyle: -1,
        placed: false,
        pos: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        beat: id * 1.7,
        drag: 0,
        heave: 0,
        quat: new THREE.Quaternion(),
        scale: 1,
        pxPerM: 0,
        changedAt: best !== -1 ? 0 : now,
      };
    };

    // ---- Body occluder ------------------------------------------------
    // A flat, invisible silhouette of each person (torso, neck, head, arms)
    // drawn into the depth buffer at the body plane (z = 0). Wings behind
    // the body (z < 0) are hidden by it, whatever the camera picture looks
    // like — the segmentation cut-out on top then only refines the edges.
    // ---- People from the segmentation mask, as depth ------------------
    // The camera's person mask becomes an invisible screen-sized plane at
    // the body plane (z = 0). Wherever the mask says "person", it fills
    // the depth buffer, so wing parts behind the body are simply not drawn
    // there — crisp edges, no see-through patches, no pasted cut-out.
    const maskTex = new THREE.CanvasTexture(maskCanvas);
    maskTex.generateMipmaps = false;
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.magFilter = THREE.LinearFilter;
    const maskOccluder = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: maskTex,
        alphaTest: 0.5,
        colorWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    maskOccluder.renderOrder = -2;
    maskOccluder.frustumCulled = false;
    maskOccluder.visible = false;
    scene.add(maskOccluder);
    let maskDirty = false;

    /** Lay the mask over the stage exactly like the (mirrored) video. */
    const placeMaskOccluder = (
      w: number,
      h: number,
      vw: number,
      vh: number,
    ) => {
      // Held close to the lens (and shrunk to cover the same view), so it
      // hides the wings whatever their depth: someone facing us can never
      // have a wing drawn over them.
      const k = Math.max(w / vw, h / vh);
      const near = 0.15;
      maskOccluder.position.set(w / 2, -h / 2, camera.position.z * (1 - near));
      maskOccluder.scale.set(-vw * k * near, vh * k * near, 1); // −x: mirrored
    };

    const occluderMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      side: THREE.DoubleSide,
    });
    const HEAD_SEGS = 16;
    // quads: torso, neck, 4 arm segments; plus the head as a fan
    const OCC_TRIS = 6 * 2 + HEAD_SEGS;

    const makeOccluder = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(OCC_TRIS * 9), 3),
      );
      const m = new THREE.Mesh(g, occluderMat);
      m.renderOrder = -1; // before the wings, so its depth is there first
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };

    /** Rebuild a person's silhouette from their landmarks (stage px). */
    const updateOccluder = (person: Person) => {
      const lm = person.lm!;
      const w = canvas.width;
      const h = canvas.height;
      person.occluder ??= makeOccluder();
      const arr = (
        person.occluder.geometry.attributes.position as THREE.BufferAttribute
      ).array as Float32Array;
      let k = 0;
      const tri = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        cx: number,
        cy: number,
      ) => {
        arr[k++] = ax;
        arr[k++] = -ay;
        arr[k++] = 0;
        arr[k++] = bx;
        arr[k++] = -by;
        arr[k++] = 0;
        arr[k++] = cx;
        arr[k++] = -cy;
        arr[k++] = 0;
      };
      const quad = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        c: { x: number; y: number },
        d: { x: number; y: number },
      ) => {
        tri(a.x, a.y, b.x, b.y, c.x, c.y);
        tri(a.x, a.y, c.x, c.y, d.x, d.y);
      };
      /** A thick line from a to b. */
      const limb = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        r: number,
      ) => {
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = (-(b.y - a.y) / l) * r;
        const ny = ((b.x - a.x) / l) * r;
        // stretch past the joints so neighbouring segments overlap
        const ex = ((b.x - a.x) / l) * r * 0.6;
        const ey = ((b.y - a.y) / l) * r * 0.6;
        quad(
          { x: a.x - ex + nx, y: a.y - ey + ny },
          { x: b.x + ex + nx, y: b.y + ey + ny },
          { x: b.x + ex - nx, y: b.y + ey - ny },
          { x: a.x - ex - nx, y: a.y - ey - ny },
        );
      };
      const P = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h });
      const seen = (i: number) => (lm[i].visibility ?? 0) > 0.3;
      const sl = P(L_SHOULDER);
      const sr = P(R_SHOULDER);
      const span = Math.hypot(sr.x - sl.x, sr.y - sl.y) || 1;
      const mid = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 };
      // torso down to the hips, or off the bottom of the frame
      let hl = P(L_HIP);
      let hr = P(R_HIP);
      if (!seen(L_HIP) || !seen(R_HIP)) {
        hl = { x: sl.x, y: sl.y + span * 3 };
        hr = { x: sr.x, y: sr.y + span * 3 };
      }
      const out = (p: { x: number; y: number }, by: number) => ({
        x: mid.x + (p.x - mid.x) * by,
        y: p.y,
      });
      // shoulders are rounder and wider than the joint points
      const up = span * 0.22;
      quad(
        { ...out(sl, 1.3), y: sl.y - up },
        { ...out(sr, 1.3), y: sr.y - up },
        out(hr, 1.2),
        out(hl, 1.2),
      );
      // neck and head
      const ears = {
        x: ((lm[7].x + lm[8].x) / 2) * w,
        y: ((lm[7].y + lm[8].y) / 2) * h,
      };
      limb(mid, ears, span * 0.32);
      const hr0 = span * 0.44;
      for (let i = 0; i < HEAD_SEGS; i++) {
        const a0 = (i / HEAD_SEGS) * Math.PI * 2;
        const a1 = ((i + 1) / HEAD_SEGS) * Math.PI * 2;
        tri(
          ears.x,
          ears.y,
          ears.x + Math.cos(a0) * hr0,
          ears.y + Math.sin(a0) * hr0 * 1.2,
          ears.x + Math.cos(a1) * hr0,
          ears.y + Math.sin(a1) * hr0 * 1.2,
        );
      }
      // arms (shoulder → elbow → wrist), only where tracked
      for (const [s0, e, wr] of [
        [L_SHOULDER, 13, L_WRIST],
        [R_SHOULDER, 14, R_WRIST],
      ]) {
        if (seen(e)) limb(P(s0), P(e), span * 0.2);
        else limb(P(s0), P(s0), 0);
        if (seen(e) && seen(wr)) limb(P(e), P(wr), span * 0.15);
        else limb(P(s0), P(s0), 0);
      }
      person.occluder.geometry.attributes.position.needsUpdate = true;
    };

    const dropRig = (p: Person) => {
      if (p.occluder) {
        scene.remove(p.occluder);
        p.occluder.geometry.dispose();
        p.occluder = null;
      }
      if (!p.rig) return;
      scene.remove(p.rig.group);
      p.rig.dispose();
      p.rig = null;
      p.rigStyle = -1;
    };

    /** Every person's segmentation mask → one cut-out of the camera. A
     *  frame without masks keeps the previous cut-out (no flicker). */
    /** Copy a 0..1 mask into a canvas's alpha (edge 0.3 → 0, 0.6 → 1). */
    const maskToCanvas = (
      masks: {
        getAsFloat32Array(): Float32Array;
        width: number;
        height: number;
      }[],
      target: HTMLCanvasElement,
      data: ImageData | null,
    ) => {
      const mw = masks[0].width;
      const mh = masks[0].height;
      if (target.width !== mw || target.height !== mh) {
        target.width = mw;
        target.height = mh;
        data = null;
      }
      data ??= new ImageData(mw, mh);
      const px = data.data;
      px.fill(0);
      for (const m of masks) {
        const a = m.getAsFloat32Array();
        for (let i = 0, j = 3; i < a.length; i++, j += 4) {
          const v = (a[i] - 0.3) * 850;
          if (v > px[j]) px[j] = v;
        }
      }
      target.getContext("2d")!.putImageData(data, 0, 0);
      return data;
    };

    /**
     * The camera picture of the people in front of their wings, drawn on
     * top of the wings. People with their back to the camera are left out
     * (their wings are on the side we see).
     */
    const updateCutout = (
      result: PoseLandmarkerResult,
      skip: Set<number>,
      now: number,
    ) => {
      const poseMasks = result.segmentationMasks ?? [];
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      try {
        if (result.landmarks.length === 0) {
          haveCutout = false;
          return;
        }
        if (maskCanvas.width !== vw || maskCanvas.height !== vh) {
          maskCanvas.width = vw;
          maskCanvas.height = vh;
          personCanvas.width = vw;
          personCanvas.height = vh;
        }
        const mc = maskCanvas.getContext("2d")!;
        mc.clearRect(0, 0, vw, vh);

        let selfieOk = false;
        if (segmenter) {
          segTs = Math.max(segTs + 1, Math.round(now));
          const r = segmenter.segmentForVideo(video, segTs);
          const conf = r.confidenceMasks ?? [];
          // one mask = person; two = [background, person]
          const person = conf[conf.length - 1];
          if (person) {
            selfieData = maskToCanvas([person], selfieCanvas, selfieData);
            mc.imageSmoothingEnabled = true;
            mc.filter = `blur(${Math.max(2, Math.round(vw / 160))}px)`;
            mc.drawImage(selfieCanvas, 0, 0, vw, vh);
            mc.filter = "none";
            selfieOk = true;
            cutoutSource = "selfie";
          }
          r.close();
        }
        if (!selfieOk) {
          // fall back on the pose model's masks (people facing us only)
          const front = poseMasks.filter((_, i) => !skip.has(i));
          if (front.length === 0) {
            haveCutout = false;
            return;
          }
          cutoutSource = "pose";
          maskData = maskToCanvas(front, selfieCanvas, maskData);
          mc.filter = "blur(1.5px)";
          mc.drawImage(selfieCanvas, 0, 0, vw, vh);
          mc.filter = "none";
        } else if (skip.size) {
          // remove the people who have their back to us
          const back = poseMasks.filter((_, i) => skip.has(i));
          if (back.length) {
            backData = maskToCanvas(back, backCanvas, backData);
            mc.globalCompositeOperation = "destination-out";
            mc.filter = "blur(3px)";
            mc.drawImage(backCanvas, 0, 0, vw, vh);
            mc.filter = "none";
            mc.globalCompositeOperation = "source-over";
          }
        }

        if (!DEBUG) {
          haveCutout = true;
          maskDirty = true;
          return;
        }
        const pc = personCanvas.getContext("2d")!;
        pc.globalCompositeOperation = "source-over";
        pc.clearRect(0, 0, vw, vh);
        pc.drawImage(video, 0, 0, vw, vh);
        pc.globalCompositeOperation = "destination-in";
        pc.drawImage(maskCanvas, 0, 0);
        pc.globalCompositeOperation = "source-over";
        haveCutout = true;
        maskDirty = true;
      } finally {
        for (const m of poseMasks) m.close();
      }
    };

    /**
     * Front or back to the camera? Clues, each −1 (front) … +1 (back):
     * - a real face found on this person's head (strongest);
     * - the left/right shoulders have swapped sides on the mirrored screen;
     * - the nose is further from the camera than the shoulders.
     * Smoothed, and a switch needs the clues to agree for a while.
     */
    const updateFacing = (person: Person, now: number, dt: number) => {
      const lm = person.lm!;
      const span = Math.abs(lm[L_SHOULDER].x - lm[R_SHOULDER].x);
      const swapped = lm[L_SHOULDER].x > lm[R_SHOULDER].x;
      // shoulders nearly overlapping (side-on) says nothing
      const sSwap = (swapped ? 1 : -1) * clamp(span / 0.06, 0, 1);
      let sDepth = 0;
      const wd = person.world;
      if (wd) {
        // MediaPipe world z: smaller = nearer the camera
        const dz = wd[0].z - (wd[L_SHOULDER].z + wd[R_SHOULDER].z) / 2;
        sDepth = clamp(dz / 0.08, -1, 1);
      }
      const score = 0.6 * sSwap + 0.4 * sDepth;
      if (!person.facingKnown) {
        // a new person: trust the first look instead of starting "front"
        person.facingKnown = true;
        person.facing = score;
        person.back = score > 0.1;
        return;
      }
      person.facing += (score - person.facing) * follow(3, dt);
      // One judge at a time, so the answer cannot flip-flop:
      // - near enough to see a face (and the head is in the picture): a
      //   face means front, no face for a while means back, nothing else;
      // - too far for faces: the body clues, which must be clear.
      const headIn = lm[0].y > 0.03 && lm[0].x > 0.02 && lm[0].x < 0.98;
      let want = person.back;
      let hold = TURN_HOLD_MS;
      if (faces && span > FACE_MIN_SPAN && headIn) {
        const since = now - person.lastFaceAt;
        if (since < FACE_FRESH_MS) want = false;
        else if (since > FACE_GONE_MS) want = true;
        hold = 120;
      } else {
        if (person.facing > 0.4) want = true;
        else if (person.facing < -0.4) want = false;
        // no face verdict to compare against here
        person.lastFaceAt = now;
      }
      if (want === person.back) person.turnSince = 0;
      else if (!person.turnSince) person.turnSince = now;
      else if (now - person.turnSince > hold) {
        person.back = want;
        person.turnSince = 0;
      }
    };

    /** Find real faces and mark whose head each one is on. */
    const detectFaces = (now: number) => {
      if (!faces || ++faceFrame % FACE_EVERY) return;
      if (video.currentTime === lastFaceVideoTime) return;
      lastFaceVideoTime = video.currentTime;
      faceTs = Math.max(faceTs + 1, Math.round(now));
      let found: P[][];
      try {
        found = faces.detectForVideo(video, faceTs).faceLandmarks as P[][];
      } catch (err) {
        console.error("face detect ล้มเหลว:", err);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const hit = new Set<Person>();
      for (const f of found) {
        // landmark 1 = nose tip
        const [nose] = mapToStage([f[1]], vw, vh, w, h);
        const fx = 1 - nose.x;
        const fy = nose.y;
        let best: Person | null = null;
        let bestD = Infinity;
        for (const person of people.values()) {
          const lm = person.lm;
          if (!lm || now - person.seenAt > FADE_AFTER_MS) continue;
          const span =
            Math.hypot(
              lm[L_SHOULDER].x - lm[R_SHOULDER].x,
              lm[L_SHOULDER].y - lm[R_SHOULDER].y,
            ) || 0.1;
          const hx = (lm[7].x + lm[8].x) / 2; // between the ears
          const hy = (lm[7].y + lm[8].y) / 2;
          const d = Math.hypot(fx - hx, fy - hy) / span;
          if (d < 0.8 && d < bestD) {
            bestD = d;
            best = person;
          }
        }
        if (best) hit.add(best);
      }
      for (const person of people.values()) {
        if (!person.lm || now - person.seenAt > FADE_AFTER_MS) continue;
        const v = hit.has(person) ? 1 : 0;
        person.faceScore += (v - person.faceScore) * 0.3;
        // two looks in a row: one stray "face" found in hair is ignored
        if (v && person.faceScore > 0.5) person.lastFaceAt = now;
      }
    };

    const detect = (now: number) => {
      if (
        !landmarker ||
        video.readyState < 2 ||
        !video.videoWidth ||
        video.currentTime === lastVideoTime
      )
        return;
      lastVideoTime = video.currentTime;
      const ts = Math.max(lastTs + 1, Math.round(now));
      const dt = clamp((ts - lastTs) / 1000, 1 / 240, 1 / 5);
      lastTs = ts;
      let result: PoseLandmarkerResult;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch (err) {
        console.error("pose detect ล้มเหลว:", err);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const poses = result.landmarks.map((lm) =>
        mapToStage(lm as P[], vw, vh, w, h).map((p) => ({ ...p, x: 1 - p.x })),
      );
      // Track people by their shoulders: the face points are guesses when
      // someone turns around, and made them look like a new person.
      // The pose model sometimes reports the same body twice. Keep the
      // clearest one: a person gets one pair of wings.
      const info = poses.map((lm) => {
        const ax = lm[L_SHOULDER].x * w;
        const ay = lm[L_SHOULDER].y * h;
        const bx = lm[R_SHOULDER].x * w;
        const by = lm[R_SHOULDER].y * h;
        return {
          x: (ax + bx) / 2,
          y: (ay + by) / 2,
          span: Math.hypot(ax - bx, ay - by),
          vis:
            (lm[L_SHOULDER].visibility ?? 1) + (lm[R_SHOULDER].visibility ?? 1),
        };
      });
      const order = info
        .map((_, i) => i)
        .sort((a, b) => info[b].vis - info[a].vis);
      const keep: number[] = [];
      for (const i of order) {
        const a = info[i];
        const twin = keep.some((j) => {
          const b = info[j];
          return (
            Math.hypot(a.x - b.x, a.y - b.y) < 0.7 * Math.max(a.span, b.span, 1)
          );
        });
        if (!twin) keep.push(i);
      }
      keep.sort((a, b) => a - b);
      const ids = assignIds(
        keep.map((k) => {
          const lm = poses[k];
          const c = {
            x: (lm[L_SHOULDER].x + lm[R_SHOULDER].x) / 2,
            y: (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2,
            z: 0,
          };
          return Array<P>(10).fill(c);
        }),
      );
      const skip = new Set<number>();
      keep.forEach((i, n) => {
        const lm = poses[i];
        let person = people.get(ids[n]);
        if (!person) {
          person = newPerson(ids[n], lm, now);
          people.set(ids[n], person);
        }
        person.lm = filterLandmarks(person.filter2d, lm, dt, FILTER_2D);
        const world = result.worldLandmarks[i] as P[] | undefined;
        if (world)
          person.world = filterLandmarks(person.filter3d, world, dt, FILTER_3D);
        person.seenAt = now;
        const va = person.lm[L_SHOULDER].visibility ?? 1;
        const vb = person.lm[R_SHOULDER].visibility ?? 1;
        if (person.shouldersOk) {
          if (va < VIS_OFF || vb < VIS_OFF) person.shouldersOk = false;
        } else if (va > VIS_ON && vb > VIS_ON) person.shouldersOk = true;
        updateFacing(person, now, dt);
        if (person.back) skip.add(i);
      });
      // A fading leftover standing where a live person is = a second pair
      // of wings on them. Remove it at once.
      for (const ghost of people.values()) {
        if (ghost.seenAt === now || !ghost.lm || ghost.alpha === 0) continue;
        const gx = ((ghost.lm[L_SHOULDER].x + ghost.lm[R_SHOULDER].x) / 2) * w;
        const gy = ((ghost.lm[L_SHOULDER].y + ghost.lm[R_SHOULDER].y) / 2) * h;
        if (
          keep.some(
            (i) =>
              Math.hypot(info[i].x - gx, info[i].y - gy) < 0.8 * info[i].span,
          )
        )
          ghost.alpha = 0;
      }
      updateCutout(result, skip, now);

      const count = [...people.values()].filter(
        (p) => now - p.seenAt < FADE_AFTER_MS,
      ).length;
      if (count !== lastCount) {
        lastCount = count;
        setPeopleCount(count);
      }
    };

    /** Move a person's rig to their body (smoothly) and pose it. */
    const placeRig = (person: Person, dt: number) => {
      const lm = person.lm;
      const world = person.world;
      if (!lm || !world) return false;
      const w = canvas.width;
      const h = canvas.height;

      if (person.rigStyle !== person.style) {
        dropRig(person);
        person.rig = buildModelRig(WING_MODELS[person.style]);
        person.rigStyle = person.style;
        scene.add(person.rig.group);
      }
      const rig = person.rig!;

      // Screen-left / screen-right shoulders (2D) and their world points.
      const aLeft = lm[L_SHOULDER].x < lm[R_SHOULDER].x;
      const iL = aLeft ? L_SHOULDER : R_SHOULDER;
      const iR = aLeft ? R_SHOULDER : L_SHOULDER;
      const SL = { x: lm[iL].x * w, y: lm[iL].y * h };
      const SR = { x: lm[iR].x * w, y: lm[iR].y * h };
      const mid = { x: (SL.x + SR.x) / 2, y: (SL.y + SR.y) / 2 };

      const wl = toV(world[iL]);
      const wr = toV(world[iR]);
      const right = wr.clone().sub(wl);
      const shoulderM = right.length() || 0.36;
      right.normalize();
      // Tilt exactly like the shoulders we can see: take the on-screen
      // shoulder line for the in-plane direction, the 3D estimate only
      // for how far the body is turned.
      const sdx = SR.x - SL.x;
      const sdy = -(SR.y - SL.y);
      const sLen = Math.hypot(sdx, sdy);
      const flat = Math.hypot(right.x, right.y);
      if (sLen > 1 && flat > 0.25) {
        right.x = (sdx / sLen) * flat;
        right.y = (sdy / sLen) * flat;
      }
      // Wings follow the body's turn only part of the way: a full turn
      // would swing one wing through the body toward the camera.
      const maxTurn = 0.5; // sin(30°)
      if (Math.abs(right.z) > maxTurn) {
        const f =
          Math.sqrt(1 - maxTurn * maxTurn) /
          (Math.hypot(right.x, right.y) || 1);
        right.set(right.x * f, right.y * f, Math.sign(right.z) * maxTurn);
        if (right.lengthSq() < 0.5) right.set(1, 0, 0);
        right.normalize();
      }
      let up = new THREE.Vector3(0, 1, 0);
      const hl = world[L_HIP];
      const hr = world[R_HIP];
      if ((hl.visibility ?? 0) > VIS_ON && (hr.visibility ?? 0) > VIS_ON) {
        const hipMid = toV(hl).add(toV(hr)).multiplyScalar(0.5);
        up = wl.clone().add(wr).multiplyScalar(0.5).sub(hipMid);
      }
      up.addScaledVector(right, -up.dot(right));
      if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
      up.normalize();
      const fwd = tmp.crossVectors(right, up).normalize();
      basis.makeBasis(right, up, fwd);
      targetQ.setFromRotationMatrix(basis);
      // Back to the camera: the body's front points away, so turn the rig
      // around — the wings then sit on the back we can see, in front of it.
      if (person.back) targetQ.multiply(HALF_TURN);

      // Pixels per metre from the shoulder line as seen on screen (both
      // shrink together when someone turns, so the ratio holds).
      const shoulderPx = Math.hypot(SR.x - SL.x, SR.y - SL.y);
      const projected = Math.hypot(wr.x - wl.x, wr.y - wl.y);
      // Measured only while the shoulders are fairly square to the camera.
      // Side-on they are a few noisy pixels wide and the wings blew up.
      if (projected > 0.08 && (flat > 0.75 || !person.pxPerM)) {
        const ppm = shoulderPx / projected;
        person.pxPerM = person.pxPerM
          ? person.pxPerM + (ppm - person.pxPerM) * follow(FOLLOW_SCALE, dt)
          : ppm;
      }
      if (!person.pxPerM) return false;
      const scale = person.pxPerM * shoulderM;

      const target = new THREE.Vector3(mid.x, -mid.y, 0);
      if (!person.placed) {
        person.pos.copy(target);
        person.prevPos.copy(target);
        person.quat.copy(targetQ);
        person.scale = scale;
        person.placed = true;
      } else {
        // The landmarks are already filtered: follow them exactly, any
        // extra easing here is what makes wings trail behind the body.
        person.pos.copy(target);
        person.quat.slerp(targetQ, follow(FOLLOW_ROT, dt));
        person.scale += (scale - person.scale) * follow(FOLLOW_SCALE, dt);
      }
      rig.group.position.copy(person.pos);
      rig.group.quaternion.copy(person.quat);
      // The wing roots sit behind (or in front of) the body plane. Through
      // the lens that would slide them toward the middle of the screen and
      // shrink them — off the back. Slide/scale them back so the roots
      // land exactly on the spine.
      const root = tmp
        .set(0, rig.rootY, rig.rootZ)
        .applyQuaternion(person.quat)
        .multiplyScalar(person.scale);
      const k = -root.z / camera.position.z;
      rig.group.position.x += (person.pos.x + root.x - camera.position.x) * k;
      rig.group.position.y += (person.pos.y + root.y - camera.position.y) * k;
      rig.group.scale.setScalar(person.scale * (1 + k));

      const style = WING_MODELS[person.style];
      // Body motion (stage px/s) → wings fold back and trail behind.
      const vx = (person.pos.x - person.prevPos.x) / Math.max(dt, 1e-3);
      const vy = (person.pos.y - person.prevPos.y) / Math.max(dt, 1e-3);
      person.prevPos.copy(person.pos);
      const per = person.scale || 1;
      person.drag +=
        (clamp(Math.hypot(vx, vy) / per / 4, 0, 1) - person.drag) *
        follow(5, dt);
      person.heave +=
        (clamp(vy / per / 3, -1, 1) - person.heave) * follow(6, dt);
      // Faster beat while moving, like taking off.
      person.beat += dt * style.flapSpeed * (1 + person.drag * 0.8);
      rig.update(person.beat, person.drag, person.heave);
      return true;
    };

    /** Fingertips from the hand model, each tied to its owner. */
    const detectHands = (now: number) => {
      if (!hands || video.currentTime === lastHandVideoTime) return;
      lastHandVideoTime = video.currentTime;
      const r = hands.detect(video);
      if (!r) return;
      const w = canvas.width;
      const h = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const list = r.landmarks.map((lm) =>
        mapToStage(lm as P[], vw, vh, w, h).map((p) => ({ ...p, x: 1 - p.x })),
      );
      const ids = assignHandIds(list);
      list.forEach((lm, i) => {
        // Owner: the person whose pose wrist is nearest this hand's wrist.
        let owner: number | null = null;
        let best = HAND_OWNER_DIST;
        for (const person of people.values()) {
          if (!person.lm || now - person.seenAt > FADE_AFTER_MS) continue;
          for (const wi of [L_WRIST, R_WRIST]) {
            const d = Math.hypot(
              person.lm[wi].x - lm[0].x,
              person.lm[wi].y - lm[0].y,
            );
            if (d < best) {
              best = d;
              owner = person.id;
            }
          }
        }
        const tx = lm[8].x * w;
        const ty = lm[8].y * h;
        const ptr = pointers.get(ids[i]);
        if (ptr) {
          ptr.x += (tx - ptr.x) * TIP_SMOOTH;
          ptr.y += (ty - ptr.y) * TIP_SMOOTH;
          ptr.seenAt = now;
          if (owner !== null) ptr.owner = owner;
        } else {
          pointers.set(ids[i], {
            x: tx,
            y: ty,
            seenAt: now,
            owner,
            idx: -1,
            since: now,
            overAt: 0,
            needLeave: false,
          });
        }
      });
    };

    /** Each person picks their own wings: hold an index finger on a circle. */
    const updatePicker = (now: number) => {
      const circles = pickCircles(overlay.width);
      const waiting: { color: string; idx: number; p: number }[] = [];
      const tips: { x: number; y: number; color: string }[] = [];
      for (const [id, ptr] of pointers) {
        if (now - ptr.seenAt > 600) {
          pointers.delete(id);
          continue;
        }
        if (now - ptr.seenAt > PICK_GRACE_MS) continue;
        const person = ptr.owner !== null ? people.get(ptr.owner) : undefined;
        const color = person?.color ?? "#ffffff";
        if (ptr.y < PICK_CY + PICK_R * 4)
          tips.push({ x: ptr.x, y: ptr.y, color });
        let over = -1;
        let overD = PICK_REACH;
        circles.forEach((c, i) => {
          const d = Math.hypot(ptr.x - c.x, ptr.y - c.y);
          if (d < overD) {
            overD = d;
            over = i;
          }
        });
        if (ptr.needLeave) {
          if (over === -1) ptr.needLeave = false;
          continue;
        }
        if (over !== -1) ptr.overAt = now;
        else if (ptr.idx !== -1 && now - ptr.overAt < PICK_GRACE_MS)
          over = ptr.idx; // brief slip: keep counting
        if (over !== ptr.idx) {
          ptr.idx = over;
          ptr.since = now;
        }
        if (over === -1 || !person || person.style === over) continue;
        const p = (now - ptr.since) / DWELL_MS;
        if (p >= 1) {
          person.style = over;
          person.changedAt = now;
          ptr.needLeave = true;
          ptr.idx = -1;
        } else {
          waiting.push({ color, idx: over, p });
        }
      }

      circles.forEach((c, i) => {
        const style = WING_MODELS[i];
        const hot = waiting.some((wt) => wt.idx === i);
        octx.save();
        octx.shadowColor = "rgba(0,0,0,0.35)";
        octx.shadowBlur = 10;
        octx.shadowOffsetY = 2;
        octx.fillStyle = hot
          ? "rgba(255,255,255,0.95)"
          : "rgba(255,255,255,0.78)";
        octx.beginPath();
        octx.arc(c.x, c.y, PICK_R * (hot ? 1.1 : 1), 0, Math.PI * 2);
        octx.fill();
        octx.restore();
        octx.fillStyle = "#5b6577";
        octx.beginPath();
        octx.arc(c.x, c.y, PICK_R - 3, 0, Math.PI * 2);
        octx.fill();
        const size = PICK_R * 1.7;
        const icon = icons[i];
        if (icon)
          octx.drawImage(icon, c.x - size / 2, c.y - size / 2, size, size);
        const wearers = [...people.values()].filter(
          (p) => p.style === i && now - p.seenAt < FADE_AFTER_MS,
        );
        wearers.forEach((p, j) => {
          octx.fillStyle = p.color;
          octx.strokeStyle = "rgba(0,0,0,0.5)";
          octx.lineWidth = 1;
          octx.beginPath();
          octx.arc(
            c.x - (wearers.length - 1) * 6 + j * 12,
            c.y + PICK_R + 9,
            4.5,
            0,
            Math.PI * 2,
          );
          octx.fill();
          octx.stroke();
        });
        if (hot) {
          octx.font = "600 13px sans-serif";
          octx.textAlign = "center";
          octx.fillStyle = "#fff";
          octx.shadowColor = "rgba(0,0,0,0.7)";
          octx.shadowBlur = 4;
          octx.fillText(style.label, c.x, c.y + PICK_R + 30);
          octx.shadowBlur = 0;
        }
      });
      // Countdown on the circle each finger is holding.
      for (const { color, idx, p } of waiting) {
        const c = circles[idx];
        octx.strokeStyle = color;
        octx.lineWidth = 4;
        octx.lineCap = "round";
        octx.beginPath();
        octx.arc(
          c.x,
          c.y,
          PICK_R + 5,
          -Math.PI / 2,
          -Math.PI / 2 + Math.min(1, p) * Math.PI * 2,
        );
        octx.stroke();
      }
      // Where each finger points (only near the circles).
      for (const t of tips) {
        octx.fillStyle = t.color;
        octx.strokeStyle = "rgba(0,0,0,0.6)";
        octx.lineWidth = 2;
        octx.beginPath();
        octx.arc(t.x, t.y, 8, 0, Math.PI * 2);
        octx.fill();
        octx.stroke();
      }
    };

    // Clicking / tapping a circle gives that wing to everyone in view.
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const now = performance.now();
      pickCircles(rect.width).forEach((c, i) => {
        if (Math.hypot(x - c.x, y - c.y) > PICK_R + 6) return;
        for (const person of people.values()) {
          if (person.style === i) continue;
          person.style = i;
          person.changedAt = now;
        }
      });
    };
    canvas.addEventListener("click", onClick);

    const drawNames = (now: number) => {
      const w = overlay.width;
      const h = overlay.height;
      for (const person of people.values()) {
        const lm = person.lm;
        if (!lm || person.alpha <= 0) continue;
        const age = now - person.changedAt;
        if (age > 1600) continue;
        const a = Math.min(1, (1600 - age) / 400) * person.alpha;
        octx.globalAlpha = a;
        octx.font = "600 18px sans-serif";
        octx.textAlign = "center";
        const label = WING_MODELS[person.style].label;
        const x = lm[0].x * w;
        const y = lm[0].y * h - 80;
        const tw = octx.measureText(label).width + 24;
        octx.fillStyle = "rgba(0,0,0,0.5)";
        octx.beginPath();
        octx.roundRect(x - tw / 2, y - 20, tw, 30, 15);
        octx.fill();
        octx.fillStyle = person.color;
        octx.fillText(label, x, y);
        octx.globalAlpha = 1;
      }
    };

    let lastFrame = 0;
    const loop = (now: number) => {
      if (cancelled) return;
      const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;
      detect(now);
      detectHands(now);
      detectFaces(now);

      syncCanvasToDisplay(canvas);
      const w = canvas.width;
      const h = canvas.height;
      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
      }
      if (glW !== w || glH !== h) {
        glW = w;
        glH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.position.set(
          w / 2,
          -h / 2,
          h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)),
        );
        camera.updateProjectionMatrix();
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      drawVideoCover(ctx, video, vw, vh, w, h);

      // Fade people in/out instead of popping; place and pose their wings.
      for (const [id, person] of people) {
        const away = now - person.seenAt;
        const show =
          away < FADE_AFTER_MS &&
          person.shouldersOk &&
          now - person.bornAt > CONFIRM_MS;
        person.alpha = clamp(
          person.alpha + (show ? FADE_IN_PER_S : -FADE_OUT_PER_S) * dt,
          0,
          1,
        );
        if (away > FORGET_AFTER_MS && person.alpha === 0) {
          if (person.lm) {
            lost.push({
              style: person.style,
              color: person.color,
              back: person.back,
              x: (person.lm[L_SHOULDER].x + person.lm[R_SHOULDER].x) / 2,
              y: (person.lm[L_SHOULDER].y + person.lm[R_SHOULDER].y) / 2,
              at: now,
            });
          }
          dropRig(person);
          people.delete(id);
          continue;
        }
        const ok = person.alpha > 0 && placeRig(person, dt);
        if (person.rig) {
          person.rig.group.visible = ok;
          person.rig.setOpacity(person.alpha);
        }
        // Facing us → their body hides the wings behind it. Back turned →
        // the wings are on our side, so no occluder.
        // Shape-from-pose occluder: only when there is no mask to use.
        const useShape = ok && !person.back && (!haveCutout || NO_CUT);
        if (useShape) updateOccluder(person);
        if (person.occluder) person.occluder.visible = useShape;
      }
      sampleRoom();
      maskOccluder.visible = haveCutout && !NO_CUT && vw > 0;
      if (maskOccluder.visible) {
        placeMaskOccluder(w, h, vw, vh);
        if (maskDirty) {
          maskTex.needsUpdate = true;
          maskDirty = false;
        }
      }
      renderer.render(scene, camera);

      octx.clearRect(0, 0, w, h);
      if (haveCutout && !NO_CUT) {
        // The wings' soft shadow on the people in front of them — that
        // contact is what makes them look attached, not floating.
        octx.save();
        drawVideoCover(octx, maskCanvas, vw, vh, w, h);
        octx.globalCompositeOperation = "source-in";
        octx.globalAlpha = 0.4;
        octx.filter = `brightness(0) blur(${Math.round(w / 90)}px)`;
        octx.drawImage(glCanvas, -sun.position.x * (w / 100), w / 140, w, h);
        octx.restore();
      }
      drawNames(now);
      if (DEBUG) {
        // what is drawn over the wings (white = in front of them)
        const mw = 200;
        const mh = (mw * (maskCanvas.height || 1)) / (maskCanvas.width || 1);
        octx.fillStyle = "#000";
        const mx = w - mw - 8;
        const my = h - mh - 90;
        octx.fillRect(mx, my, mw, mh);
        octx.save();
        octx.translate(mx + mw, my);
        octx.scale(-1, 1);
        if (haveCutout) octx.drawImage(personCanvas, 0, 0, mw, mh);
        octx.restore();
        octx.font = "600 12px monospace";
        octx.textAlign = "left";
        octx.fillStyle = "#fff";
        octx.fillText(
          `mask: ${haveCutout ? cutoutSource : "none"}`,
          mx + 4,
          my + mh + 14,
        );
        octx.font = "600 14px monospace";
        octx.textAlign = "center";
        for (const p of people.values()) {
          if (!p.lm || p.alpha <= 0) continue;
          const t = `${p.back ? "หลัง" : "หน้า"} ${p.facing.toFixed(2)} face:${p.faceScore.toFixed(2)}`;
          octx.fillStyle = "rgba(0,0,0,0.6)";
          const x = p.lm[0].x * w;
          const y = p.lm[0].y * h - 40;
          octx.fillRect(x - 90, y - 16, 180, 22);
          octx.fillStyle = "#fff";
          octx.fillText(t, x, y);
        }
      }
      updatePicker(now);

      raf = requestAnimationFrame(loop);
    };

    const create = async (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(await getSharedFileset(), {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "VIDEO",
        numPoses: MAX_PEOPLE,
        outputSegmentationMasks: true,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    const start = async () => {
      try {
        landmarker = await create("GPU");
      } catch (err) {
        console.warn("GPU delegate ใช้ไม่ได้ ใช้ CPU แทน:", err);
        landmarker = await create("CPU");
      }
      if (cancelled) {
        landmarker.close();
        landmarker = null;
        return;
      }
      // A real face detector tells front from back.
      try {
        segmenter = await ImageSegmenter.createFromOptions(
          await getSharedFileset(),
          {
            baseOptions: { modelAssetPath: SEGMENTER_PATH, delegate: "GPU" },
            runningMode: "VIDEO",
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          },
        );
        if (cancelled) {
          segmenter.close();
          segmenter = null;
        }
      } catch (err) {
        console.warn("โหลดตัวแยกคนไม่ได้ ใช้ mask จาก pose แทน:", err);
      }
      try {
        faces = await FaceLandmarker.createFromOptions(
          await getSharedFileset(),
          {
            baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: MAX_PEOPLE,
            // stricter: hair on the back of a head must not count as a face
            minFaceDetectionConfidence: 0.6,
            minFacePresenceConfidence: 0.6,
          },
        );
        if (cancelled) {
          faces.close();
          faces = null;
        }
      } catch (err) {
        console.warn("โหลดตัวหาใบหน้าไม่ได้ ใช้ท่าทางตัดสินหน้า/หลังแทน:", err);
      }
      // Pointing at the picker needs real fingertips.
      try {
        const d = await createAdaptiveDetector(MAX_HANDS);
        if (cancelled) d.close();
        else hands = d;
      } catch (err) {
        console.warn("โหลดตัวจับมือไม่ได้ ใช้คลิกเลือกปีกแทน:", err);
      }
      if (cancelled) return;
      stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = () => resolve();
      });
      await video.play();
      if (cancelled) return;
      setStatus("tracking...");
      raf = requestAnimationFrame(loop);
    };

    start().catch((err: Error) => {
      if (!cancelled) setStatus(`❌ Error: ${err.message}`);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("click", onClick);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      landmarker?.close();
      landmarker = null;
      hands?.close();
      faces?.close();
      segmenter?.close();
      segmenter = null;
      faces = null;
      hands = null;
      for (const p of people.values()) dropRig(p);
      envMap.dispose();
      occluderMat.dispose();
      maskTex.dispose();
      maskOccluder.geometry.dispose();
      (maskOccluder.material as THREE.Material).dispose();
      renderer.dispose();
      glCanvas.remove();
      overlay.remove();
    };
  }, [videoRef, canvasRef]);

  return { status, peopleCount };
}
