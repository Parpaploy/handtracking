"use client";
import { useAnimations, useFBX } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PudtanRunnerProps } from "../interfaces/model.interface";

const TRACK_PAD = 40;
const TRACK_SPRITE_MARGIN = 24;

export default function PudtanRunner({
  runnerPosRef,
  runnerWonRef,
  runnerSpeedRef,
  canvasWidth,
  canvasHeight,
}: PudtanRunnerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentAnimRef = useRef<string>("idle");

  const model = useFBX("/models/Pudtan.fbx");
  const run = useFBX("/animations/Pudtan/run.fbx");
  const idle = useFBX("/animations/Pudtan/idle.fbx");
  const jump = useFBX("/animations/Pudtan/jump.fbx");
  const pray = useFBX("/animations/Pudtan/pray.fbx");

  useEffect(() => {
    const created: THREE.Material[] = [];
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.material) return;
      const mats = Array.isArray(child.material)
        ? (child.material as THREE.Material[])
        : [child.material as THREE.Material];
      child.material = mats.map((m) => {
        const src = m as THREE.MeshStandardMaterial;
        const replacement = new THREE.MeshStandardMaterial({
          color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
          roughness: 1,
          metalness: 0,
          map: src.map ?? null,
        });
        created.push(replacement);
        return replacement;
      });
    });
    return () => created.forEach((m) => m.dispose());
  }, [model]);

  const mergedAnimations = useMemo<THREE.AnimationClip[]>(
    () => [
      ...(model.animations ?? []),
      ...(run?.animations ?? []).map((a) => {
        const clip = a.clone();
        clip.name = "run";

        const fps = 30;
        clip.duration = Math.round(clip.duration * fps - 1) / fps;
        return clip;
      }),
      ...(idle?.animations ?? []).map((a) => {
        const clip = a.clone();
        clip.name = "idle";
        return clip;
      }),
      ...(jump?.animations ?? []).map((a) => {
        const clip = a.clone();
        clip.name = "jump";
        return clip;
      }),
      ...(pray?.animations ?? []).map((a) => {
        const clip = a.clone();
        clip.name = "pray";
        return clip;
      }),
    ],
    [
      model.animations,
      run?.animations,
      idle?.animations,
      jump?.animations,
      pray?.animations,
    ],
  );

  const { actions } = useAnimations(mergedAnimations, groupRef);

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const act = actions["idle"];
    if (!act) return;
    act.setLoop(THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = false;
    act.reset().fadeIn(0.3).play();
    currentAnimRef.current = "idle";
  }, [actions]);
  /* eslint-enable react-hooks/immutability */

  function canvasXToWorld(px: number): number {
    const aspect = canvasWidth / canvasHeight;
    const fovRad = (45 * Math.PI) / 180;
    const visibleH = 2 * Math.tan(fovRad / 2) * 6;
    const visibleW = visibleH * aspect;
    return ((px / canvasWidth) * 2 - 1) * (visibleW / 2);
  }

  function canvasYToWorld(py: number): number {
    const fovRad = (45 * Math.PI) / 180;
    const visibleH = 2 * Math.tan(fovRad / 2) * 6;
    return -((py / canvasHeight) * 2 - 1) * (visibleH / 2);
  }

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    if (!groupRef.current) return;

    const pos = runnerPosRef.current ?? 0;
    const won = runnerWonRef.current ?? false;
    const speed = runnerSpeedRef.current ?? 0;

    const trackW = canvasWidth - TRACK_PAD * 2;
    const trackY = canvasHeight - 80;
    const trackH = 60;
    const pixelX = TRACK_PAD + pos * (trackW - TRACK_SPRITE_MARGIN);
    const pixelY = trackY + trackH / 2 + 80;

    const worldX = canvasXToWorld(pixelX);
    const worldY = canvasYToWorld(pixelY);
    const bounce = Math.sin(Date.now() / 100) * (speed > 0.05 ? 0.08 : 0);

    groupRef.current.position.set(worldX, worldY + bounce, 0);

    groupRef.current.rotation.x = -0.3;
    groupRef.current.rotation.y = won ? -0.3 : speed > 0.05 ? Math.PI / 2 : 0.3;

    const targetAnim = won ? "pray" : speed > 0.05 ? "run" : "idle";
    if (targetAnim !== currentAnimRef.current) {
      const prev = actions[currentAnimRef.current];
      const next = actions[targetAnim];
      if (!next) return;

      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      next.enabled = true;
      next.reset();

      if (prev && prev !== next) {
        next.crossFadeFrom(prev, 0.3, true);
      } else {
        next.fadeIn(0.3);
      }

      next.play();
      currentAnimRef.current = targetAnim;
    }
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group ref={groupRef}>
      <primitive object={model} scale={0.013} />
    </group>
  );
}
