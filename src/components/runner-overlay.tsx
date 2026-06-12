import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import PudtanRunner from "./pudtan-runner";
import PropModel from "./prop";
import type { RunnerOverlayProps } from "../interfaces/hand-tracking.interface";

function FinishProp({
  runnerWonRef,
  position,
  rotation,
  scale,
}: {
  runnerWonRef: React.MutableRefObject<boolean>;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.visible = !runnerWonRef.current;
    }
  });

  return (
    <group ref={groupRef}>
      <PropModel scale={scale} position={position} rotation={rotation} />
    </group>
  );
}

function canvasToWorld(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
): [number, number, number] {
  const camZ = 6;
  const camY = 2;
  const fovRad = (45 * Math.PI) / 180;
  const aspect = canvasW / canvasH;
  const visibleH = 2 * Math.tan(fovRad / 2) * camZ;
  const visibleW = visibleH * aspect;

  const worldX = ((px / canvasW) * 2 - 1) * (visibleW / 2);

  const worldY =
    -((py / canvasH) * 2 - 1) * (visibleH / 2) + camY - visibleH / 2;
  return [worldX, worldY, 0];
}

export default function RunnerOverlay({
  runnerPosRef,
  runnerWonRef,
  runnerSpeedRef,
  width,
  height,
}: RunnerOverlayProps) {
  const trackPad = 40;
  const trackW = width - trackPad * 2;
  const trackY = height - 80;
  const trackH = 60;
  const finishPixelX = trackPad + trackW - 2 - 20;
  const finishPixelY = trackY + trackH / 2 + 20;

  const trophyPos = canvasToWorld(finishPixelX, finishPixelY, width, height);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: "none",
      }}
    >
      <Canvas
        style={{ width, height, background: "transparent" }}
        camera={{ position: [0, 2, 6], fov: 45 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.setClearAlpha(0);
        }}
      >
        <ambientLight intensity={1.2} />
        <directionalLight position={[5, 10, 5]} intensity={1.5} />

        <FinishProp
          runnerWonRef={runnerWonRef}
          scale={0.015}
          position={[trophyPos[0], trophyPos[1] + 0.3, trophyPos[2]]}
          rotation={[0, -Math.PI / 4, 0]}
        />

        <PudtanRunner
          runnerPosRef={runnerPosRef}
          runnerWonRef={runnerWonRef}
          runnerSpeedRef={runnerSpeedRef}
          canvasWidth={width}
          canvasHeight={height}
        />
      </Canvas>
    </div>
  );
}
