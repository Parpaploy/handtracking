import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { AvatarFace } from "../components/avatar-face";
import { useFaceBlendshapes } from "./use-blendshapes";
import { useWebcam } from "./use-webcam";

const AVATAR_URL = "/models/avatar-v3.glb";

export default function ModelTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useWebcam(videoRef);
  const { blendshapes, headRotation, ready, faceFound } =
    useFaceBlendshapes(videoRef);

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
        <Canvas camera={{ position: [0, 1.6, 0.8], fov: 30 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, 2, 2]} intensity={1.2} />
          <Suspense fallback={null}>
            <AvatarFace
              modelUrl={AVATAR_URL}
              blendshapes={blendshapes}
              headRotation={headRotation}
            />
            <Environment preset="studio" />
          </Suspense>
          <OrbitControls target={[0, 1.5, 0]} enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
