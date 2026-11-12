import { useRef } from "react";
import { useRunHandTracking } from "../hooks/use-run-hand-tracking";
import RunnerOverlay from "./runner-overlay";
import GameShell, { StageFrame } from "./game-shell";
import { useElementSize } from "../lib/stage";

export default function RunHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(stageRef);

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
      hint="กำมืออย่างน้อยสองข้างแล้วเขย่าต่อเนื่อง (เล่นหลายคนช่วยกันได้) ให้ปุดตันวิ่งเข้าเส้นชัย — หยุดเขย่าเมื่อไหร่ ปุดตันหยุดวิ่ง"
    >
      <StageFrame loading={!tracking && !cameraError} error={cameraError}>
        <div ref={stageRef} className="absolute inset-0">
          <video ref={videoRef} style={{ display: "none" }} playsInline />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block h-full w-full"
          />
          {width > 0 && height > 0 && (
            <RunnerOverlay
              runnerPosRef={runnerPosRef}
              runnerWonRef={runnerWonRef}
              runnerSpeedRef={runnerSpeedRef}
              width={width}
              height={height}
            />
          )}
        </div>
      </StageFrame>
    </GameShell>
  );
}
