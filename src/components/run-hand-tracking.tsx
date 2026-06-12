import { useRef } from "react";
import { useRunHandTracking } from "../hooks/use-run-hand-tracking";
import RunnerOverlay from "./runner-overlay";
import GameShell, { StageFrame } from "./game-shell";

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 560;

export default function RunHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { status, handCount, runnerPosRef, runnerSpeedRef, runnerWonRef } =
    useRunHandTracking(videoRef, canvasRef);

  const tracking = status === "tracking...";
  const cameraError = status.startsWith("❌") ? status : null;

  return (
    <GameShell
      title="วิ่งสุดแรง"
      subtitle="RUNNER"
      tracking={tracking}
      statusText={tracking ? `${handCount} มือ` : status}
      hint="กำมือสองข้างแล้วเขย่าต่อเนื่อง ให้ปุดตันวิ่งเข้าเส้นชัย — หยุดเขย่าเมื่อไหร่ ปุดตันหยุดวิ่ง"
    >
      <StageFrame loading={!tracking && !cameraError} error={cameraError}>
        <div
          style={{
            position: "relative",
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
      </StageFrame>
    </GameShell>
  );
}
