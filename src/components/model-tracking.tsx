import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { useControls } from "leva";
import { useWebcam } from "../hooks/use-webcam";
import { AvatarFace } from "../components/avatar-face";
import { useFaceBlendshapes } from "../hooks/use-blendshapes";

const AVATAR_URL = "/models/avatar-v3.glb";
const IDLE_URL = "/animations/Pudtan/idle.fbx";

export default function ModelTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWebcam(videoRef);

  const { blendshapes, headRotation, ready, faceFound } =
    useFaceBlendshapes(videoRef);

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

  return (
    <div className="w-full h-screen bg-black flex flex-col">
      <div className="absolute top-4 left-4 z-10 text-white text-sm space-y-1">
        <p>
          สถานะ:{" "}
          {ready
            ? faceFound
              ? "tracking..."
              : "ไม่พบใบหน้า"
            : "กำลังโหลดโมเดล..."}
        </p>
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
              idleUrl={IDLE_URL}
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
