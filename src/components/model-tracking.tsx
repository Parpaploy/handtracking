import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { useControls } from "leva";
import { useWebcam } from "../hooks/use-webcam";
import { AvatarFace } from "../components/avatar-face";
import { useFaceBlendshapes } from "../hooks/use-blendshapes";
import { usePoseLandmarks } from "../hooks/use-pose";
import { useHandLandmarks } from "../hooks/use-hands";

const AVATAR_URL = "/models/avatar-v3.glb";

export default function ModelTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWebcam(videoRef);

  const { blendshapes, headRotation, ready, faceFound } =
    useFaceBlendshapes(videoRef);

  const {
    bodyTracking,
    fingerTracking,
    mirror,
    swapSides,
    swapHandedness,
    naturalRest,
    idleMotion,
    idleAmount,
    poseSmoothing,
    minVisibility,
  } = useControls("Body Tracking", {
    bodyTracking: { value: true, label: "เปิดจับร่างกาย" },
    fingerTracking: { value: true, label: "เปิดจับนิ้ว" },
    mirror: { value: true, label: "กลับซ้ายขวา (mirror)" },
    swapSides: { value: true, label: "สลับแขนซ้าย/ขวา" },
    swapHandedness: { value: false, label: "สลับมือซ้าย/ขวา" },
    naturalRest: { value: true, label: "ท่าพักแขนลง" },
    idleMotion: { value: true, label: "โยกเบาๆ ตอนพัก" },
    idleAmount: { value: 1, min: 0, max: 3, step: 0.05, label: "แรงโยก" },
    poseSmoothing: { value: 0.35, min: 0.02, max: 1, step: 0.01 },
    minVisibility: { value: 0.5, min: 0, max: 1, step: 0.05 },
  });

  const {
    poseRef,
    ready: poseReady,
    poseFound,
  } = usePoseLandmarks(videoRef, bodyTracking);

  const {
    handsRef,
    ready: handsReady,
    handCount,
  } = useHandLandmarks(videoRef, fingerTracking);

  const { rotX, rotY, rotZ, posX, posY, posZ, scale } = useControls(
    "Avatar Transform",
    {
      rotX: { value: 0, min: -100, max: 100, step: 0.01 },
      rotY: { value: 0, min: -100, max: 100, step: 0.01 },
      rotZ: { value: 0, min: -100, max: 100, step: 0.01 },
      posX: { value: 0, min: -150, max: 150, step: 0.01 },
      posY: { value: -3.2, min: -150, max: 150, step: 0.01 },
      posZ: { value: 0, min: -150, max: 150, step: 0.01 },
      scale: { value: 2.8, min: 0.1, max: 3, step: 0.01 },
    },
  );

  const { camX, camY, camZ, fov } = useControls("Camera", {
    camX: { value: 0, min: -20, max: 20, step: 0.01 },
    camY: { value: 0, min: -20, max: 20, step: 0.01 },
    camZ: { value: 5, min: 0.1, max: 30, step: 0.01 },
    fov: { value: 30, min: 10, max: 90, step: 1 },
  });

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
        <Canvas camera={{ position: [camX, camY, camZ], fov }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, 2, 2]} intensity={1.2} />
          <Suspense fallback={null}>
            <AvatarFace
              modelUrl={AVATAR_URL}
              blendshapes={blendshapes}
              headRotation={headRotation}
              headBoneName="DEF-spine006"
              poseRef={poseRef}
              handsRef={handsRef}
              bodyTracking={bodyTracking}
              fingerTracking={fingerTracking}
              poseOptions={{
                mirror,
                swapSides,
                swapHandedness,
                naturalRest,
                idleMotion,
                idleAmount,
                smoothing: poseSmoothing,
                minVisibility,
              }}
              transform={{
                rotation: [rotX, rotY, rotZ],
                position: [posX, posY, posZ],
                scale,
              }}
            />
            <Environment preset="studio" />
          </Suspense>

          <OrbitControls makeDefault enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
