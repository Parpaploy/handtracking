import { useRef } from "react";
import { useDrawingHandTracking } from "../hooks/use-drawing-hand-tracking";
import GameShell, { StageFrame } from "./game-shell";

export default function DrawHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount, drawMode, clearDrawing } = useDrawingHandTracking(
    videoRef,
    canvasRef,
  );

  const tracking = status === "tracking...";
  const cameraError = status.startsWith("❌") ? status : null;

  const modeChip = {
    draw: "bg-clay text-white border-clay",
    erase: "bg-stone text-white border-stone",
    idle: "bg-surface text-ink-soft border-stone-light",
  }[drawMode];

  const modeLabel = {
    draw: "กำลังวาด",
    erase: "กำลังลบ",
    idle: "พร้อมวาด",
  }[drawMode];

  return (
    <GameShell
      title="วาดรูป"
      subtitle="DRAWING"
      tracking={tracking}
      statusText={tracking ? `${handCount} มือ` : status}
      toolbar={
        <>
          <span
            className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors duration-200 ${modeChip}`}
          >
            {modeLabel}
          </span>
          <button
            onClick={clearDrawing}
            className="cursor-pointer rounded-full border border-stone-light bg-surface px-3.5 py-2 text-xs text-ink-soft transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
          >
            ล้างกระดาน
          </button>
        </>
      }
      hint={
        <>
          มือขวาจีบนิ้วโป้ง+ชี้ = วาดเส้น · มือซ้ายจีบ = ลบเส้น
        </>
      }
    >
      <StageFrame loading={!tracking && !cameraError} error={cameraError}>
        <video ref={videoRef} style={{ display: "none" }} playsInline />
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: 720, height: 560 }}
        />
      </StageFrame>
    </GameShell>
  );
}
