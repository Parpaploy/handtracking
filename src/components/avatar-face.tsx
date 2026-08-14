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
import {
  bindSpringBones,
  updateSpringBones,
  springBoneStats,
  DEFAULT_SPRING_OPTIONS,
  type SpringOptions,
  type SpringRig,
} from "../lib/spring-bones";

const BASIS_TRANSCODER_PATH = "/basis/";

/**
 * MediaPipe blendshape names are ARKit names (eyeBlinkLeft, jawOpen, ...).
 * avatar-v3.glb ships those verbatim, so the exact-match branch normally
 * wins; the _L/_R rewrite is a fallback for models exported with Blender's
 * side suffix convention instead.
 *
 * `overrides` lets a specific model remap an ARKit name to whatever its
 * own morph target is actually called (e.g. VRM-style "Fcl_EYE_Close_L").
 * Checked first, before the exact match / _L/_R fallback.
 */
function toModelMorphName(
  mediapipeName: string,
  dict: Record<string, number>,
  overrides: Record<string, string>,
): string {
  if (overrides[mediapipeName] !== undefined) return overrides[mediapipeName];

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
  blendshapesRef,
  headRotationRef,
  faceResponsiveness = 26,
  headResponsiveness = 18,
  headBoneName,
  morphOverrides,
  transform,
  poseRef,
  handsRef,
  poseOptions = DEFAULT_POSE_OPTIONS,
  springOptions = DEFAULT_SPRING_OPTIONS,
  bodyTracking = true,
  fingerTracking = true,
}: {
  modelUrl: string;
  /** Live FaceLandmarker output; see useFaceBlendshapes. */
  blendshapesRef: React.RefObject<BlendshapeMap>;
  headRotationRef: React.RefObject<HeadRotation>;
  /**
   * Convergence rates in 1/second, not per-frame factors — see
   * PoseSolveOptions.responsiveness for why that distinction matters here.
   * Blendshapes run faster than the head on purpose: a blink lasts about
   * 100 ms and heavy smoothing eats it, while a smoothed head is just calm.
   */
  faceResponsiveness?: number;
  headResponsiveness?: number;
  /**
   * Exact node name of the head bone. Remember three.js strips dots from
   * glTF node names, so Blender's "DEF-spine.006" is "DEF-spine006" here.
   */
  headBoneName?: string;
  /**
   * Per-model ARKit-name -> actual-morph-target-name map. Use this when a
   * model's blendshapes weren't exported with ARKit names (e.g. VRM/VRoid
   * models use names like "Fcl_EYE_Close_L" instead of "eyeBlinkLeft").
   * Checked before the generic _L/_R fallback in toModelMorphName.
   */
  morphOverrides?: Record<string, string>;
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
  /** Hair / skirt / cape physics; see lib/spring-bones.ts. */
  springOptions?: SpringOptions;
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
  const springRef = useRef<SpringRig | null>(null);

  // Keep the latest overrides in a ref so useFrame doesn't need it as a
  // dependency and doesn't go stale if the object identity changes.
  const morphOverridesRef = useRef<Record<string, string>>(
    morphOverrides ?? {},
  );
  useEffect(() => {
    morphOverridesRef.current = morphOverrides ?? {};
  }, [morphOverrides]);

  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    let foundBone: THREE.Object3D | null = null;

    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        meshes.push(mesh);
        console.log(
          `[AvatarFace] morph targets ใน "${mesh.name || "(no name)"}":`,
          JSON.stringify(Object.keys(mesh.morphTargetDictionary)),
        );
        // เพิ่มบรรทัดนี้ — เก็บไว้ที่ window เพื่อ copy() แบบเต็มจาก console ได้
        (window as any).__morphDicts ??= {};
        (window as any).__morphDicts[mesh.name] = Object.keys(
          mesh.morphTargetDictionary,
        );
      }

      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
        console.log(`[AvatarFace] material "${obj.name}":`, {
          metalness: mat.metalness,
          roughness: mat.roughness,
          envMapIntensity: mat.envMapIntensity,
          mapColorSpace: mat.map?.colorSpace,
          emissive: mat.emissive?.getHexString(),
          emissiveIntensity: mat.emissiveIntensity,
        });
      }

      // debug: ดูชื่อ bone ทั้งหมด โดยเฉพาะโซนมือ/นิ้ว
      // const boneNames: string[] = [];
      // gltf.scene.traverse((obj) => {
      //   if ((obj as THREE.Bone).isBone) boneNames.push(obj.name);
      // });
      // console.log(
      //   "[AvatarFace] bone names ทั้งหมด:",
      //   JSON.stringify(boneNames),
      // );

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

    // Same contract as bindRig: the PHYS chains must be captured before
    // anything has posed them, so this belongs right here and nowhere later.
    const springs = bindSpringBones(gltf.scene);
    springRef.current = springs;

    if (springs.chains.length === 0) {
      console.warn(
        "[AvatarFace] ไม่พบ bone ฟิสิกส์ (PHYS) — ผม/กระโปรง/ผ้าคลุมจะไม่ไหว",
      );
    } else {
      console.log(
        "[AvatarFace] ผูก spring bone สำเร็จ:",
        springs.chains.length,
        "chain,",
        springBoneStats(springs),
        `colliders=${springs.colliders.length}`,
      );
    }
  }, [gltf, headBoneName]);

  /* eslint-disable react-hooks/immutability */
  useFrame((state, delta) => {
    // A backgrounded tab resumes with a delta of several seconds. Clamping
    // here keeps every downstream integrator honest in one place.
    const dt = Math.min(Math.max(delta, 1 / 240), 1 / 10);

    // Both of these were fixed per-frame factors, so the face animated at a
    // different speed on every machine. Same time-constant form as the rig.
    const faceT = 1 - Math.exp(-faceResponsiveness * dt);
    const headT = 1 - Math.exp(-headResponsiveness * dt);

    const blendshapes = blendshapesRef.current;
    const overrides = morphOverridesRef.current;

    for (const mesh of meshesRef.current) {
      const dict = mesh.morphTargetDictionary!;
      const influences = mesh.morphTargetInfluences!;

      for (const [name, targetValue] of Object.entries(blendshapes)) {
        const morphName = toModelMorphName(name, dict, overrides);
        const idx = dict[morphName];
        if (idx === undefined) continue;

        const key = `${mesh.uuid}:${idx}`;
        const prev = currentInfluences.current.get(key) ?? 0;
        const next = prev + (targetValue - prev) * faceT;
        currentInfluences.current.set(key, next);
        influences[idx] = next;
      }
    }

    const bone = headBoneRef.current;
    if (bone) {
      const off = smoothedOffset.current;
      const headRotation = headRotationRef.current;

      // No negation here on purpose: useFaceBlendshapes already flips yaw and
      // roll when its mirror option is on. Negating a second time turns the
      // head the wrong way.
      off.x += (headRotation.x - off.x) * headT;
      off.y += (headRotation.y - off.y) * headT;
      off.z += (headRotation.z - off.z) * headT;

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
        dt,
      );
      applyHandsToRig(
        rig,
        fingerTracking ? (handsRef?.current ?? null) : null,
        poseOptions,
        time,
        dt,
      );
    }

    // Springs last. They read where the head and spine actually ended up this
    // frame; running them any earlier means the hair chases a stale head and
    // permanently lags one frame behind the face tracking.
    const springs = springRef.current;
    if (springs) updateSpringBones(springs, dt, springOptions);
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
