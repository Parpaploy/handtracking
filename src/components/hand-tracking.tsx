import { useRef } from "react";
import { useHandTracking } from "../hooks/use-hand-tracking";

export default function HandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount } = useHandTracking(videoRef, canvasRef);

  return (
    <div className="w-full h-screen bg-black flex flex-col">
      <div className="absolute top-4 left-4 z-10 text-white text-sm space-y-1">
        <p>สถานะ: {status}</p>
        <p>มือที่พบ: {handCount} มือ</p>
      </div>

      <div className="relative w-full h-full overflow-hidden">
        <video
          ref={videoRef}
          style={{ display: "none" }}
          className="hidden"
          playsInline
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
    </div>
  );
}
