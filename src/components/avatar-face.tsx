// import { useEffect, useRef } from "react";
// import { useFrame, useLoader, useThree } from "@react-three/fiber";
// import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
// import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// import * as THREE from "three";
// import type { BlendshapeMap, HeadRotation } from "../hooks/use-blendshapes";

// interface AvatarFaceProps {
//   modelUrl: string;
//   blendshapes: BlendshapeMap;
//   headRotation: HeadRotation;
//   smoothing?: number;
// }

// const NAME_OVERRIDES: Record<string, string> = {};

// const BASIS_TRANSCODER_PATH = "/basis/";

// function toModelMorphName(mediapipeName: string): string {
//   if (mediapipeName.endsWith("Left")) {
//     return `${mediapipeName.slice(0, -"Left".length)}_L`;
//   }
//   if (mediapipeName.endsWith("Right")) {
//     return `${mediapipeName.slice(0, -"Right".length)}_R`;
//   }
//   return mediapipeName;
// }

// export function AvatarFace({
//   modelUrl,
//   blendshapes,
//   headRotation,
//   smoothing = 0.35,
// }: AvatarFaceProps) {
//   const { gl } = useThree();
//   const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
//     const ktx2Loader = new KTX2Loader()
//       .setTranscoderPath(BASIS_TRANSCODER_PATH)
//       .detectSupport(gl);
//     loader.setKTX2Loader(ktx2Loader);
//     loader.setMeshoptDecoder(MeshoptDecoder);
//   });
//   const headGroupRef = useRef<THREE.Group>(null);
//   const meshesRef = useRef<THREE.Mesh[]>([]);
//   const currentInfluences = useRef<Map<string, number>>(new Map());

//   useEffect(() => {
//     const meshes: THREE.Mesh[] = [];
//     gltf.scene.traverse((obj) => {
//       const mesh = obj as THREE.Mesh;
//       if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
//         meshes.push(mesh);
//       }
//     });
//     meshesRef.current = meshes;

//     if (meshes.length === 0) {
//       console.warn(
//         "ไม่พบ morph target ในโมเดลนี้เลย — เช็คว่า .glb export มาพร้อม ARKit blendshapes หรือยัง",
//       );
//     } else {
//       for (const mesh of meshes) {
//         console.log(
//           `[AvatarFace] morph targets ใน "${mesh.name || "unnamed mesh"}":`,
//           Object.keys(mesh.morphTargetDictionary!),
//         );
//       }
//     }
//   }, [gltf]);

//   /* eslint-disable react-hooks/immutability */
//   useFrame(() => {
//     for (const mesh of meshesRef.current) {
//       const dict = mesh.morphTargetDictionary!;
//       const influences = mesh.morphTargetInfluences!;

//       for (const [name, targetValue] of Object.entries(blendshapes)) {
//         const morphName = NAME_OVERRIDES[name] ?? toModelMorphName(name);
//         const idx = dict[morphName];
//         if (idx === undefined) continue;

//         const key = `${mesh.uuid}:${idx}`;
//         const prev = currentInfluences.current.get(key) ?? 0;
//         const next = prev + (targetValue - prev) * smoothing;
//         currentInfluences.current.set(key, next);
//         influences[idx] = next;
//       }
//     }

//     if (headGroupRef.current) {
//       const g = headGroupRef.current;
//       g.rotation.x += (headRotation.x - g.rotation.x) * smoothing;
//       // กลับด้าน y/z ให้ตรงกับกล้องที่ mirror อยู่
//       g.rotation.y += (-headRotation.y - g.rotation.y) * smoothing;
//       g.rotation.z += (-headRotation.z - g.rotation.z) * smoothing;
//     }
//   });
//   /* eslint-enable react-hooks/immutability */

//   return (
//     <group ref={headGroupRef}>
//       <primitive object={gltf.scene} />
//     </group>
//   );
// }

// import { useEffect, useRef } from "react";
// import { useFrame, useLoader, useThree } from "@react-three/fiber";
// import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
// import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// import * as THREE from "three";
// import type { BlendshapeMap, HeadRotation } from "../hooks/use-blendshapes";

// const NAME_OVERRIDES: Record<string, string> = {};

// const BASIS_TRANSCODER_PATH = "/basis/";

// function toModelMorphName(
//   mediapipeName: string,
//   dict: Record<string, number>,
// ): string {
//   if (dict[mediapipeName] !== undefined) return mediapipeName;

//   if (mediapipeName.endsWith("Left")) {
//     return `${mediapipeName.slice(0, -"Left".length)}_L`;
//   }
//   if (mediapipeName.endsWith("Right")) {
//     return `${mediapipeName.slice(0, -"Right".length)}_R`;
//   }
//   return mediapipeName;
// }

// export function AvatarFace({
//   modelUrl,
//   blendshapes,
//   headRotation,
//   smoothing = 0.35,
//   headBoneName,
//   transform,
// }: {
//   modelUrl: string;
//   blendshapes: BlendshapeMap;
//   headRotation: HeadRotation;
//   smoothing?: number;
//   headBoneName?: string;
//   transform?: {
//     rotation?: [number, number, number];
//     position?: [number, number, number];
//     scale?: number;
//   };
// }) {
//   const { gl } = useThree();
//   const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
//     const ktx2Loader = new KTX2Loader()
//       .setTranscoderPath(BASIS_TRANSCODER_PATH)
//       .detectSupport(gl);
//     loader.setKTX2Loader(ktx2Loader);
//     loader.setMeshoptDecoder(MeshoptDecoder);
//   });

//   const rootRef = useRef<THREE.Group>(null);
//   const meshesRef = useRef<THREE.Mesh[]>([]);
//   const currentInfluences = useRef<Map<string, number>>(new Map());

//   const headBoneRef = useRef<THREE.Bone | null>(null);
//   const baseHeadEuler = useRef(new THREE.Euler());
//   const smoothedOffset = useRef({ x: 0, y: 0, z: 0 });

//   useEffect(() => {
//     const meshes: THREE.Mesh[] = [];
//     let foundBone: THREE.Bone | null = null;

//     gltf.scene.traverse((obj) => {
//       const mesh = obj as THREE.Mesh;
//       if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
//         meshes.push(mesh);
//       }

//       if ((obj as THREE.Bone).isBone) {
//         const bone = obj as THREE.Bone;
//         if (headBoneName) {
//           if (bone.name === headBoneName) foundBone = bone;
//         } else if (!foundBone && /head/i.test(bone.name)) {
//           foundBone = bone;
//         }
//       }
//     });

//     meshesRef.current = meshes;

//     if (meshes.length === 0) {
//       console.warn(
//         "ไม่พบ morph target ในโมเดลนี้เลย — เช็คว่า .glb export มาพร้อม ARKit blendshapes หรือยัง",
//       );
//     } else {
//       for (const mesh of meshes) {
//         console.log(
//           `[AvatarFace] morph targets ใน "${mesh.name || "unnamed mesh"}":`,
//           Object.keys(mesh.morphTargetDictionary!),
//         );
//       }
//     }

//     if (foundBone) {
//       headBoneRef.current = foundBone;
//       baseHeadEuler.current.copy((foundBone as THREE.Bone).rotation);
//       smoothedOffset.current = { x: 0, y: 0, z: 0 };
//       console.log(
//         `[AvatarFace] ใช้ head bone: "${(foundBone as THREE.Bone).name}"`,
//       );
//     } else {
//       headBoneRef.current = null;
//       console.warn(
//         headBoneName
//           ? `ไม่พบ bone ชื่อ "${headBoneName}" ในโมเดลนี้ — หัวจะไม่หมุนตาม`
//           : 'ไม่พบ bone ที่ชื่อมีคำว่า "head" ในโมเดลนี้ — หัวจะไม่หมุนตาม (ระบุ headBoneName เองถ้ารู้ชื่อ bone ที่ถูกต้อง)',
//       );
//     }
//   }, [gltf, headBoneName]);

//   /* eslint-disable react-hooks/immutability */
//   useFrame(() => {
//     for (const mesh of meshesRef.current) {
//       const dict = mesh.morphTargetDictionary!;
//       const influences = mesh.morphTargetInfluences!;

//       for (const [name, targetValue] of Object.entries(blendshapes)) {
//         const morphName = NAME_OVERRIDES[name] ?? toModelMorphName(name, dict);
//         const idx = dict[morphName];
//         if (idx === undefined) continue;

//         const key = `${mesh.uuid}:${idx}`;
//         const prev = currentInfluences.current.get(key) ?? 0;
//         const next = prev + (targetValue - prev) * smoothing;
//         currentInfluences.current.set(key, next);
//         influences[idx] = next;
//       }
//     }

//     const bone = headBoneRef.current;
//     if (bone) {
//       const off = smoothedOffset.current;

//       off.x += (headRotation.x - off.x) * smoothing;
//       off.y += (-headRotation.y - off.y) * smoothing;
//       off.z += (-headRotation.z - off.z) * smoothing;

//       bone.rotation.set(
//         baseHeadEuler.current.x + off.x,
//         baseHeadEuler.current.y + off.y,
//         baseHeadEuler.current.z + off.z,
//       );
//     }
//   });
//   /* eslint-enable react-hooks/immutability */

//   return (
//     <group
//       ref={rootRef}
//       position={transform?.position ?? [0, 0, 0]}
//       rotation={transform?.rotation ?? [0, 0, 0]}
//       scale={transform?.scale ?? 1}
//     >
//       <primitive object={gltf.scene} />
//     </group>
//   );
// }

import { useEffect, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import type { BlendshapeMap, HeadRotation } from "../hooks/use-blendshapes";
import { retargetMixamoClip } from "../hooks/use-idle-animation";

const NAME_OVERRIDES: Record<string, string> = {};

const BASIS_TRANSCODER_PATH = "/basis/";

/* ------------------------------------------------------------------ */
/* Auto-detect body/hand bones by flexible name pattern                */
/* ใช้แค่หา node เพื่อผูก idle animation เข้าไป ไม่ได้ใช้กับ tracking   */
/* แล้ว (ตัด body tracking ออกทั้งหมดตามที่ขอ)                          */
/* ------------------------------------------------------------------ */

type SidePattern = { left: RegExp[]; right: RegExp[] };

function sidePatterns(keywords: string[]): SidePattern {
  const kw = keywords.join("|");
  return {
    left: [
      new RegExp(`^(${kw})[._]?l(\\.\\d+)?$`, "i"),
      new RegExp(`(${kw}).*[._]l(\\.\\d+)?$`, "i"),
      new RegExp(`^left.*(${kw})`, "i"),
      new RegExp(`(${kw}).*left`, "i"),
    ],
    right: [
      new RegExp(`^(${kw})[._]?r(\\.\\d+)?$`, "i"),
      new RegExp(`(${kw}).*[._]r(\\.\\d+)?$`, "i"),
      new RegExp(`^right.*(${kw})`, "i"),
      new RegExp(`(${kw}).*right`, "i"),
    ],
  };
}

const BONE_KEYWORDS: Record<string, string[]> = {
  UpperArm: ["upper[_-]?arm(?!.*fore)"],
  LowerArm: ["fore[_-]?arm", "lower[_-]?arm"],
  Wrist: ["hand(?!.*(thumb|index|middle|ring|pinky|little|finger))"],
  ThumbProximal: ["thumb[._-]?0?1"],
  ThumbIntermediate: ["thumb[._-]?0?2"],
  ThumbDistal: ["thumb[._-]?0?3"],
  IndexProximal: ["(f[_-]?index|index)[._-]?0?1"],
  IndexIntermediate: ["(f[_-]?index|index)[._-]?0?2"],
  IndexDistal: ["(f[_-]?index|index)[._-]?0?3"],
  MiddleProximal: ["(f[_-]?middle|middle)[._-]?0?1"],
  MiddleIntermediate: ["(f[_-]?middle|middle)[._-]?0?2"],
  MiddleDistal: ["(f[_-]?middle|middle)[._-]?0?3"],
  RingProximal: ["(f[_-]?ring|ring)[._-]?0?1"],
  RingIntermediate: ["(f[_-]?ring|ring)[._-]?0?2"],
  RingDistal: ["(f[_-]?ring|ring)[._-]?0?3"],
  LittleProximal: ["(f[_-]?pinky|f[_-]?little|pinky|little)[._-]?0?1"],
  LittleIntermediate: ["(f[_-]?pinky|f[_-]?little|pinky|little)[._-]?0?2"],
  LittleDistal: ["(f[_-]?pinky|f[_-]?little|pinky|little)[._-]?0?3"],
};

const BONE_AUTO_PATTERNS_FLAT: Record<string, RegExp[]> = {};
for (const [partKey, keywords] of Object.entries(BONE_KEYWORDS)) {
  const p = sidePatterns(keywords);
  BONE_AUTO_PATTERNS_FLAT[`Left${partKey}`] = p.left;
  BONE_AUTO_PATTERNS_FLAT[`Right${partKey}`] = p.right;
}

function toModelMorphName(
  mediapipeName: string,
  dict: Record<string, number>,
): string {
  if (dict[mediapipeName] !== undefined) return mediapipeName;

  if (mediapipeName.endsWith("Left")) {
    return `${mediapipeName.slice(0, -"Left".length)}_L`;
  }
  if (mediapipeName.endsWith("Right")) {
    return `${mediapipeName.slice(0, -"Right".length)}_R`;
  }
  return mediapipeName;
}

function autoDetectBodyBones(
  root: THREE.Object3D,
): Map<string, THREE.Object3D> {
  const allNodes: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.name) allNodes.push(obj);
  });

  const result = new Map<string, THREE.Object3D>();
  const usedNodes = new Set<THREE.Object3D>();

  const orderedKeys = Object.keys(BONE_AUTO_PATTERNS_FLAT).sort((a, b) => {
    const aIsArm = a.includes("UpperArm") || a.includes("LowerArm");
    const bIsArm = b.includes("UpperArm") || b.includes("LowerArm");
    if (aIsArm === bIsArm) return 0;
    return aIsArm ? 1 : -1;
  });

  for (const key of orderedKeys) {
    const patterns = BONE_AUTO_PATTERNS_FLAT[key];
    let found: THREE.Object3D | null = null;

    for (const pattern of patterns) {
      const candidates = allNodes.filter(
        (n) => !usedNodes.has(n) && pattern.test(n.name),
      );
      if (candidates.length > 0) {
        found = candidates.sort((a, b) => a.name.length - b.name.length)[0];
        break;
      }
    }

    if (found) {
      result.set(key, found);
      usedNodes.add(found);
    }
  }

  return result;
}

export function AvatarFace({
  modelUrl,
  blendshapes,
  headRotation,
  smoothing = 0.35,
  headBoneName,
  transform,
  idleUrl,
}: {
  modelUrl: string;
  blendshapes: BlendshapeMap;
  headRotation: HeadRotation;
  smoothing?: number;
  headBoneName?: string;
  transform?: {
    rotation?: [number, number, number];
    position?: [number, number, number];
    scale?: number;
  };
  /**
   * Path to a Mixamo-rigged idle .fbx (e.g. "/animations/Pudtan/idle.fbx").
   * Plays continuously on the arms/hands/fingers — there is no body
   * tracking anymore, so this is the only thing driving those bones.
   * Required if you want the arms to move at all; omit to leave them in
   * bind pose.
   */
  idleUrl?: string;
}) {
  const { gl } = useThree();
  const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
    const ktx2Loader = new KTX2Loader()
      .setTranscoderPath(BASIS_TRANSCODER_PATH)
      .detectSupport(gl);
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
  });

  // เรียก useLoader เสมอเพื่อไม่ให้ hook order เปลี่ยนไปมา ถ้าไม่ได้ส่ง idleUrl
  // มาจะโหลดไฟล์ว่าง (จะ warn ใน console แต่ไม่พัง) — ถ้าไม่ต้องการฟีเจอร์นี้เลย
  // ให้ลบ useLoader(FBXLoader, ...) บรรทัดนี้ออกไปด้วย ไม่ใช่แค่ไม่ส่ง prop
  const idleFbx = useLoader(FBXLoader, idleUrl ?? "/animations/__none__.fbx");

  const rootRef = useRef<THREE.Group>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const currentInfluences = useRef<Map<string, number>>(new Map());

  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const baseHeadEuler = useRef(new THREE.Euler());
  const smoothedOffset = useRef({ x: 0, y: 0, z: 0 });

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef(new THREE.Clock());

  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    let foundBone: THREE.Object3D | null = null;

    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        meshes.push(mesh);
      }

      if (!obj.name) return;

      if (headBoneName) {
        if (obj.name === headBoneName) foundBone = obj;
      } else if (!foundBone && /head/i.test(obj.name)) {
        foundBone = obj;
      }
    });

    meshesRef.current = meshes;

    if (meshes.length === 0) {
      console.warn(
        "ไม่พบ morph target ในโมเดลนี้เลย — เช็คว่า .glb export มาพร้อม ARKit blendshapes หรือยัง",
      );
    } else {
      for (const mesh of meshes) {
        console.log(
          `[AvatarFace] morph targets ใน "${mesh.name || "unnamed mesh"}":`,
          Object.keys(mesh.morphTargetDictionary!),
        );
      }
    }

    if (foundBone) {
      headBoneRef.current = foundBone;
      baseHeadEuler.current.copy((foundBone as THREE.Object3D).rotation);
      smoothedOffset.current = { x: 0, y: 0, z: 0 };
      console.log(
        `[AvatarFace] ใช้ head bone: "${(foundBone as THREE.Object3D).name}"`,
      );
    } else {
      headBoneRef.current = null;
      console.warn(
        headBoneName
          ? `ไม่พบ bone ชื่อ "${headBoneName}" ในโมเดลนี้ — หัวจะไม่หมุนตาม`
          : 'ไม่พบ bone ที่ชื่อมีคำว่า "head" ในโมเดลนี้ — หัวจะไม่หมุนตาม (ระบุ headBoneName เองถ้ารู้ชื่อ bone ที่ถูกต้อง)',
      );
    }

    // --- หา node แขน/มือ/นิ้ว แค่เพื่อผูก idle animation เข้าไป ---
    mixerRef.current = null;
    if (idleUrl && idleFbx.animations.length > 0) {
      // DEBUG: ดูชื่อ track ดิบจาก idle.fbx เทียบกับชื่อ node จริงในโมเดล
      // ลบ 2 บรรทัด log นี้ทิ้งได้หลังหาสาเหตุเจอแล้ว
      console.log(
        "[AvatarFace][debug] idle.fbx track names ดิบ:",
        idleFbx.animations[0].tracks.map((t) => t.name),
      );
      console.log(
        "[AvatarFace][debug] node names ทั้งหมดใน avatar-v3.glb:",
        (() => {
          const names: string[] = [];
          gltf.scene.traverse((o) => o.name && names.push(o.name));
          return names;
        })(),
      );

      const detected = autoDetectBodyBones(gltf.scene);

      if (detected.size === 0) {
        console.warn(
          "[AvatarFace] หา bone แขน/มือ/นิ้วไม่เจอเลย เลยผูก idle animation ไม่ได้",
        );
      } else {
        const retargeted = retargetMixamoClip(idleFbx.animations[0], detected);

        if (retargeted.tracks.length > 0) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          const action = mixer.clipAction(retargeted);
          action.play();
          mixerRef.current = mixer;
          clockRef.current.start();
          console.log(
            `[AvatarFace] เล่น idle animation จาก "${idleUrl}" — retarget ได้ ${retargeted.tracks.length} track`,
          );
        } else {
          console.warn(
            `[AvatarFace] โหลด "${idleUrl}" ได้ แต่ retarget ไม่ติดเลยสักแทร็ก ดู warning ด้านบนจาก retargetMixamoClip`,
          );
        }
      }
    } else if (idleUrl && idleFbx.animations.length === 0) {
      console.warn(
        `[AvatarFace] "${idleUrl}" โหลดสำเร็จแต่ไม่มี animation clip อยู่ข้างในเลย`,
      );
    }
  }, [gltf, headBoneName, idleUrl, idleFbx]);

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    for (const mesh of meshesRef.current) {
      const dict = mesh.morphTargetDictionary!;
      const influences = mesh.morphTargetInfluences!;

      for (const [name, targetValue] of Object.entries(blendshapes)) {
        const morphName = NAME_OVERRIDES[name] ?? toModelMorphName(name, dict);
        const idx = dict[morphName];
        if (idx === undefined) continue;

        const key = `${mesh.uuid}:${idx}`;
        const prev = currentInfluences.current.get(key) ?? 0;
        const next = prev + (targetValue - prev) * smoothing;
        currentInfluences.current.set(key, next);
        influences[idx] = next;
      }
    }

    const bone = headBoneRef.current;
    if (bone) {
      const off = smoothedOffset.current;

      off.x += (headRotation.x - off.x) * smoothing;
      off.y += (-headRotation.y - off.y) * smoothing;
      off.z += (-headRotation.z - off.z) * smoothing;

      bone.rotation.set(
        baseHeadEuler.current.x + off.x,
        baseHeadEuler.current.y + off.y,
        baseHeadEuler.current.z + off.z,
      );
    }

    // แขน/มือ/นิ้ว ขับด้วย idle animation อย่างเดียว ไม่มี body tracking แล้ว
    if (mixerRef.current) {
      mixerRef.current.update(clockRef.current.getDelta());
    }
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group
      ref={rootRef}
      position={transform?.position ?? [0, 0, 0]}
      rotation={transform?.rotation ?? [0, 0, 0]}
      scale={transform?.scale ?? 1}
    >
      <primitive object={gltf.scene} />
    </group>
  );
}
