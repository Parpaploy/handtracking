import { useRef } from "react";
import { usePianoHandTracking } from "../hooks/use-piano-hand-tracking";

export default function PianoHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount, activeNoteNames, octave, setOctave } =
    usePianoHandTracking(videoRef, canvasRef);

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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: status === "tracking..." ? "#4ade80" : "#555",
              boxShadow: status === "tracking..." ? "0 0 6px #4ade80" : "none",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 12, color: "#555" }}>
            {status === "tracking..." ? `${handCount} มือ` : status}
          </span>
        </div>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "#444", letterSpacing: 1 }}>
            OCT
          </span>
          <button onClick={() => setOctave((o) => o - 1)} style={btnStyle}>
            −
          </button>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              minWidth: 14,
              textAlign: "center",
              color: "#aaa",
            }}
          >
            {octave}
          </span>
          <button onClick={() => setOctave((o) => o + 1)} style={btnStyle}>
            +
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          minHeight: 44,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        {activeNoteNames.length === 0 ? (
          <span style={{ fontSize: 13, color: "#333", letterSpacing: 2 }}>
            — — —
          </span>
        ) : (
          activeNoteNames.map((name, i) => (
            <span
              key={i}
              style={{
                fontSize: 18,
                fontWeight: 700,
                padding: "6px 18px",
                borderRadius: 99,
                background:
                  "linear-gradient(135deg, rgba(93,202,165,0.15), rgba(93,202,165,0.05))",
                border: "1px solid rgba(93,202,165,0.4)",
                color: "#5DCAA5",
                letterSpacing: 1,
                transition: "all 0.1s",
              }}
            >
              {name}
            </span>
          ))
        )}
      </div>

      <div
        style={{
          position: "relative",
          display: "inline-block",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #222",
        }}
      >
        <video ref={videoRef} style={{ display: "none" }} playsInline />
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: 720,
            height: 560,
            background: "#000",
          }}
        />
      </div>

      <div style={{ fontSize: 11, color: "#333", marginTop: 10 }}>
        มือซ้าย (ส้ม) · มือขวา (ฟ้า) · โค้งนิ้วลงเพื่อกด
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: "1px solid #333",
  background: "transparent",
  color: "#666",
  cursor: "pointer",
  fontSize: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};
