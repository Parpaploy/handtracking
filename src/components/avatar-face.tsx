import { useEffect, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
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
  PHYS_MATCHER,
  type SpringOptions,
  type SpringRig,
  type BoneMatcher,
} from "../lib/spring-bones";
import type {
  BlendshapeMap,
  HeadRotation,
} from "../interfaces/model.interface";

const BASIS_TRANSCODER_PATH = "/basis/";

declare global {
  interface Window {
    __morphDicts?: Record<string, string[]>;
  }
}

const DEBUG_MODEL_LOAD = false;

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
  springBoneMatcher = PHYS_MATCHER,
  bodyTracking = true,
  fingerTracking = true,
}: {
  modelUrl: string;

  blendshapesRef: React.RefObject<BlendshapeMap>;
  headRotationRef: React.RefObject<HeadRotation>;

  faceResponsiveness?: number;
  headResponsiveness?: number;

  headBoneName?: string;

  morphOverrides?: Record<string, string>;
  transform?: {
    rotation?: [number, number, number];
    position?: [number, number, number];
    scale?: number;
  };

  poseRef?: React.RefObject<PoseFrame | null>;

  handsRef?: React.RefObject<HandFrame[] | null>;
  poseOptions?: PoseSolveOptions;

  springOptions?: SpringOptions;

  springBoneMatcher?: BoneMatcher;
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

  const bindingIdx = useRef<Int32Array>(new Int32Array(0));
  const bindingMeshOf = useRef<number[]>([]);
  const bindingName = useRef<string[]>([]);
  const bindingSmoothed = useRef<Float32Array>(new Float32Array(0));

  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const baseHeadEuler = useRef(new THREE.Euler());
  const smoothedOffset = useRef({ x: 0, y: 0, z: 0 });

  const rigRef = useRef<RigBinding | null>(null);
  const springRef = useRef<SpringRig | null>(null);

  const morphOverridesRef = useRef<Record<string, string>>(
    morphOverrides ?? {},
  );
  useEffect(() => {
    morphOverridesRef.current = morphOverrides ?? {};
  }, [morphOverrides]);

  const springBoneMatcherRef = useRef<BoneMatcher>(springBoneMatcher);
  useEffect(() => {
    springBoneMatcherRef.current = springBoneMatcher;
  }, [springBoneMatcher]);

  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    let foundBone: THREE.Object3D | null = null;

    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        meshes.push(mesh);
        if (DEBUG_MODEL_LOAD) {
          console.log(
            `[AvatarFace] morph targets ใน "${mesh.name || "(no name)"}":`,
            JSON.stringify(Object.keys(mesh.morphTargetDictionary)),
          );

          window.__morphDicts ??= {};
          window.__morphDicts[mesh.name] = Object.keys(
            mesh.morphTargetDictionary,
          );
        }
      }

      if (DEBUG_MODEL_LOAD && (obj as THREE.Mesh).isMesh) {
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

      if (DEBUG_MODEL_LOAD && (obj as THREE.Bone).isBone) {
        console.log("[AvatarFace] bone name:", obj.name);
      }

      if (!obj.name) return;

      if (headBoneName) {
        if (obj.name === headBoneName) foundBone = obj;
      } else if (!foundBone && /head/i.test(obj.name)) {
        foundBone = obj;
      }
    });

    meshesRef.current = meshes;

    bindingIdx.current = new Int32Array(0);
    bindingMeshOf.current = [];
    bindingName.current = [];
    bindingSmoothed.current = new Float32Array(0);

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

    const rig = bindRig(gltf.scene);
    rigRef.current = rig;

    if (rig.rest.size === 0) {
      console.warn(
        "[AvatarFace] หา bone แขนไม่เจอ — body tracking จะไม่ทำงาน ดู resolveArmBones ใน lib/pose-rig.ts",
      );
    } else if (DEBUG_MODEL_LOAD) {
      console.log(
        "[AvatarFace] ผูก bone แขนสำเร็จ:",
        JSON.stringify(
          Object.fromEntries(
            Array.from(rig.bones, ([key, bone]) => [key, bone.name]),
          ),
        ),
      );
    }

    const springs = bindSpringBones(gltf.scene, springBoneMatcherRef.current);
    springRef.current = springs;

    if (springs.chains.length === 0) {
      console.warn(
        "[AvatarFace] ไม่พบ spring bone เลย — ผม/กระโปรง/ผ้าคลุมจะไม่ไหว " +
          "(เช็คว่าโมเดลนี้ตั้งชื่อ bone ตรงกับ springBoneMatcher ที่ส่งเข้ามาไหม " +
          "ถ้าโมเดลไม่มี prefix 'PHYS' ต้องส่ง matcher อื่นเข้ามา เช่น KEYWORD_MATCHER)",
      );
    } else if (DEBUG_MODEL_LOAD) {
      console.log(
        "[AvatarFace] ผูก spring bone สำเร็จ:",
        springs.chains.length,
        "chain,",
        springBoneStats(springs),
        `colliders=${springs.colliders.length}`,
      );
    }
  }, [gltf, headBoneName]);

  useFrame((state, delta) => {
    const dt = Math.min(Math.max(delta, 1 / 240), 1 / 10);

    const faceT = 1 - Math.exp(-faceResponsiveness * dt);
    const headT = 1 - Math.exp(-headResponsiveness * dt);

    const blendshapes = blendshapesRef.current;

    if (
      bindingIdx.current.length === 0 &&
      Object.keys(blendshapes).length > 0
    ) {
      const overrides = morphOverridesRef.current;
      const idxList: number[] = [];
      const meshList: number[] = [];
      const nameList: string[] = [];

      meshesRef.current.forEach((mesh, meshIndex) => {
        const dict = mesh.morphTargetDictionary!;
        for (const name of Object.keys(blendshapes)) {
          const morphName = toModelMorphName(name, dict, overrides);
          const idx = dict[morphName];
          if (idx === undefined) continue;
          idxList.push(idx);
          meshList.push(meshIndex);
          nameList.push(name);
        }
      });

      bindingIdx.current = new Int32Array(idxList);
      bindingMeshOf.current = meshList;
      bindingName.current = nameList;
      bindingSmoothed.current = new Float32Array(idxList.length);
    }

    const idxArr = bindingIdx.current;
    const meshArr = bindingMeshOf.current;
    const nameArr = bindingName.current;
    const smoothedArr = bindingSmoothed.current;
    const meshes = meshesRef.current;

    for (let i = 0; i < idxArr.length; i++) {
      const target = blendshapes[nameArr[i]] ?? 0;
      const prev = smoothedArr[i];
      const next = prev + (target - prev) * faceT;
      smoothedArr[i] = next;
      meshes[meshArr[i]].morphTargetInfluences![idxArr[i]] = next;
    }

    const bone = headBoneRef.current;
    if (bone) {
      const off = smoothedOffset.current;
      const headRotation = headRotationRef.current;

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

    const springs = springRef.current;
    if (springs) updateSpringBones(springs, dt, springOptions);
  });

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
