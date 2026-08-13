import { useEffect, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import type { BlendshapeMap, HeadRotation } from "../hooks/use-blendshapes";
import {
  bindRig,
  applyPoseToRig,
  applyHandsToRig,
  DEFAULT_POSE_OPTIONS,
  type HandFrame,
  type PoseFrame,
  type PoseSolveOptions,
  type RigBinding,
} from "../lib/pose-rig";

const NAME_OVERRIDES: Record<string, string> = {};

const BASIS_TRANSCODER_PATH = "/basis/";

/**
 * MediaPipe blendshape names are ARKit names (eyeBlinkLeft, jawOpen, ...).
 * avatar-v3.glb ships those verbatim, so the exact-match branch normally
 * wins; the _L/_R rewrite is a fallback for models exported with Blender's
 * side suffix convention instead.
 */
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

export function AvatarFace({
  modelUrl,
  blendshapes,
  headRotation,
  smoothing = 0.35,
  headBoneName,
  transform,
  poseRef,
  handsRef,
  poseOptions = DEFAULT_POSE_OPTIONS,
  bodyTracking = true,
  fingerTracking = true,
}: {
  modelUrl: string;
  blendshapes: BlendshapeMap;
  headRotation: HeadRotation;
  smoothing?: number;
  /**
   * Exact node name of the head bone. Remember three.js strips dots from
   * glTF node names, so Blender's "DEF-spine.006" is "DEF-spine006" here.
   */
  headBoneName?: string;
  transform?: {
    rotation?: [number, number, number];
    position?: [number, number, number];
    scale?: number;
  };
  /** Live PoseLandmarker output; see usePoseLandmarks. */
  poseRef?: React.RefObject<PoseFrame | null>;
  /** Live HandLandmarker output; see useHandLandmarks. */
  handsRef?: React.RefObject<HandFrame[] | null>;
  poseOptions?: PoseSolveOptions;
  bodyTracking?: boolean;
  fingerTracking?: boolean;
}) {
  const { gl } = useThree();
  const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
    const ktx2Loader = new KTX2Loader()
      .setTranscoderPath(BASIS_TRANSCODER_PATH)
      .detectSupport(gl);
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
  });

  const rootRef = useRef<THREE.Group>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const currentInfluences = useRef<Map<string, number>>(new Map());

  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const baseHeadEuler = useRef(new THREE.Euler());
  const smoothedOffset = useRef({ x: 0, y: 0, z: 0 });

  const rigRef = useRef<RigBinding | null>(null);

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
    }

    if (foundBone) {
      headBoneRef.current = foundBone;
      baseHeadEuler.current.copy((foundBone as THREE.Object3D).rotation);
      smoothedOffset.current = { x: 0, y: 0, z: 0 };
    } else {
      headBoneRef.current = null;
      console.warn(
        headBoneName
          ? `ไม่พบ bone ชื่อ "${headBoneName}" ในโมเดลนี้ — หัวจะไม่หมุนตาม (three.js ตัด "." ออกจากชื่อ node ของ glTF อย่าลืม)`
          : 'ไม่พบ bone ที่ชื่อมีคำว่า "head" ในโมเดลนี้ — หัวจะไม่หมุนตาม',
      );
    }

    // Capture the bind pose for the arm chain. Must happen before anything
    // has posed the skeleton, hence right here on load.
    const rig = bindRig(gltf.scene);
    rigRef.current = rig;

    if (rig.rest.size === 0) {
      console.warn(
        "[AvatarFace] หา bone แขนไม่เจอ — body tracking จะไม่ทำงาน ดู resolveArmBones ใน lib/pose-rig.ts",
      );
    } else {
      console.log(
        "[AvatarFace] ผูก bone แขนสำเร็จ:",
        JSON.stringify(
          Object.fromEntries(
            Array.from(rig.bones, ([key, bone]) => [key, bone.name]),
          ),
        ),
      );
    }
  }, [gltf, headBoneName]);

  /* eslint-disable react-hooks/immutability */
  useFrame((state) => {
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
      off.y += (headRotation.y - off.y) * smoothing;
      off.z += (headRotation.z - off.z) * smoothing;

      bone.rotation.set(
        baseHeadEuler.current.x + off.x,
        baseHeadEuler.current.y + off.y,
        baseHeadEuler.current.z + off.z,
      );
    }

    const rig = rigRef.current;
    if (rig) {
      // Arms first — the fingers hang off the wrist, so they need a wrist
      // that is already where this frame says it should be.
      const time = state.clock.elapsedTime;
      applyPoseToRig(
        rig,
        bodyTracking ? (poseRef?.current ?? null) : null,
        poseOptions,
        time,
      );
      applyHandsToRig(
        rig,
        fingerTracking ? (handsRef?.current ?? null) : null,
        poseOptions,
        time,
      );
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
