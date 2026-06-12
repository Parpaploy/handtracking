import { useRef } from "react";
import { useRunHandTracking } from "../hooks/use-run-hand-tracking";
import RunnerOverlay from "./runner-overlay";

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 560;

export default function RunHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { status, handCount, runnerPosRef, runnerSpeedRef, runnerWonRef } =
    useRunHandTracking(videoRef, canvasRef);

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        padding: 16,
        background: "#111",
        minHeight: "100vh",
        color: "#fff",
      }}
      className="flex flex-col justify-center items-center"
    >
      <div
        className="justify-center items-center"
        style={{ display: "flex", gap: 10, marginBottom: 14 }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: status === "tracking..." ? "#4ade80" : "#555",
            boxShadow: status === "tracking..." ? "0 0 6px #4ade80" : "none",
          }}
        />
        <span style={{ fontSize: 12, color: "#555" }}>
          {status === "tracking..." ? `${handCount} มือ` : status}
        </span>
      </div>

      <div
        style={{ fontSize: 13, color: "#aaa", marginBottom: 10, minHeight: 20 }}
      >
        ✊ กำมือ 2 ข้างแล้วเขย่าเพื่อวิ่ง (ต้องเขย่าต่อเนื่อง!)
      </div>

      <div
        style={{
          position: "relative",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #222",
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
        }}
      >
        <video ref={videoRef} style={{ display: "none" }} playsInline />

        <canvas ref={canvasRef} />

        <RunnerOverlay
          runnerPosRef={runnerPosRef}
          runnerWonRef={runnerWonRef}
          runnerSpeedRef={runnerSpeedRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
        />
      </div>
    </div>
  );
}
