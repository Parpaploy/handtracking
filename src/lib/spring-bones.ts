import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* Spring bones for the PHYS chains baked into MEGUMIN RIG             */
/*                                                                     */
/* The rig ships 167 skinned bones whose names start with PHYS: hair,  */
/* bangs, skirt, cape, hat. In Blender those were driven by a cloth or */
/* jiggle sim. glTF has no concept of either, so after export they are */
/* inert — they inherit the head and spine rigidly and the hair moves  */
/* like a helmet. This module gives them back their motion.            */
/*                                                                     */
/* The algorithm is the standard VRM spring bone: track each joint's   */
/* tail as a free point, pull it toward where the bind pose says it    */
/* should be, let inertia and gravity drag it around, then re-aim the  */
/* bone at wherever the point ended up. Motion falls out for free —    */
/* when the head turns, the tail lags, which is exactly "hair sways    */
/* with the motion".                                                   */
/*                                                                     */
/* Everything is computed in the model space of the glTF root, so the  */
/* leva scale/rotation on the wrapping group cannot affect the physics.*/
/* ------------------------------------------------------------------ */

/**
 * Every physics bone in this rig has PHYS in its name, on both the DEF-
 * prefixed chains (hair, bangs, skirt, hat) and the bare ones (PHYS.Cape.*).
 * "CAPE CONTROL IK .L" deliberately does not match: it is an IK control whose
 * constraint glTF threw away, so it drives nothing.
 */
const PHYS_RE = /PHYS/i;

export type SpringGroup = "hair" | "skirt" | "cape" | "hat";

export const SPRING_GROUPS: SpringGroup[] = ["hair", "skirt", "cape", "hat"];

/** Bangs and the middle bang are hair; "Hatrim" falls through to hat. */
function groupOf(name: string): SpringGroup | null {
  if (/hair|bang/i.test(name)) return "hair";
  if (/skirt/i.test(name)) return "skirt";
  if (/cape/i.test(name)) return "cape";
  if (/hat/i.test(name)) return "hat";
  return null;
}

export interface SpringParams {
  /** How hard a joint is pulled back to its bind direction, per second. */
  stiffness: number;
  /** Downward pull, in the same units as stiffness. */
  gravity: number;
  /** Fraction of velocity lost per step. 0 = never settles, 1 = dead. */
  drag: number;
  /** Ambient breeze, so idle hair is not perfectly still. */
  wind: number;
  /** Tail thickness used for collision, as a fraction of the torso length. */
  radius: number;
  /**
   * Largest angle, in degrees, a joint may swing away from its bind direction.
   * Without a cap, a hard head turn or a single dropped tracking frame folds a
   * strand past 90 degrees and it comes to rest *inside* the skull, where no
   * collider can ever push it back out — the chain looks permanently broken
   * until the page reloads. Generous by design: this catches inversion, it is
   * not meant to be felt during normal motion.
   */
  maxBend: number;
}

/**
 * Per-group character. The leva panel multiplies these rather than replacing
 * them, so a skirt stays heavier than hair at every setting.
 */
export const GROUP_DEFAULTS: Record<SpringGroup, SpringParams> = {
  hair: { stiffness: 10, gravity: 5, drag: 0.32, wind: 1.1, radius: 0.03, maxBend: 85 },
  skirt: { stiffness: 16, gravity: 8, drag: 0.45, wind: 0.5, radius: 0.035, maxBend: 70 },
  cape: { stiffness: 7, gravity: 5, drag: 0.36, wind: 1.6, radius: 0.04, maxBend: 85 },
  hat: { stiffness: 26, gravity: 2, drag: 0.6, wind: 0.3, radius: 0.03, maxBend: 30 },
};

/**
 * Capsules the chains are not allowed to pass through, described by the bone
 * they hang off. Radii are fractions of the torso length so they survive any
 * export scale. A skirt with no leg colliders reads as legs poking through
 * fabric on every step, which is worse than no physics at all.
 */
interface ColliderSpec {
  /** Sanitized name of the bone the capsule starts at. */
  from: string;
  /** Sanitized name of the bone it ends at; same as `from` means a sphere. */
  to: string;
  radius: number;
  groups: SpringGroup[];
}

const COLLIDER_SPECS: ColliderSpec[] = [
  { from: "DEF-spine", to: "DEF-spine003", radius: 0.17, groups: ["skirt", "cape"] },
  { from: "DEF-thighL", to: "DEF-shinL", radius: 0.115, groups: ["skirt", "cape"] },
  { from: "DEF-thighR", to: "DEF-shinR", radius: 0.115, groups: ["skirt", "cape"] },
  { from: "DEF-shinL", to: "DEF-footL", radius: 0.085, groups: ["skirt", "cape"] },
  { from: "DEF-shinR", to: "DEF-footR", radius: 0.085, groups: ["skirt", "cape"] },
  { from: "DEF-spine003", to: "DEF-spine005", radius: 0.15, groups: ["hair", "cape"] },
  { from: "DEF-spine006", to: "DEF-spine006", radius: 0.155, groups: ["hair", "hat"] },
];

interface SpringJoint {
  bone: THREE.Object3D;
  parent: THREE.Object3D;
  /** Local rotation at bind time — the pose the spring pulls back toward. */
  restLocal: THREE.Quaternion;
  /** Unit direction toward the tail, in this bone's own local space. */
  axis: THREE.Vector3;
  /** Distance to the tail, in model units. */
  length: number;
  /** Tail position in model space, now and one step ago. */
  tail: THREE.Vector3;
  prevTail: THREE.Vector3;
}

interface SpringChain {
  group: SpringGroup;
  rootName: string;
  joints: SpringJoint[];
  /**
   * Model-space transform of the bone the chain hangs off — the head, for hair
   * — sampled last frame and this one.
   *
   * This is the only input to the chain that comes from outside the simulation:
   * every deeper joint hangs off a bone we integrate ourselves, so it is
   * already continuous. The head is not. It updates once per rendered frame,
   * and with three MediaPipe models sharing the tab that can be 15 fps, so it
   * arrives as one big teleport. Stepping every substep against the already
   * -jumped head kicks the chain with a step function once per frame, which is
   * exactly what "the hair dances when tracking is on" looks like. Keeping both
   * samples lets the substeps walk the head across the gap the way it really
   * moved.
   */
  prevParentPos: THREE.Vector3;
  prevParentQuat: THREE.Quaternion;
  parentPos: THREE.Vector3;
  parentQuat: THREE.Quaternion;
}

interface Collider {
  a: THREE.Object3D;
  b: THREE.Object3D;
  radius: number;
  groups: SpringGroup[];
  /** Refreshed each step. */
  pa: THREE.Vector3;
  pb: THREE.Vector3;
}

export interface SpringRig {
  root: THREE.Object3D;
  chains: SpringChain[];
  colliders: Collider[];
  /**
   * Torso length in model units. Every distance in this module is a fraction
   * of it, so the same numbers work whatever scale the .glb was exported at.
   */
  unit: number;
  time: number;
  accumulator: number;
}

export interface SpringOptions {
  enabled: boolean;
  /** Per-group on/off, so a clipping skirt can be killed without killing hair. */
  groups: Record<SpringGroup, boolean>;
  stiffnessScale: number;
  gravityScale: number;
  dragScale: number;
  windScale: number;
  collide: boolean;
  colliderScale: number;
}

export const DEFAULT_SPRING_OPTIONS: SpringOptions = {
  enabled: true,
  groups: { hair: true, skirt: true, cape: true, hat: false },
  stiffnessScale: 1,
  gravityScale: 1,
  dragScale: 1,
  windScale: 1,
  collide: true,
  colliderScale: 1,
};

/* ------------------------------------------------------------------ */
/* Bind                                                                */
/* ------------------------------------------------------------------ */

const _m = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

function modelSpace(
  obj: THREE.Object3D,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): void {
  _m.multiplyMatrices(_rootInv, obj.matrixWorld);
  _m.decompose(outPos, outQuat, _scale);
}

function physChildren(obj: THREE.Object3D): THREE.Object3D[] {
  return obj.children.filter((c) => PHYS_RE.test(c.name));
}

/**
 * Walk the PHYS chains and capture the bind pose. Must run on a freshly
 * loaded scene, before anything has posed the skeleton — same contract as
 * bindRig in pose-rig.ts, and for the same reason.
 */
export function bindSpringBones(root: THREE.Object3D): SpringRig {
  root.updateMatrixWorld(true);
  _rootInv.copy(root.matrixWorld).invert();

  const byName = new Map<string, THREE.Object3D>();
  const roots: THREE.Object3D[] = [];

  root.traverse((obj) => {
    if (!obj.name) return;
    byName.set(obj.name, obj);
    // A chain root is a PHYS bone whose parent is not one.
    if (PHYS_RE.test(obj.name) && !(obj.parent && PHYS_RE.test(obj.parent.name))) {
      roots.push(obj);
    }
  });

  const unit = measureTorso(byName);
  const chains: SpringChain[] = [];

  for (const chainRoot of roots) {
    const group = groupOf(chainRoot.name);
    if (!group) continue;

    // Follow the first PHYS child down; these chains never branch.
    const bones: THREE.Object3D[] = [chainRoot];
    for (;;) {
      const next = physChildren(bones[bones.length - 1])[0];
      if (!next) break;
      bones.push(next);
    }
    if (bones.length < 2) continue;

    const joints: SpringJoint[] = [];

    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const parent = bone.parent;
      if (!parent) continue;

      const child = bones[i + 1];
      let axis: THREE.Vector3;
      let length: number;

      if (child) {
        // The child's local position IS the offset to the tail, expressed in
        // this bone's space. No assumption about Blender's bone axis needed.
        length = child.position.length();
        // A zero-length bone has no direction to aim at, and the length
        // constraint would normalize a zero vector into NaN and poison the
        // rest of the chain. There is nothing to simulate here.
        if (length <= 1e-9) continue;
        axis = child.position.clone().divideScalar(length);
      } else {
        // Leaf: nothing to aim at, so borrow the previous joint's axis and
        // length. Blender keeps one bone-axis convention per armature, so
        // the borrowed axis is the right one.
        const prev = joints[joints.length - 1];
        axis = prev ? prev.axis.clone() : new THREE.Vector3(0, 1, 0);
        length = prev ? prev.length : 0;
        if (length <= 1e-9) continue;
      }

      const tail = new THREE.Vector3();
      modelSpace(bone, _pos, _quat);
      tail.copy(axis).applyQuaternion(_quat).multiplyScalar(length).add(_pos);

      joints.push({
        bone,
        parent,
        restLocal: bone.quaternion.clone(),
        axis,
        length,
        tail,
        prevTail: tail.clone(),
      });
    }

    if (joints.length > 0) {
      // Seed both samples with the bind pose so the first simulated frame
      // interpolates across nothing rather than across a phantom jump.
      const parentPos = new THREE.Vector3();
      const parentQuat = new THREE.Quaternion();
      modelSpace(joints[0].parent, parentPos, parentQuat);
      chains.push({
        group,
        rootName: chainRoot.name,
        joints,
        prevParentPos: parentPos.clone(),
        prevParentQuat: parentQuat.clone(),
        parentPos,
        parentQuat,
      });
    }
  }

  const colliders: Collider[] = [];
  for (const spec of COLLIDER_SPECS) {
    const a = byName.get(spec.from);
    const b = byName.get(spec.to);
    if (!a || !b) continue;
    colliders.push({
      a,
      b,
      radius: spec.radius * unit,
      groups: spec.groups,
      pa: new THREE.Vector3(),
      pb: new THREE.Vector3(),
    });
  }

  return { root, chains, colliders, unit, time: 0, accumulator: 0 };
}

/**
 * Torso length, used as the one length scale everything else is quoted in.
 * Falls back to the scene's bounding-box height if the spine is not where we
 * expect, and finally to 1 — a wrong unit only mistunes the springs, it never
 * throws.
 */
function measureTorso(byName: Map<string, THREE.Object3D>): number {
  const hips = byName.get("DEF-spine");
  const head = byName.get("DEF-spine006");
  if (hips && head) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    modelSpace(hips, a, _quat);
    modelSpace(head, b, _quat);
    const d = a.distanceTo(b);
    if (d > 1e-6) return d;
  }
  return 1;
}

export function springBoneStats(rig: SpringRig): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const chain of rig.chains) {
    stats[chain.group] = (stats[chain.group] ?? 0) + chain.joints.length;
  }
  return stats;
}

/** Drop all accumulated velocity and snap every chain back to bind. */
export function resetSpringBones(rig: SpringRig): void {
  rig.root.updateMatrixWorld(true);
  _rootInv.copy(rig.root.matrixWorld).invert();

  for (const chain of rig.chains) {
    for (const joint of chain.joints) {
      joint.bone.quaternion.copy(joint.restLocal);
      joint.bone.updateMatrix();
      joint.bone.matrixWorld.multiplyMatrices(
        joint.parent.matrixWorld,
        joint.bone.matrix,
      );
      modelSpace(joint.bone, _pos, _quat);
      joint.tail
        .copy(joint.axis)
        .applyQuaternion(_quat)
        .multiplyScalar(joint.length)
        .add(_pos);
      joint.prevTail.copy(joint.tail);
    }
    // Resync both anchor samples too, or the next step interpolates across a
    // gap that the reset just erased and throws the chain straight back out.
    modelSpace(chain.joints[0].parent, chain.parentPos, chain.parentQuat);
    chain.prevParentPos.copy(chain.parentPos);
    chain.prevParentQuat.copy(chain.parentQuat);
  }
  rig.accumulator = 0;
}

/* ------------------------------------------------------------------ */
/* Simulate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Fixed timestep. The spring is an explicit integrator, so it is only stable
 * while the step is small and constant — running it on a raw frame delta makes
 * the hair stiffer at 120 fps than at 30, and a single 200 ms hitch (three
 * MediaPipe models share this tab) is enough to make it explode.
 */
const STEP = 1 / 60;

/**
 * Enough substeps to cover the slowest frame the caller will hand us. The
 * caller clamps its delta to 1/10 s, so anything under 6 quietly throws real
 * time away every slow frame — and three MediaPipe models in one tab means
 * slow frames are the common case, not the exception. Losing time there does
 * not look like dropped physics, it looks like the hair is swimming in syrup
 * while the head snaps around normally.
 */
const MAX_SUBSTEPS = 6;

/**
 * Momentum a joint may carry into one step, as a fraction of its own length.
 * Verlet infers velocity from the last two tail positions, so a tracking
 * dropout that teleports the head reads as enormous speed and whips the chain
 * inside-out. Capping it costs nothing during real motion.
 */
const MAX_CARRY = 0.5;

/** Alternating length/collision relaxations per joint per step. */
const COLLISION_PASSES = 3;

const _head = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();
const _parentInv = new THREE.Quaternion();
const _restQuat = new THREE.Quaternion();
const _restDir = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _next = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _delta = new THREE.Quaternion();
const _target = new THREE.Quaternion();
const _gravity = new THREE.Vector3();
const _wind = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _toPoint = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _push = new THREE.Vector3();
const _rootQuatInv = new THREE.Quaternion();
const _con = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _anchorPos = new THREE.Vector3();
const _anchorQuat = new THREE.Quaternion();
const _anchorMat = new THREE.Matrix4();
const _anchorWorld = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

/**
 * Advance every enabled chain. Call once per rendered frame, *after* the head
 * and arms have been posed — the springs read where those bones actually ended
 * up this frame, and reading a stale head is what turns lag into a whip.
 */
export function updateSpringBones(
  rig: SpringRig,
  dt: number,
  opts: SpringOptions,
): void {
  if (!opts.enabled || rig.chains.length === 0) return;

  // A tab that was backgrounded hands us a multi-second delta. Simulating it
  // is pointless — nobody saw those frames — so clamp and move on.
  rig.accumulator = Math.min(rig.accumulator + dt, STEP * MAX_SUBSTEPS);

  if (rig.accumulator < STEP) return;

  rig.root.updateMatrixWorld(true);
  _rootInv.copy(rig.root.matrixWorld).invert();
  rig.root.getWorldQuaternion(_rootQuatInv).invert();

  // Gravity is world-down expressed in model space, so tipping the avatar with
  // the leva rotation sliders does not tip its hair with it.
  _gravity.set(0, -1, 0).applyQuaternion(_rootQuatInv).normalize();

  // Roll this frame's anchor onto last frame's and take a fresh sample. Done
  // after the early return above, so a frame too short to simulate is not
  // silently dropped from the interpolation — the next one that does step
  // simply spans the whole gap, which is what actually happened.
  for (const chain of rig.chains) {
    chain.prevParentPos.copy(chain.parentPos);
    chain.prevParentQuat.copy(chain.parentQuat);
    modelSpace(chain.joints[0].parent, chain.parentPos, chain.parentQuat);
  }

  const steps = Math.floor(rig.accumulator / STEP);
  for (let i = 0; i < steps; i++) {
    rig.accumulator -= STEP;
    rig.time += STEP;
    // Walk the anchor from where it was to where it is across the substeps
    // instead of teleporting it before the first one.
    stepSprings(rig, STEP, opts, (i + 1) / steps);
  }
}

function refreshColliders(rig: SpringRig): void {
  for (const c of rig.colliders) {
    modelSpace(c.a, c.pa, _quat);
    if (c.b === c.a) c.pb.copy(c.pa);
    else modelSpace(c.b, c.pb, _quat);
  }
}

function stepSprings(
  rig: SpringRig,
  dt: number,
  opts: SpringOptions,
  alpha: number,
): void {
  if (opts.collide) refreshColliders(rig);

  // Two incommensurable frequencies so the breeze never visibly loops.
  const t = rig.time;
  _wind
    .set(
      Math.sin(t * 0.9) * 0.7 + Math.sin(t * 2.3) * 0.3,
      Math.sin(t * 1.7) * 0.15,
      Math.cos(t * 0.61) * 0.7 + Math.cos(t * 1.9) * 0.3,
    )
    .applyQuaternion(_rootQuatInv);

  for (const chain of rig.chains) {
    if (!opts.groups[chain.group]) continue;

    const base = GROUP_DEFAULTS[chain.group];
    const stiffness = base.stiffness * opts.stiffnessScale;
    const gravity = base.gravity * opts.gravityScale;
    const drag = THREE.MathUtils.clamp(base.drag * opts.dragScale, 0, 1);
    const wind = base.wind * opts.windScale;
    const tailRadius = base.radius * rig.unit * opts.colliderScale;
    const maxBendCos = Math.cos(THREE.MathUtils.degToRad(base.maxBend));

    // Where the anchor bone is *at this substep*, not where it ended up.
    _anchorPos.lerpVectors(chain.prevParentPos, chain.parentPos, alpha);
    _anchorQuat
      .copy(chain.prevParentQuat)
      .slerp(chain.parentQuat, alpha);
    _anchorMat.compose(_anchorPos, _anchorQuat, _one);
    // Back to world space, because that is the space bone.matrixWorld lives in
    // and the joints below this one are composed off it.
    _anchorWorld.multiplyMatrices(rig.root.matrixWorld, _anchorMat);

    for (let i = 0; i < chain.joints.length; i++) {
      const joint = chain.joints[i];
      const isRoot = i === 0;

      // Where the tail would sit if the chain were still in its bind pose,
      // carried by whatever the parent is doing right now. This is the term
      // that makes the hair follow the head at all. Only the chain root reads
      // the interpolated anchor; every joint below hangs off a bone this loop
      // already integrated, so it is continuous by construction.
      if (isRoot) {
        _pos.copy(_anchorPos);
        _parentQuat.copy(_anchorQuat);
      } else {
        modelSpace(joint.parent, _pos, _parentQuat);
      }

      // Bone origin in model space. Computed from the parent rather than read
      // off matrixWorld so it follows the interpolated anchor too — reading the
      // matrix here would hand the root joint the teleported head straight back.
      _head.copy(joint.bone.position).applyQuaternion(_parentQuat).add(_pos);

      _restQuat.copy(_parentQuat).multiply(joint.restLocal);
      _restDir.copy(joint.axis).applyQuaternion(_restQuat).normalize();

      _inertia.subVectors(joint.tail, joint.prevTail).multiplyScalar(1 - drag);

      // See MAX_CARRY: one bad tracking frame must not be able to fling the
      // chain somewhere it can never unwind from.
      const maxCarry = joint.length * MAX_CARRY;
      if (_inertia.lengthSq() > maxCarry * maxCarry) _inertia.setLength(maxCarry);

      _next
        .copy(joint.tail)
        .add(_inertia)
        .addScaledVector(_restDir, stiffness * dt * joint.length)
        .addScaledVector(_gravity, gravity * dt * joint.length)
        .addScaledVector(_wind, wind * dt * joint.length);

      // Length and collision are two constraints on one point, and satisfying
      // them once each in sequence lets the second silently undo the first:
      // the length re-projection drags the tail straight back into the capsule
      // the collision pass had just pushed it out of. That is why strands sank
      // into the skull and buzzed along the thighs — they were being pushed out
      // and pulled back in every single step. Relax the two alternately so the
      // point settles somewhere both are satisfied.
      constrainLength(_next, _head, joint.length, _restDir);

      if (opts.collide) {
        for (let pass = 0; pass < COLLISION_PASSES; pass++) {
          const moved = resolveCollisions(
            rig,
            chain.group,
            _next,
            tailRadius,
            opts.colliderScale,
          );
          if (!moved) break;
          constrainLength(_next, _head, joint.length, _restDir);
        }
      }

      // Cap the swing last, so a collider may still hold a strand anywhere
      // inside the cone but nothing can park it outside.
      _aim.subVectors(_next, _head).normalize();
      if (_aim.dot(_restDir) < maxBendCos) {
        limitBend(_aim, _restDir, maxBendCos);
        _next.copy(_head).addScaledVector(_aim, joint.length);
      }

      joint.prevTail.copy(joint.tail);
      joint.tail.copy(_next);

      // Re-aim the bone at the point the simulation landed on. Swing only —
      // a hair strand has no meaningful twist, and inventing one would only
      // shear the skinning.
      _delta.setFromUnitVectors(_restDir, _aim);
      _target.copy(_delta).multiply(_restQuat);
      _parentInv.copy(_parentQuat).invert();
      _target.premultiply(_parentInv);

      joint.bone.quaternion.copy(_target);
      joint.bone.updateMatrix();
      joint.bone.matrixWorld.multiplyMatrices(
        // The root joint composes off the interpolated anchor, so that every
        // joint below it inherits the walked head rather than the teleported
        // one. Everything below composes off its real, already-solved parent.
        isRoot ? _anchorWorld : joint.parent.matrixWorld,
        joint.bone.matrix,
      );
    }
  }
}

/** A bone cannot stretch: snap the free point back onto its sphere. */
function constrainLength(
  point: THREE.Vector3,
  head: THREE.Vector3,
  length: number,
  fallback: THREE.Vector3,
): void {
  _con.subVectors(point, head);
  if (_con.lengthSq() < 1e-12) _con.copy(fallback);
  point.copy(head).addScaledVector(_con.normalize(), length);
}

/**
 * Swing `dir` back toward `restDir` until it sits exactly on the cone of
 * half-angle `acos(cosLimit)`. Both must already be unit length.
 */
function limitBend(
  dir: THREE.Vector3,
  restDir: THREE.Vector3,
  cosLimit: number,
): void {
  _perp.copy(dir).addScaledVector(restDir, -dir.dot(restDir));
  if (_perp.lengthSq() < 1e-12) {
    // Folded exactly onto the axis: no swing plane to rebuild in, so the only
    // answer that is not arbitrary is the bind direction itself.
    dir.copy(restDir);
    return;
  }
  _perp.normalize();
  const sinLimit = Math.sqrt(Math.max(0, 1 - cosLimit * cosLimit));
  dir.copy(restDir).multiplyScalar(cosLimit).addScaledVector(_perp, sinLimit);
}

/**
 * Push a tail out of any capsule that claims its group. Capsules rather than
 * spheres because a thigh is long and thin, and a stack of spheres big enough
 * to cover one would bulge the skirt at the hips.
 *
 * Returns whether anything actually moved, so the relaxation loop can stop as
 * soon as the point is clear instead of always paying for every pass.
 */
function resolveCollisions(
  rig: SpringRig,
  group: SpringGroup,
  point: THREE.Vector3,
  radius: number,
  colliderScale: number,
): boolean {
  let moved = false;
  for (const c of rig.colliders) {
    if (!c.groups.includes(group)) continue;

    _seg.subVectors(c.pb, c.pa);
    const lenSq = _seg.lengthSq();
    if (lenSq < 1e-12) {
      _closest.copy(c.pa);
    } else {
      const u = THREE.MathUtils.clamp(
        _toPoint.subVectors(point, c.pa).dot(_seg) / lenSq,
        0,
        1,
      );
      _closest.copy(c.pa).addScaledVector(_seg, u);
    }

    _push.subVectors(point, _closest);
    const dist = _push.length();
    const min = c.radius * colliderScale + radius;
    if (dist >= min) continue;

    if (dist < 1e-6) {
      // Dead centre: no meaningful direction to push along, so use the
      // capsule's own axis rather than leaving the point stuck inside.
      _push.copy(_seg).normalize();
      if (_push.lengthSq() < 1e-12) _push.set(0, 0, 1);
    } else {
      _push.divideScalar(dist);
    }
    point.copy(_closest).addScaledVector(_push, min);
    moved = true;
  }
  return moved;
}
