import * as THREE from "three";
import { useLoader, useFrame } from "@react-three/fiber";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { useRef } from "react";

export default function PropModel({
  position,
  rotation,
  scale,
}: {
  scale: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const model = useLoader(FBXLoader, "/models/pot.fbx");
  const generateUVIfMissing = false;

  const innerGroupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (innerGroupRef.current) {
      innerGroupRef.current.position.y =
        Math.sin(state.clock.elapsedTime * 3) * 15;
    }
  });

  model.traverse((child: THREE.Object3D) => {
    if (!(child instanceof THREE.Mesh) || !child.material) return;

    const geom = child.geometry as THREE.BufferGeometry | undefined;
    const hasUV = !!geom?.getAttribute?.("uv");

    if (!hasUV && generateUVIfMissing && geom) {
      ensureUV(geom);
    }

    const mats = Array.isArray(child.material)
      ? (child.material as THREE.Material[])
      : [child.material as THREE.Material];

    const newMats = mats.map((m: THREE.Material) => {
      if (m && typeof m.clone === "function") {
        const cloned = m.clone() as THREE.MeshStandardMaterial;

        if (!hasUV && !generateUVIfMissing) {
          cloned.map = null;
          cloned.normalMap = null;
          cloned.roughnessMap = null;
          cloned.metalnessMap = null;
        }

        if (!cloned.isMeshStandardMaterial) {
          const src = m as THREE.MeshStandardMaterial;
          const std = new THREE.MeshStandardMaterial({
            color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
            roughness: 1,
            metalness: 0,
          });
          if (hasUV || generateUVIfMissing) {
            std.map = src.map ?? null;
            std.normalMap = src.normalMap ?? null;
            std.roughnessMap = src.roughnessMap ?? null;
            std.metalnessMap = src.metalnessMap ?? null;
          }
          return std;
        } else {
          cloned.roughness = 1;
          cloned.metalness = 0;
          return cloned;
        }
      }

      const src = m as THREE.MeshStandardMaterial;
      const fallback = new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
      });
      if (hasUV || generateUVIfMissing) {
        fallback.map = src.map ?? null;
        fallback.normalMap = src.normalMap ?? null;
      }
      return fallback;
    });

    child.material = Array.isArray(child.material) ? newMats : newMats[0];
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={innerGroupRef}>
        <primitive object={model} />
      </group>
    </group>
  );
}

function ensureUV(geometry: THREE.BufferGeometry) {
  if (!geometry) return;
  const pos = geometry.getAttribute("position") as
    | THREE.BufferAttribute
    | undefined;
  if (!pos || geometry.getAttribute("uv")) return;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv[i * 2] = size.x ? (x - bbox.min.x) / size.x : 0;
    uv[i * 2 + 1] = size.z ? (z - bbox.min.z) / size.z : 0;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
