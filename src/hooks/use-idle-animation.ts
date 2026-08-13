import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* Mixamo -> kalidokit-style key mapping                              */
/*                                                                     */
/* Mixamo bone names are always fixed regardless of the model, e.g.   */
/* "mixamorigLeftArm", "mixamorigLeftHandThumb1", etc. We map these   */
/* to the same key names produced by autoDetectBodyBones() in         */
/* avatar-face.tsx (LeftUpperArm, LeftThumbProximal, ...) so the same */
/* detected-bone Map can be reused as the retarget destination.       */
/* ------------------------------------------------------------------ */

const FINGER_PARTS: Record<string, string> = {
  Thumb: "Thumb",
  Index: "Index",
  Middle: "Middle",
  Ring: "Ring",
  Pinky: "Little", // kalidokit/autoDetect uses "Little", mixamo uses "Pinky"
};

const FINGER_SEGMENTS: Record<number, string> = {
  1: "Proximal",
  2: "Intermediate",
  3: "Distal",
};

function buildMixamoToKeyMap(): Record<string, string> {
  const map: Record<string, string> = {};

  for (const side of ["Left", "Right"] as const) {
    map[`mixamorig${side}Arm`] = `${side}UpperArm`;
    map[`mixamorig${side}ForeArm`] = `${side}LowerArm`;
    map[`mixamorig${side}Hand`] = `${side}Wrist`;

    for (const [mixamoFinger, keyFinger] of Object.entries(FINGER_PARTS)) {
      for (const [segNum, segName] of Object.entries(FINGER_SEGMENTS)) {
        map[`mixamorig${side}Hand${mixamoFinger}${segNum}`] =
          `${side}${keyFinger}${segName}`;
      }
    }
  }

  return map;
}

export const MIXAMO_TO_KEY = buildMixamoToKeyMap();

/**
 * Remap an FBX (Mixamo) AnimationClip so its tracks target the real node
 * names found on the destination skeleton, using the same key set that
 * autoDetectBodyBones() produces (LeftUpperArm, RightWrist, ...).
 *
 * Only tracks whose mixamo bone has both (a) an entry in MIXAMO_TO_KEY and
 * (b) a matching detected node on the destination model are kept. Anything
 * else (spine, legs, head, etc. if not detected) is silently dropped —
 * check the console warning this prints for what's missing.
 */
export function retargetMixamoClip(
  fbxClip: THREE.AnimationClip,
  detectedBones: Map<string, THREE.Object3D>,
): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];
  const missing = new Set<string>();

  for (const track of fbxClip.tracks) {
    // track.name looks like "mixamorigLeftArm.quaternion"
    const dotIndex = track.name.lastIndexOf(".");
    if (dotIndex === -1) continue;

    const mixamoName = track.name.slice(0, dotIndex);
    const prop = track.name.slice(dotIndex + 1);

    // Only retarget rotation — position tracks from a differently-scaled/
    // proportioned rig will distort the destination skeleton.
    if (prop !== "quaternion") continue;

    const key = MIXAMO_TO_KEY[mixamoName];
    if (!key) continue;

    const targetNode = detectedBones.get(key);
    if (!targetNode) {
      missing.add(key);
      continue;
    }

    const cloned = track.clone();
    cloned.name = `${targetNode.name}.${prop}`;
    newTracks.push(cloned);
  }

  if (missing.size > 0) {
    console.warn(
      "[retargetMixamoClip] ปลายทางไม่มี bone สำหรับ key เหล่านี้ เลยข้ามไป:",
      Array.from(missing).join(", "),
    );
  }
  if (newTracks.length === 0) {
    console.warn(
      "[retargetMixamoClip] retarget ไม่ได้เลยสักแทร็ก — เช็คว่า detectedBones ถูกส่งเข้ามาก่อน (ต้องรอ autoDetectBodyBones ทำงานเสร็จก่อน) และเช็คชื่อ mixamo bone ใน clip ว่าตรงกับ MIXAMO_TO_KEY ไหม",
    );
  }

  return new THREE.AnimationClip(
    "idle_retargeted",
    fbxClip.duration,
    newTracks,
  );
}
