import { useRef } from "react";
import GameShell, { StageFrame } from "./game-shell";
import { useWingsTracking } from "../hooks/use-wings-tracking";
import { WING_CREDITS } from "../lib/wing-models";

export default function WingsTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, peopleCount } = useWingsTracking(videoRef, canvasRef);

  const tracking = status === "tracking...";
  const cameraError = status.startsWith("❌") ? status : null;

  return (
    <GameShell
      title="ปีก"
      subtitle="WINGS"
      tracking={tracking}
      statusText={tracking ? `${peopleCount} คน` : status}
      headerShade={false}
      hintAtBottom
      hint={
        <>
          ยืนให้กล้องเห็นไหล่ · ชี้นิ้วค้างบนวงกลมด้านบนเพื่อเปลี่ยนปีกของตัวเอง · หรือคลิกวงกลม
          {WING_CREDITS && (
            <span className="block text-[10px] opacity-70">
              โมเดลปีก: {WING_CREDITS}
            </span>
          )}
        </>
      }
    >
      <StageFrame loading={!tracking && !cameraError} error={cameraError}>
        <video ref={videoRef} style={{ display: "none" }} playsInline muted />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full"
        />
      </StageFrame>
    </GameShell>
  );
}
