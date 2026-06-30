import { useRef } from "react";
import GameShell, { StageFrame } from "./game-shell";
import { useSteamHandTracking } from "../hooks/use-steam-tracking";

export default function SteamTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount, mouthOpen, clearFog, refogAll } =
    useSteamHandTracking(videoRef, canvasRef);

  const tracking = status === "tracking...";
  const cameraError = status.startsWith("❌") ? status : null;

  const modeChip = mouthOpen
    ? "bg-stone text-white border-stone"
    : "bg-clay text-white border-clay";
  const modeLabel = mouthOpen ? "ไอน้ำกำลังจับฝ้า" : "เช็ดกระจกได้";

  return (
    <GameShell
      title="กระจกฝ้า"
      subtitle="STEAM MIRROR"
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
            onClick={clearFog}
            className="cursor-pointer rounded-full border border-stone-light bg-surface px-3.5 py-2 text-xs text-ink-soft transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
          >
            เช็ดให้หมด
          </button>
          <button
            onClick={refogAll}
            className="cursor-pointer rounded-full border border-stone-light bg-surface px-3.5 py-2 text-xs text-ink-soft transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
          >
            พ่นฝ้าใหม่
          </button>
        </>
      }
      hint={<>เอานิ้วชี้ปาดจอให้ชัด · อ้าปากให้ไอน้ำจับฝ้าอีกครั้ง</>}
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
