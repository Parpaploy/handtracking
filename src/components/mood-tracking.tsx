import { useRef } from "react";
import { useMoodTracking } from "../hooks/use-mood-tracking";

export default function MoodTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount, faceCount } = useMoodTracking(videoRef, canvasRef);

  return (
    <div className="w-full h-screen bg-black flex flex-col">
      <div className="absolute top-4 left-4 z-10 text-white text-sm space-y-1">
        <p>สถานะ: {status}</p>
        <p>มือที่พบ: {handCount} มือ</p>
        <p>ใบหน้าที่พบ: {faceCount} ใบหน้า</p>
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
