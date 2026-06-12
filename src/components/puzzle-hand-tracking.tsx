import { useRef } from "react";
import { usePuzzleHandTracking } from "../hooks/use-puzzle-hand-tracking";
import GameShell, { StageFrame } from "./game-shell";

export default function PuzzleHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const {
    phase,
    status,
    handCount,
    moveCount,
    solved,
    holdProgress,
    resetPuzzle,
  } = usePuzzleHandTracking(videoRef, camCanvasRef, overlayCanvasRef);

  const isTracking =
    status !== "กำลังโหลด mediapipe..." && !status.startsWith("❌");
  const cameraError = status.startsWith("❌") ? status : null;
  const cameraLoading = status === "กำลังโหลด mediapipe...";

  return (
    <GameShell
      title="เรียงภาพ"
      subtitle="SLIDE PUZZLE"
      tracking={isTracking && handCount > 0}
      statusText={isTracking ? `${handCount} มือ` : status}
      toolbar={
        <span className="rounded-full border border-stone-light bg-surface px-3.5 py-2 text-xs text-ink-soft">
          {phase === "resize" ? "ช่วงที่ 1 · ปรับกรอบ" : "ช่วงที่ 2 · เรียงภาพ"}
        </span>
      }
      hint={
        phase === "resize"
          ? "มือซ้าย (ส้ม) · มือขวา (ฟ้า) · จีบนิ้วโป้ง+ชี้ แล้วดึงแต่ละมุม"
          : "มือซ้าย (ส้ม) · มือขวา (ฟ้า) · จีบนิ้วโป้ง+ชี้ แล้วลากกระเบื้อง"
      }
    >
      <div className="w-[640px] max-w-full">
        <div className="mb-3 flex min-h-7 items-center gap-3">
          <span
            className={`text-sm ${solved ? "font-display font-medium text-clay-deep" : "text-ink-soft"}`}
          >
            {solved
              ? `เรียงสำเร็จใน ${moveCount} ครั้ง · เก่งมาก`
              : phase === "resize"
                ? "จีบนิ้วสองมือ ดึงมุมทแยงเพื่อปรับกรอบ แล้วค้างไว้ 3 วินาที"
                : "จีบแล้วลากกระเบื้องข้างช่องว่างเพื่อเลื่อน"}
          </span>

          {phase === "puzzle" && !solved && (
            <span className="ml-auto text-sm text-stone">
              เลื่อนไป{" "}
              <span className="font-medium text-clay-deep">{moveCount}</span>{" "}
              ครั้ง
            </span>
          )}
          {phase === "puzzle" && (
            <button
              onClick={resetPuzzle}
              className={`cursor-pointer rounded-full border border-stone-light bg-surface px-3.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay ${solved ? "ml-auto" : ""}`}
            >
              เริ่มใหม่
            </button>
          )}
        </div>

        {phase === "resize" && (
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-stone-light">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ${
                holdProgress >= 1 ? "bg-clay-deep" : "bg-clay"
              }`}
              style={{ width: `${holdProgress * 100}%` }}
            />
          </div>
        )}

        <StageFrame loading={cameraLoading} error={cameraError}>
          <video ref={videoRef} style={{ display: "none" }} playsInline />
          <canvas
            ref={camCanvasRef}
            style={{ display: "block", width: 640, height: 480 }}
          />
          <canvas
            ref={overlayCanvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 640,
              height: 480,
              pointerEvents: "none",
            }}
          />
        </StageFrame>
      </div>
    </GameShell>
  );
}
