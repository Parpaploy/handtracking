import * as THREE from "three";
import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

/* ------------------------------------------------------------------ */
/* MediaPipe landmark indices                                          */
/* ------------------------------------------------------------------ */

/** Pose model, 33 points. */
export const POSE_IDX = {
  LeftShoulder: 11,
  RightShoulder: 12,
  LeftElbow: 13,
  RightElbow: 14,
  LeftWrist: 15,
  RightWrist: 16,
  LeftHip: 23,
  RightHip: 24,
} as const;

/** Hand model, 21 points: wrist plus four joints per finger, base to tip. */
export const HAND_IDX = {
  Wrist: 0,
  Thumb: [1, 2, 3, 4],
  Index: [5, 6, 7, 8],
  Middle: [9, 10, 11, 12],
  Ring: [13, 14, 15, 16],
  Pinky: [17, 18, 19, 20],
} as const;

export type Side = "Left" | "Right";
export type Finger = "Thumb" | "Index" | "Middle" | "Ring" | "Pinky";
export type Segment = "1" | "2" | "3";

const SIDES: Side[] = ["Left", "Right"];
const FINGERS: Finger[] = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
const SEGMENTS: Segment[] = ["1", "2", "3"];

export type BoneKey =
  | `${Side}UpperArm`
  | `${Side}LowerArm`
  | `${Side}Hand`
  | `${Side}${Finger}${Segment}`;

function opposite(side: Side): Side {
  return side === "Left" ? "Right" : "Left";
}

/* ------------------------------------------------------------------ */
/* Bone resolution                                                     */
/*                                                                     */
/* three.js strips [ ] . : / from glTF node names (see                 */
/* PropertyBinding.sanitizeNodeName), so the Rigify bone               */
/* "DEF-upper_arm.L" reaches us as "DEF-upper_armL" and                */
/* "DEF-f_index.01.L" as "DEF-f_index01L". Any pattern that assumes a  */
/* separator before the side suffix will silently match nothing —      */
/* that is exactly why the old auto-detect found zero bones.           */
/*                                                                     */
/* We also must bind to DEF- bones specifically: glTF has no bone      */
/* constraints, so Rigify's FK/IK/tweak controls are inert after       */
/* export. The mesh is skinned to the DEF- chain, so only those move   */
/* anything visible. ORG- palm bones sit between the hand and the      */
/* fingers; we never drive them, we just inherit through them.         */
/* ------------------------------------------------------------------ */

/**
 * Bones that must never be picked up by the arm/finger patterns. PHYS is in
 * here because this rig carries 167 skinned physics bones (hair, skirt, cape,
 * hat) that spring-bones.ts owns — nothing in the retarget may touch them.
 */
const CONTROL_RE =
  /^(MCH|ORG|VIS|WGT)[-_]|PHYS|_(fk|ik|tweak|master|drv|parent|widget|pole|target|swing)/i;

/** Rigify spells fingers "f_index"; thumb has no prefix. */
const FINGER_CORE: Record<Finger, string> = {
  Thumb: "thumb",
  Index: "index",
  Middle: "middle",
  Ring: "ring",
  Pinky: "(pinky|little)",
};

function armCandidates(side: Side, part: "upper" | "lower" | "hand"): RegExp[] {
  const s = side === "Left" ? "l" : "r";
  const long = side.toLowerCase();

  if (part === "upper") {
    return [
      new RegExp(`^DEF[-_]upper[_-]?arm[._]?${s}\\d*$`, "i"),
      new RegExp(`^upper[_-]?arm[._]?${s}\\d*$`, "i"),
      new RegExp(`upper[_-]?arm[._]?${s}\\d*$`, "i"),
      new RegExp(`^(mixamorig)?${long}(upper)?arm$`, "i"),
      new RegExp(`^${long}[_-]?(upper[_-]?)?arm`, "i"),
    ];
  }
  if (part === "lower") {
    return [
      new RegExp(`^DEF[-_](fore|lower)[_-]?arm[._]?${s}\\d*$`, "i"),
      new RegExp(`^(fore|lower)[_-]?arm[._]?${s}\\d*$`, "i"),
      new RegExp(`(fore|lower)[_-]?arm[._]?${s}\\d*$`, "i"),
      new RegExp(`^(mixamorig)?${long}forearm$`, "i"),
      new RegExp(`^${long}[_-]?(fore|lower)[_-]?arm`, "i"),
    ];
  }
  return [
    new RegExp(`^DEF[-_]hand[._]?${s}\\d*$`, "i"),
    new RegExp(`^hand[._]?${s}\\d*$`, "i"),
    new RegExp(`hand[._]?${s}\\d*$`, "i"),
    new RegExp(`^(mixamorig)?${long}hand$`, "i"),
  ];
}

/**
 * Unity Humanoid / VRM spell finger joints as words, not numbers:
 * "IndexProximal", "IndexIntermediate", "IndexDistal" (thumb the same,
 * no separate "metacarpal" bone). Side is appended directly, no separator
 * ("IndexProximalL"), matching how VRoid/Ryumii-style exports come out.
 */
const SEGMENT_WORD: Record<Segment, string> = {
  "1": "Proximal",
  "2": "Intermediate",
  "3": "Distal",
};

function fingerCandidates(side: Side, finger: Finger, seg: Segment): RegExp[] {
  const s = side === "Left" ? "l" : "r";
  const long = side.toLowerCase();
  const core = FINGER_CORE[finger];
  const rigify = `(f[_-]?)?${core}[._]?0?${seg}`;

  return [
    new RegExp(`^DEF[-_]${rigify}[._]?${s}\\d*$`, "i"),
    new RegExp(`^${rigify}[._]?${s}\\d*$`, "i"),
    new RegExp(`${rigify}[._]?${s}\\d*$`, "i"),
    new RegExp(`^(mixamorig)?${long}hand${core}${seg}$`, "i"),
    new RegExp(`^${core}[_-]0?${seg}[_-]${s}$`, "i"),
    // Unity Humanoid / VRM: IndexProximalL, ThumbDistalR, ...
    new RegExp(`^${core}${SEGMENT_WORD[seg]}${s}$`, "i"),
  ];
}

const BONE_CANDIDATES = new Map<BoneKey, RegExp[]>();
for (const side of SIDES) {
  BONE_CANDIDATES.set(`${side}UpperArm`, armCandidates(side, "upper"));
  BONE_CANDIDATES.set(`${side}LowerArm`, armCandidates(side, "lower"));
  BONE_CANDIDATES.set(`${side}Hand`, armCandidates(side, "hand"));
  for (const finger of FINGERS) {
    for (const seg of SEGMENTS) {
      BONE_CANDIDATES.set(
        `${side}${finger}${seg}`,
        fingerCandidates(side, finger, seg),
      );
    }
  }
}

/** The wrist must not swallow a finger bone. */
const FINGER_RE = /thumb|index|middle|ring|pinky|little|finger/i;

export function resolveRigBones(
  root: THREE.Object3D,
): Map<BoneKey, THREE.Object3D> {
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name && !CONTROL_RE.test(o.name)) nodes.push(o);
  });

  const found = new Map<BoneKey, THREE.Object3D>();
  const used = new Set<THREE.Object3D>();

  for (const [key, patterns] of BONE_CANDIDATES) {
    const isWrist = key.endsWith("Hand");
    for (const pattern of patterns) {
      const hits = nodes.filter(
        (n) =>
          !used.has(n) &&
          pattern.test(n.name) &&
          (!isWrist || !FINGER_RE.test(n.name)),
      );
      if (hits.length === 0) continue;
      // Shortest wins, which picks the base bone over its twist segments
      // (DEF-upper_armL over DEF-upper_armL001).
      const best = hits.sort((a, b) => a.name.length - b.name.length)[0];
      found.set(key, best);
      used.add(best);
      break;
    }
  }

  return found;
}

/* ------------------------------------------------------------------ */
/* Rig binding — rest pose captured once, in model space               */
/* ------------------------------------------------------------------ */

/**
 * The bone each driven bone points at in the bind pose. Distal phalanges
 * (segment 3) are leaves, so they fall through to the axis-inheritance path
 * in bindRig.
 */
const AIM_TARGET = new Map<BoneKey, BoneKey>();
for (const side of SIDES) {
  AIM_TARGET.set(`${side}UpperArm`, `${side}LowerArm`);
  AIM_TARGET.set(`${side}LowerArm`, `${side}Hand`);
  for (const finger of FINGERS) {
    AIM_TARGET.set(`${side}${finger}1`, `${side}${finger}2`);
    AIM_TARGET.set(`${side}${finger}2`, `${side}${finger}3`);
  }
}

/** Bone whose local aim axis a leaf bone borrows. */
const AXIS_DONOR = new Map<BoneKey, BoneKey>();
for (const side of SIDES) {
  for (const finger of FINGERS) {
    AXIS_DONOR.set(`${side}${finger}3`, `${side}${finger}2`);
  }
}

interface RestInfo {
  bone: THREE.Object3D;
  /** Rest direction from this bone toward its aim target, in model space. */
  restDir: THREE.Vector3;
  /** Rest orientation of this bone, in model space. */
  restQuat: THREE.Quaternion;
  /** Bone's own local rotation at bind time — what we relax back to. */
  restLocal: THREE.Quaternion;
}

export interface RigBinding {
  root: THREE.Object3D;
  bones: Map<BoneKey, THREE.Object3D>;
  rest: Map<BoneKey, RestInfo>;
  /**
   * Where a bone should point when there is nothing to track, in model space.
   * The bind pose of this rig is a T-pose, which is a terrible thing to fall
   * back to — an arm whose elbow drops below the visibility threshold would
   * snap straight out sideways. These aim the arms down at the sides instead.
   */
  restAim: Map<BoneKey, THREE.Vector3>;
  /**
   * Per-bone roll reference, in model space: the direction the bone's own
   * "bend axis" points to in the bind pose. Pairing this with a measured
   * bend axis per frame is what pins the roll — see aimWithRoll.
   */
  restRoll: Map<BoneKey, THREE.Vector3>;
  /** Model-space axis pointing toward the avatar's left, measured from the rig. */
  lateral: THREE.Vector3;
  /** Model-space axis pointing out of the avatar's chest. */
  forward: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _posChild = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/** Position+orientation of `obj` relative to the root `_rootInv` was built from. */
function modelSpace(
  obj: THREE.Object3D,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
) {
  _m.multiplyMatrices(_rootInv, obj.matrixWorld);
  _m.decompose(outPos, outQuat, _scale);
}

/**
 * Capture the bind pose. Must run before anything has posed the skeleton,
 * i.e. straight after the GLTF loads.
 */
export function bindRig(root: THREE.Object3D): RigBinding {
  const bones = resolveRigBones(root);
  const rest = new Map<BoneKey, RestInfo>();

  root.updateMatrixWorld(true);
  _rootInv.copy(root.matrixWorld).invert();

  /** Local-space aim axis of a bone, i.e. restQuat⁻¹ * restDir. */
  const localAxis = new Map<BoneKey, THREE.Vector3>();

  const build = (key: BoneKey): RestInfo | null => {
    const bone = bones.get(key);
    if (!bone) return null;

    const restQuat = new THREE.Quaternion();
    modelSpace(bone, _pos, restQuat);

    // Prefer the next joint in the chain, then the first child, so a rig with
    // an unresolved wrist still yields a usable forearm axis.
    const aimKey = AIM_TARGET.get(key);
    const aim = (aimKey ? bones.get(aimKey) : undefined) ?? bone.children[0];

    let restDir: THREE.Vector3 | null = null;

    if (aim) {
      modelSpace(aim, _posChild, _quat);
      const d = _posChild.clone().sub(_pos);
      if (d.lengthSq() > 1e-12) restDir = d.normalize();
    }

    if (!restDir) {
      // Leaf bone (fingertip phalanx): it has no child to aim at, so borrow
      // the bone-local aim axis from its parent segment and re-express it
      // through this bone's own rest orientation. Exact whenever the exporter
      // keeps one bone axis convention, which Blender does.
      const donor = AXIS_DONOR.get(key);
      const axis = donor ? localAxis.get(donor) : undefined;
      if (!axis) return null;
      restDir = axis.clone().applyQuaternion(restQuat).normalize();
    }

    localAxis.set(
      key,
      restDir.clone().applyQuaternion(restQuat.clone().invert()).normalize(),
    );

    return {
      bone,
      restDir,
      restQuat,
      restLocal: bone.quaternion.clone(),
    };
  };

  // Parents first so AXIS_DONOR lookups are already populated.
  const order: BoneKey[] = [];
  for (const side of SIDES) {
    order.push(`${side}UpperArm`, `${side}LowerArm`, `${side}Hand`);
  }
  for (const seg of SEGMENTS) {
    for (const side of SIDES) {
      for (const finger of FINGERS) order.push(`${side}${finger}${seg}`);
    }
  }

  for (const key of order) {
    const info = build(key);
    if (info) rest.set(key, info);
  }

  const aim = buildRestAim(rest);
  return {
    root,
    bones,
    rest,
    ...aim,
    restRoll: buildRestRoll(rest, aim.forward),
  };
}

/**
 * The bind-pose bend axis of every bone we roll-stabilise.
 *
 * For an arm in a T-pose the elbow bends *forward*, so the hinge axis is
 * perpendicular to both the bone and the chest normal — that is exactly
 * `restDir x forward`. The sign works out on its own for both sides, because
 * restDir already points the opposite way on the right arm.
 */
function buildRestRoll(
  rest: Map<BoneKey, RestInfo>,
  forward: THREE.Vector3,
): Map<BoneKey, THREE.Vector3> {
  const restRoll = new Map<BoneKey, THREE.Vector3>();

  for (const side of SIDES) {
    for (const part of ["UpperArm", "LowerArm", "Hand"] as const) {
      const info = rest.get(`${side}${part}`);
      if (!info) continue;
      const roll = new THREE.Vector3().crossVectors(info.restDir, forward);
      // Degenerate only if the bone lies along the chest normal, which no arm
      // bone in a T-pose does. Skipping is correct: no roll reference means
      // aimWithRoll falls back to the old swing-only behaviour for that bone.
      if (roll.lengthSq() < 1e-10) continue;
      restRoll.set(`${side}${part}`, roll.normalize());
    }
  }

  return restRoll;
}

/**
 * Natural "arms hanging at the sides" pose, plus the body axes the idle sway
 * needs. All in model space.
 *
 * The lateral axis is measured from the rig itself — the vector from the right
 * upper arm to the left one — rather than assumed to be +X, so this holds for
 * any humanoid orientation. Down is -Y, which glTF guarantees.
 */
function buildRestAim(rest: Map<BoneKey, RestInfo>): {
  restAim: Map<BoneKey, THREE.Vector3>;
  lateral: THREE.Vector3;
  forward: THREE.Vector3;
} {
  const restAim = new Map<BoneKey, THREE.Vector3>();
  const lateral = new THREE.Vector3(1, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);

  const left = rest.get("LeftUpperArm");
  const right = rest.get("RightUpperArm");
  if (!left || !right) return { restAim, lateral, forward };

  const measured = new THREE.Vector3();
  modelSpace(left.bone, measured, _quat);
  modelSpace(right.bone, _pos, _quat);
  measured.sub(_pos);
  if (measured.lengthSq() < 1e-10) return { restAim, lateral, forward };
  lateral.copy(measured).normalize();

  const down = new THREE.Vector3(0, -1, 0);

  // Third axis from the other two. Sign is resolved against +Z rather than
  // assumed, so "forward" really is out of the chest for this rig.
  forward.crossVectors(lateral, down).normalize();
  if (forward.z < 0) forward.negate();

  for (const side of SIDES) {
    const sign = side === "Left" ? 1 : -1;
    // Upper arm hangs down, tucked out a little so it clears the ribcage.
    restAim.set(
      `${side}UpperArm`,
      down
        .clone()
        .addScaledVector(lateral, 0.18 * sign)
        .normalize(),
    );
    // Forearm slightly less splayed, which reads as relaxed rather than rigid.
    restAim.set(
      `${side}LowerArm`,
      down
        .clone()
        .addScaledVector(lateral, 0.08 * sign)
        .normalize(),
    );
  }

  return { restAim, lateral, forward };
}

/* ------------------------------------------------------------------ */
/* Procedural idle                                                     */
/*                                                                     */
/* Only ever perturbs the *rest* direction, so a tracked limb is never  */
/* touched — the sway appears exactly where tracking has nothing to say */
/* and disappears the moment it does. Two slow waves per arm at         */
/* different rates, phase-offset per side, with the forearm lagging     */
/* the upper arm so the limb reads as a pendulum rather than a hinge.   */
/* ------------------------------------------------------------------ */

const IDLE_SWAY_HZ = 0.15;
const IDLE_BOB_HZ = 0.09;
const IDLE_SWAY_AMP = 0.055;
const IDLE_BOB_AMP = 0.045;
const IDLE_FOREARM_LAG = 0.35;

function applyIdleSway(
  binding: RigBinding,
  key: BoneKey,
  base: THREE.Vector3,
  time: number,
  amount: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.copy(base);
  if (amount <= 0) return out;

  const isLeft = key.startsWith("Left");
  const isForearm = key.endsWith("LowerArm");

  // Desync the two arms so they never look mechanically synchronised.
  const phase = isLeft ? 0 : 1.9;
  const lag = isForearm ? IDLE_FOREARM_LAG : 0;
  const w = 2 * Math.PI;

  const sway = Math.sin((time - lag) * w * IDLE_SWAY_HZ + phase);
  const bob = Math.sin((time - lag) * w * IDLE_BOB_HZ + phase * 1.3);

  // The forearm swings a little wider than the upper arm, as a real arm does.
  const gain = isForearm ? 1.35 : 1;
  const sign = isLeft ? 1 : -1;

  out
    .addScaledVector(
      binding.lateral,
      sway * IDLE_SWAY_AMP * amount * gain * sign,
    )
    .addScaledVector(binding.forward, bob * IDLE_BOB_AMP * amount * gain)
    .normalize();

  return out;
}

/* ------------------------------------------------------------------ */
/* Per-frame solve                                                     */
/*                                                                     */
/* Swing-only "aim the bone at the next joint" retarget. We never copy  */
/* raw rotations across rigs — MediaPipe and Rigify have unrelated rest */
/* orientations, and copying local quaternions between them is what     */
/* turns a retarget into spaghetti. Instead we take the *direction*     */
/* each bone should point and rotate its own rest direction onto it.    */
/* Rig-agnostic; twist about the bone's own axis is not captured.       */
/* ------------------------------------------------------------------ */

export interface PoseSolveOptions {
  /** Negate X so the avatar behaves like a mirror. */
  mirror: boolean;
  /** Drive the avatar's Left bones from the user's right side, and vice versa. */
  swapSides: boolean;
  /**
   * MediaPipe labels handedness assuming a mirrored (selfie) image. We feed it
   * unmirrored frames, so its "Left" is really the user's right hand and the
   * label needs inverting. Same convention the 2D hand games in this repo use.
   */
  swapHandedness: boolean;
  /**
   * How fast a bone converges on its target, in units of 1/second.
   *
   * This used to be a raw per-frame slerp factor, which made the whole rig
   * behave differently at 30 fps than at 90 — and this page runs three
   * MediaPipe models on one video, so the frame rate is anything but steady.
   * It is now a time constant: t = 1 - exp(-responsiveness * dt).
   */
  responsiveness: number;
  /**
   * Scales the depth component of every tracked direction, 0..1.
   *
   * A single webcam cannot actually see depth; MediaPipe infers it, and that
   * inference is by far the noisiest channel it emits. Damping it trades a
   * little forward reach for a lot less wobble.
   */
  zDamp: number;
  /**
   * Pin each arm bone's roll to the plane the arm is actually bending in,
   * instead of letting the aim solver invent one. Off restores the old
   * swing-only behaviour.
   */
  rollStabilize: boolean;
  /**
   * Flip the palm-normal roll reference for the wrists. Which sign is correct
   * depends on how the rig's bind pose holds its palms, and this rig is not
   * self-describing about it — same toggle-and-look deal as mirror/swapSides.
   */
  flipPalm: boolean;
  /** Landmarks below this visibility are ignored and the limb relaxes. */
  minVisibility: number;
  /**
   * Relax untracked arms to a natural arms-down pose instead of the rig's bind
   * pose. Off means an arm whose elbow goes out of frame snaps to a T-pose.
   */
  naturalRest: boolean;
  /** Gently sway arms that have nothing to track, so they are not dead still. */
  idleMotion: boolean;
  /** Scales the idle sway. 1 is the tuned default; 0 is the same as off. */
  idleAmount: number;
}

export const DEFAULT_POSE_OPTIONS: PoseSolveOptions = {
  mirror: true,
  swapSides: true,
  swapHandedness: true,
  responsiveness: 25,
  zDamp: 0.8,
  rollStabilize: true,
  flipPalm: false,
  minVisibility: 0.5,
  naturalRest: true,
  idleMotion: true,
  idleAmount: 1,
};

export interface PoseFrame {
  world: Landmark[];
  view: NormalizedLandmark[];
}

export interface HandFrame {
  world: Landmark[];
  /** Handedness as MediaPipe reported it, before swapHandedness is applied. */
  label: Side;
}

const _target = new THREE.Quaternion();
const _delta = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
const _parentQuat = new THREE.Quaternion();
const _rootQuatInv = new THREE.Quaternion();
const _dirA = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();
const _rollA = new THREE.Vector3();
const _rollB = new THREE.Vector3();
const _rollTarget = new THREE.Vector3();
const _bendAxis = new THREE.Vector3();
const _palmA = new THREE.Vector3();
const _palmB = new THREE.Vector3();
const _palmNormal = new THREE.Vector3();

/**
 * Frame-rate independent slerp factor. See PoseSolveOptions.responsiveness.
 */
function convergence(responsiveness: number, dt: number): number {
  return THREE.MathUtils.clamp(
    1 - Math.exp(-Math.max(responsiveness, 0.01) * dt),
    0.01,
    1,
  );
}

/**
 * Aim `restDir` onto `dir`, then roll about `dir` so `restRoll` lands on
 * `targetRoll`.
 *
 * setFromUnitVectors on its own gives the *minimal* rotation between two
 * directions, which leaves rotation about the bone's own axis completely
 * undetermined — three.js has to invent a perpendicular, and near the
 * 180-degree case that invented axis swings wildly from frame to frame. That
 * is the spinning. It is also why the elbow crease and the palm ended up
 * facing arbitrary directions: the bone was pointing the right way the whole
 * time, the roll around it was noise.
 *
 * Fixing it needs a second reference direction. For the arms that is the
 * plane the arm is bending in — shoulder, elbow and wrist define it, and its
 * normal is the elbow's hinge axis by construction.
 */
function aimWithRoll(
  restDir: THREE.Vector3,
  dir: THREE.Vector3,
  restRoll: THREE.Vector3 | undefined,
  targetRoll: THREE.Vector3 | null,
  out: THREE.Quaternion,
): THREE.Quaternion {
  out.setFromUnitVectors(restDir, dir);
  if (!restRoll || !targetRoll) return out;

  // Both references, flattened into the plane perpendicular to the bone —
  // only their angle about the bone matters, and either one may be tilted.
  _rollA.copy(restRoll).applyQuaternion(out);
  _rollA.addScaledVector(dir, -_rollA.dot(dir));
  _rollB.copy(targetRoll);
  _rollB.addScaledVector(dir, -_rollB.dot(dir));

  // Degenerate when a reference is parallel to the bone, i.e. a perfectly
  // straight arm has no bend plane. Leaving the swing alone is right: with no
  // measurable roll, the previous frame's is the best guess available.
  if (_rollA.lengthSq() < 1e-8 || _rollB.lengthSq() < 1e-8) return out;

  _twist.setFromUnitVectors(_rollA.normalize(), _rollB.normalize());
  return out.premultiply(_twist);
}

/**
 * MediaPipe world landmarks are metres with +x image-right, +y down, +z away
 * from the camera. three.js is +y up, +z toward the viewer — hence the
 * negations. Mirroring flips x on top of that; combined with swapSides it
 * produces true mirror behaviour on a symmetric rig.
 */
function toThreeDir(
  from: Landmark,
  to: Landmark,
  opts: PoseSolveOptions,
  out: THREE.Vector3,
): THREE.Vector3 {
  const sx = opts.mirror ? -1 : 1;
  return out
    .set(sx * (to.x - from.x), -(to.y - from.y), -(to.z - from.z) * opts.zDamp)
    .normalize();
}

function visibilityOf(frame: PoseFrame, idx: number): number {
  const v = frame.view[idx]?.visibility;
  if (typeof v === "number" && v > 0) return v;
  const w = frame.world[idx]?.visibility;
  return typeof w === "number" ? w : 1;
}

/**
 * Point one bone along `dir` and refresh its subtree so children solved
 * afterwards see a current parent matrix.
 *
 * `dir` is a camera-space direction. Pass `null` to relax the bone: it aims at
 * its natural rest direction if it has one and `naturalRest` is on, otherwise
 * it falls back to the rig's bind rotation.
 */
function solveBone(
  binding: RigBinding,
  key: BoneKey,
  dir: THREE.Vector3 | null,
  opts: PoseSolveOptions,
  t: number,
  time: number,
  /**
   * Measured bend axis for this bone, in camera space, or null to leave the
   * roll unconstrained. Ignored while the bone is relaxing — a rest pose has
   * no measured plane, and its own bind roll is the right answer there.
   */
  roll: THREE.Vector3 | null = null,
): void {
  const info = binding.rest.get(key);
  if (!info) return;

  const tracked = dir !== null && dir.lengthSq() >= 1e-8;
  const restDir = opts.naturalRest ? binding.restAim.get(key) : undefined;

  if (!tracked && !restDir) {
    info.bone.quaternion.slerp(info.restLocal, t);
    info.bone.updateMatrixWorld(true);
    return;
  }

  let rollTarget: THREE.Vector3 | null = null;

  if (tracked) {
    // Camera-space target -> model space, so a rotated avatar still tracks
    // relative to the camera rather than to its own body.
    _dirA.copy(dir!).applyQuaternion(_rootQuatInv).normalize();
    if (opts.rollStabilize && roll) {
      rollTarget = _rollTarget.copy(roll).applyQuaternion(_rootQuatInv);
      if (rollTarget.lengthSq() < 1e-10) rollTarget = null;
      else rollTarget.normalize();
    }
  } else if (opts.idleMotion) {
    // Rest directions are authored in model space already.
    applyIdleSway(binding, key, restDir!, time, opts.idleAmount, _dirA);
  } else {
    _dirA.copy(restDir!).normalize();
  }

  aimWithRoll(
    info.restDir,
    _dirA,
    binding.restRoll.get(key),
    rollTarget,
    _delta,
  );
  _target.copy(_delta).multiply(info.restQuat);

  const parent = info.bone.parent;
  if (parent) {
    parent.matrixWorld.decompose(_tmpPos, _parentQuat, _scale);
    _parentQuat.premultiply(_rootQuatInv).invert();
    _target.premultiply(_parentQuat);
  }

  info.bone.quaternion.slerp(_target, t);
  info.bone.updateMatrixWorld(true);
}

/** Refresh `_rootQuatInv` and the whole rig's world matrices. Call once a frame. */
function beginSolve(binding: RigBinding): void {
  binding.root.updateMatrixWorld(true);
  binding.root.getWorldQuaternion(_rootQuatInv).invert();
}

/**
 * Pose the arms from one PoseLandmarker frame. Pass `null` to relax them.
 * Always call this before applyHandsToRig — fingers hang off the wrist.
 */
export function applyPoseToRig(
  binding: RigBinding,
  frame: PoseFrame | null,
  opts: PoseSolveOptions,
  time: number,
  dt: number,
): void {
  if (binding.rest.size === 0) return;
  const t = convergence(opts.responsiveness, dt);

  beginSolve(binding);

  for (const avatarSide of SIDES) {
    if (!frame) {
      solveBone(binding, `${avatarSide}UpperArm`, null, opts, t, time);
      solveBone(binding, `${avatarSide}LowerArm`, null, opts, t, time);
      continue;
    }

    const userSide = opts.swapSides ? opposite(avatarSide) : avatarSide;
    const si = POSE_IDX[`${userSide}Shoulder`];
    const ei = POSE_IDX[`${userSide}Elbow`];
    const wi = POSE_IDX[`${userSide}Wrist`];

    const shoulder: Landmark | undefined = frame.world[si];
    const elbow: Landmark | undefined = frame.world[ei];
    const wrist: Landmark | undefined = frame.world[wi];

    let upperDir: THREE.Vector3 | null = null;
    let lowerDir: THREE.Vector3 | null = null;

    if (
      shoulder &&
      elbow &&
      visibilityOf(frame, si) >= opts.minVisibility &&
      visibilityOf(frame, ei) >= opts.minVisibility
    ) {
      upperDir = toThreeDir(shoulder, elbow, opts, new THREE.Vector3());

      if (wrist && visibilityOf(frame, wi) >= opts.minVisibility) {
        lowerDir = toThreeDir(elbow, wrist, opts, new THREE.Vector3());
      }
    }

    // The elbow's hinge axis: normal of the plane through shoulder, elbow and
    // wrist. Both bones get the same one, which is what keeps the upper arm
    // and forearm from twisting independently of each other. A dead-straight
    // arm makes this vanish, and aimWithRoll correctly ignores it there.
    let bend: THREE.Vector3 | null = null;
    if (upperDir && lowerDir) {
      _bendAxis.crossVectors(upperDir, lowerDir);
      if (_bendAxis.lengthSq() > 1e-6) bend = _bendAxis.normalize();
    }

    solveBone(binding, `${avatarSide}UpperArm`, upperDir, opts, t, time, bend);
    solveBone(binding, `${avatarSide}LowerArm`, lowerDir, opts, t, time, bend);
  }
}

/**
 * Pose the wrists and fingers from HandLandmarker output. Hands not present in
 * `frames` relax back toward the bind pose.
 */
export function applyHandsToRig(
  binding: RigBinding,
  frames: HandFrame[] | null,
  opts: PoseSolveOptions,
  time: number,
  dt: number,
): void {
  if (binding.rest.size === 0) return;
  const t = convergence(opts.responsiveness, dt);

  beginSolve(binding);

  // Route each detected hand to an avatar side.
  const bySide = new Map<Side, HandFrame>();
  for (const frame of frames ?? []) {
    const userSide = opts.swapHandedness ? opposite(frame.label) : frame.label;
    const avatarSide = opts.swapSides ? opposite(userSide) : userSide;
    bySide.set(avatarSide, frame);
  }

  const _dir = new THREE.Vector3();

  for (const avatarSide of SIDES) {
    const frame = bySide.get(avatarSide);

    if (!frame) {
      solveBone(binding, `${avatarSide}Hand`, null, opts, t, time);
      for (const finger of FINGERS) {
        for (const seg of SEGMENTS) {
          solveBone(
            binding,
            `${avatarSide}${finger}${seg}`,
            null,
            opts,
            t,
            time,
          );
        }
      }
      continue;
    }

    const lm = frame.world;

    // The wrist bone's first child is the index metacarpal (ORG-palm.01),
    // so aim it wrist -> index MCP to match its rest direction.
    const wrist = lm[HAND_IDX.Wrist];
    const indexMcp = lm[HAND_IDX.Index[0]];
    const pinkyMcp = lm[HAND_IDX.Pinky[0]];

    // Palm normal, from the triangle the wrist and the two outer knuckles
    // make. Without it the wrist keeps its direction but rolls freely, which
    // is what made an otherwise correct hand read as broken.
    let palm: THREE.Vector3 | null = null;
    if (wrist && indexMcp && pinkyMcp) {
      toThreeDir(wrist, indexMcp, opts, _palmA);
      toThreeDir(wrist, pinkyMcp, opts, _palmB);
      _palmNormal.crossVectors(_palmA, _palmB);
      if (_palmNormal.lengthSq() > 1e-8) {
        palm = _palmNormal.normalize();
        if (opts.flipPalm) palm.negate();
      }
    }

    solveBone(
      binding,
      `${avatarSide}Hand`,
      wrist && indexMcp
        ? toThreeDir(wrist, indexMcp, opts, new THREE.Vector3())
        : null,
      opts,
      t,
      time,
      palm,
    );

    for (const finger of FINGERS) {
      const joints = HAND_IDX[finger];
      for (let s = 0; s < SEGMENTS.length; s++) {
        const from = lm[joints[s]];
        const to = lm[joints[s + 1]];
        // Fingers stay swing-only on purpose: a phalanx is short enough that
        // its own roll is invisible, and it now inherits a wrist whose roll
        // is pinned, which was the actual source of the mess.
        solveBone(
          binding,
          `${avatarSide}${finger}${SEGMENTS[s]}`,
          from && to ? toThreeDir(from, to, opts, _dir) : null,
          opts,
          t,
          time,
        );
      }
    }
  }
}
