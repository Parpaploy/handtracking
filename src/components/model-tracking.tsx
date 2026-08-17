import { Suspense, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { DEFAULT_ONE_EURO } from "../lib/one-euro";
import { useWebcam } from "../hooks/use-webcam";
import { AvatarFace } from "../components/avatar-face";
import { useFaceBlendshapes } from "../hooks/use-blendshapes";
import { usePoseLandmarks } from "../hooks/use-pose";
import { useHandLandmarks } from "../hooks/use-hands";
import { useLevaModelControls } from "../hooks/use-leva-model-controls";
import { MODELS } from "../constants/model.const";
import type { EnvPreset } from "../interfaces/model.interface";

export default function ModelTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWebcam(videoRef);

  const {
    model,
    bodyTracking,
    fingerTracking,
    mirror,
    swapSides,
    swapHandedness,
    rollStabilize,
    flipPalm,
    naturalRest,
    idleMotion,
    idleAmount,
    responsiveness,
    zDamp,
    minVisibility,
    lightingPreset,
    ambientIntensity,
    directionalIntensity,
    environmentIntensity,
    minCutoff,
    beta,
    physics,
    hair,
    skirt,
    cape,
    hat,
    stiffnessScale,
    gravityScale,
    dragScale,
    windScale,
    collide,
    colliderScale,
    rotX,
    rotY,
    rotZ,
    posX,
    posY,
    posZ,
    scale,
    camX,
    camY,
    camZ,
    fov,
  } = useLevaModelControls(Object.keys(MODELS));

  const {
    url: modelUrl,
    headBoneName,
    morphOverrides,
    springBoneMatcher,
  } = MODELS[model];

  const oneEuro = useMemo(
    () => ({ minCutoff, beta, dCutoff: DEFAULT_ONE_EURO.dCutoff }),
    [minCutoff, beta],
  );

  const { blendshapesRef, headRotationRef, ready, faceFound } =
    useFaceBlendshapes(videoRef, { filter: oneEuro });

  const springOptions = useMemo(
    () => ({
      enabled: physics,
      groups: { hair, skirt, cape, hat },
      stiffnessScale,
      gravityScale,
      dragScale,
      windScale,
      collide,
      colliderScale,
    }),
    [
      physics,
      hair,
      skirt,
      cape,
      hat,
      stiffnessScale,
      gravityScale,
      dragScale,
      windScale,
      collide,
      colliderScale,
    ],
  );

  const {
    poseRef,
    ready: poseReady,
    poseFound,
  } = usePoseLandmarks(videoRef, bodyTracking, oneEuro);

  const {
    handsRef,
    ready: handsReady,
    handCount,
  } = useHandLandmarks(videoRef, fingerTracking, oneEuro);

  // ✅ กันสร้าง object ใหม่ทุก render — ตัวการหลักที่ทำให้ AvatarFace
  // (และ effect ข้างในที่ผูก rig/physics) คำนวณใหม่โดยไม่จำเป็น
  const poseOptions = useMemo(
    () => ({
      mirror,
      swapSides,
      swapHandedness,
      rollStabilize,
      flipPalm,
      naturalRest,
      idleMotion,
      idleAmount,
      responsiveness,
      zDamp,
      minVisibility,
    }),
    [
      mirror,
      swapSides,
      swapHandedness,
      rollStabilize,
      flipPalm,
      naturalRest,
      idleMotion,
      idleAmount,
      responsiveness,
      zDamp,
      minVisibility,
    ],
  );

  const transform = useMemo(
    () => ({
      rotation: [rotX, rotY, rotZ] as [number, number, number],
      position: [posX, posY, posZ] as [number, number, number],
      scale,
    }),
    [rotX, rotY, rotZ, posX, posY, posZ, scale],
  );

  const cameraProps = useMemo(
    () => ({ position: [camX, camY, camZ] as [number, number, number], fov }),
    [camX, camY, camZ, fov],
  );

  const faceStatus = ready
    ? faceFound
      ? "tracking..."
      : "ไม่พบใบหน้า"
    : "กำลังโหลดโมเดล...";

  const bodyStatus = !bodyTracking
    ? "ปิดอยู่"
    : poseReady
      ? poseFound
        ? "tracking..."
        : "ไม่พบร่างกาย"
      : "กำลังโหลดโมเดล...";

  const fingerStatus = !fingerTracking
    ? "ปิดอยู่"
    : handsReady
      ? handCount > 0
        ? `tracking... (${handCount} มือ)`
        : "ไม่พบมือ"
      : "กำลังโหลดโมเดล...";

  return (
    <div
      className="w-full h-screen bg-cover bg-center bg-no-repeat flex flex-col"
      style={{ backgroundImage: "url('/chihiro007.jpg')" }}
    >
      <div className="absolute top-4 left-4 z-10 text-white text-sm space-y-1">
        <p>ใบหน้า: {faceStatus}</p>
        <p>ร่างกาย: {bodyStatus}</p>
        <p>นิ้ว: {fingerStatus}</p>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute bottom-4 right-4 w-40 h-auto rounded-lg border border-white/30 z-10"
        style={{ transform: "scaleX(-1)" }}
      />

      <div className="relative w-full h-full overflow-hidden">
        <Canvas
          camera={cameraProps}
          dpr={[1, 1.5]}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          performance={{ min: 0.5 }}
        >
          <ambientLight intensity={ambientIntensity} />
          <directionalLight
            position={[1, 2, 2]}
            intensity={directionalIntensity}
          />
          <Suspense fallback={null}>
            <AvatarFace
              key={modelUrl}
              modelUrl={modelUrl}
              blendshapesRef={blendshapesRef}
              headRotationRef={headRotationRef}
              headBoneName={headBoneName}
              morphOverrides={morphOverrides}
              springBoneMatcher={springBoneMatcher}
              poseRef={poseRef}
              handsRef={handsRef}
              bodyTracking={bodyTracking}
              fingerTracking={fingerTracking}
              poseOptions={poseOptions}
              springOptions={springOptions}
              transform={transform}
            />
            <Environment
              key={lightingPreset}
              preset={lightingPreset as EnvPreset}
              environmentIntensity={environmentIntensity}
              resolution={256}
            />
          </Suspense>

          <OrbitControls makeDefault enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
