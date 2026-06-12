import { useRef } from "react";
import { usePianoHandTracking } from "../hooks/use-piano-hand-tracking";
import GameShell, { StageFrame } from "./game-shell";

export default function PianoHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount, activeNoteNames, octave, setOctave } =
    usePianoHandTracking(videoRef, canvasRef);

  const tracking = status === "tracking...";
  const cameraError = status.startsWith("❌") ? status : null;

  return (
    <GameShell
      title="เปียโน"
      subtitle="PIANO"
      tracking={tracking}
      statusText={tracking ? `${handCount} มือ` : status}
      toolbar={
        <div className="flex items-center gap-1 rounded-full border border-stone-light bg-surface py-1 pr-1 pl-3">
          <span className="mr-1 text-[10px] tracking-[0.2em] text-stone">
            OCT
          </span>
          <button
            onClick={() => setOctave((o) => o - 1)}
            className="h-7 w-7 cursor-pointer rounded-full text-sm text-ink-soft transition-colors hover:bg-paper hover:text-clay-deep"
          >
            −
          </button>
          <span className="w-5 text-center text-sm font-medium">{octave}</span>
          <button
            onClick={() => setOctave((o) => o + 1)}
            className="h-7 w-7 cursor-pointer rounded-full text-sm text-ink-soft transition-colors hover:bg-paper hover:text-clay-deep"
          >
            +
          </button>
        </div>
      }
      hint="มือซ้ายและมือขวาลอยเหนือคีย์ · โค้งนิ้วลงเพื่อกดโน้ต"
    >
      <div className="flex min-h-11 flex-wrap items-center justify-center gap-2">
        {activeNoteNames.length === 0 ? (
          <span className="text-sm tracking-[0.4em] text-stone">···</span>
        ) : (
          activeNoteNames.map((name, i) => (
            <span
              key={i}
              className="rounded-full border border-clay/35 bg-clay/10 px-4 py-1 font-display text-lg font-medium tracking-wide text-clay-deep"
            >
              {name}
            </span>
          ))
        )}
      </div>

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
