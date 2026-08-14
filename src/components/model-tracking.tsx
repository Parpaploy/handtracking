import { Suspense, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { useControls } from "leva";
import { DEFAULT_ONE_EURO } from "../lib/one-euro";
import { useWebcam } from "../hooks/use-webcam";
import { AvatarFace } from "../components/avatar-face";
import { useFaceBlendshapes } from "../hooks/use-blendshapes";
import { usePoseLandmarks } from "../hooks/use-pose";
import { useHandLandmarks } from "../hooks/use-hands";

const AVATAR_URL = "/models/avatar-v3.glb";

export default function ModelTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWebcam(videoRef);

  const {
    bodyTracking,
    fingerTracking,
    mirror,
    swapSides,
    swapHandedness,
    naturalRest,
    idleMotion,
    idleAmount,
    responsiveness,
    zDamp,
    rollStabilize,
    flipPalm,
    minVisibility,
  } = useControls("Body Tracking", {
    bodyTracking: { value: true, label: "เปิดจับร่างกาย" },
    fingerTracking: { value: true, label: "เปิดจับนิ้ว" },
    mirror: { value: true, label: "กลับซ้ายขวา (mirror)" },
    swapSides: { value: true, label: "สลับแขนซ้าย/ขวา" },
    swapHandedness: { value: false, label: "สลับมือซ้าย/ขวา" },
    rollStabilize: { value: true, label: "ล็อกการบิดแขน" },
    flipPalm: { value: true, label: "กลับด้านฝ่ามือ" },
    naturalRest: { value: true, label: "ท่าพักแขนลง" },
    idleMotion: { value: true, label: "โยกเบาๆ ตอนพัก" },
    idleAmount: { value: 1, min: 0, max: 3, step: 0.05, label: "แรงโยก" },
    responsiveness: {
      value: 25,
      min: 2,
      max: 60,
      step: 1,
      label: "ความไวตาม (1/วิ)",
    },
    zDamp: { value: 0.8, min: 0, max: 1, step: 0.05, label: "ลดความลึก Z" },
    minVisibility: { value: 0.5, min: 0, max: 1, step: 0.05 },
  });

  // The 1€ filter that kills the shake. minCutoff sets how still a still limb
  // is; beta sets how little a moving one lags. See lib/one-euro.ts.
  const { minCutoff, beta } = useControls("กันสั่น (1€ filter)", {
    minCutoff: {
      value: 1,
      min: 0.1,
      max: 6,
      step: 0.05,
      label: "นิ่งตอนอยู่เฉย",
    },
    beta: { value: 0.7, min: 0, max: 4, step: 0.05, label: "ไวตอนขยับเร็ว" },
  });

  const oneEuro = useMemo(
    () => ({ minCutoff, beta, dCutoff: DEFAULT_ONE_EURO.dCutoff }),
    [minCutoff, beta],
  );

  // All three landmarkers share one filter setting — they are all fighting
  // the same webcam noise, and three separate sets of sliders to keep in sync
  // would be three ways to get it wrong.
  // mirror is left at the hook's own default, as it was — it pairs with the
  // scaleX(-1) on the preview video, not with the leva mirror toggle.
  const { blendshapesRef, headRotationRef, ready, faceFound } =
    useFaceBlendshapes(videoRef, { filter: oneEuro });

  const {
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
  } = useControls("ฟิสิกส์ผม/ผ้า", {
    physics: { value: true, label: "เปิดฟิสิกส์" },
    hair: { value: true, label: "ผม + ผมหน้าม้า" },
    skirt: { value: true, label: "กระโปรง" },
    cape: { value: true, label: "ผ้าคลุม" },
    hat: { value: false, label: "หมวก" },
    stiffnessScale: {
      value: 1,
      min: 0.1,
      max: 3,
      step: 0.05,
      label: "ความแข็ง",
    },
    gravityScale: {
      value: 1,
      min: 0,
      max: 3,
      step: 0.05,
      label: "แรงโน้มถ่วง",
    },
    dragScale: { value: 1, min: 0.2, max: 2, step: 0.05, label: "หน่วง" },
    windScale: { value: 1, min: 0, max: 4, step: 0.05, label: "ลม" },
    collide: { value: true, label: "ชนกับตัว/ขา" },
    colliderScale: {
      value: 1,
      min: 0.5,
      max: 2,
      step: 0.05,
      label: "ขนาดตัวชน",
    },
  });

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
              blendshapesRef={blendshapesRef}
              headRotationRef={headRotationRef}
              headBoneName="DEF-spine006"
              poseRef={poseRef}
              handsRef={handsRef}
              bodyTracking={bodyTracking}
              fingerTracking={fingerTracking}
              poseOptions={{
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
              }}
              springOptions={springOptions}
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
