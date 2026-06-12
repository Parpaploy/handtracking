import { useRef } from "react";
import { usePuzzleHandTracking } from "../hooks/use-puzzle-hand-tracking";

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
              background: isTracking && handCount > 0 ? "#4ade80" : "#555",
              boxShadow:
                isTracking && handCount > 0 ? "0 0 6px #4ade80" : "none",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 12, color: "#555" }}>
            {isTracking ? `${handCount} มือ` : status}
          </span>
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#444",
            letterSpacing: 1,
            fontWeight: 600,
          }}
        >
          {phase === "resize" ? "PHASE 1 — FRAME" : "PHASE 2 — PUZZLE"}
        </span>
      </div>

      <div
        style={{ fontSize: 13, color: "#aaa", marginBottom: 10, minHeight: 20 }}
      >
        {solved
          ? `🎉 เรียงสำเร็จใน ${moveCount} moves!`
          : phase === "resize"
            ? "จีบนิ้วโป้ง+ชี้ สองมือ · ดึงมุมทะแยงเพื่อปรับกรอบ · ค้างไว้ 3 วิเพื่อยืนยัน"
            : "ใช้ปลายนิ้วชี้แตะกระเบื้องข้างช่องว่างเพื่อเลื่อน"}
      </div>

      {phase === "resize" && (
        <div
          style={{
            height: 3,
            background: "#222",
            borderRadius: 2,
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${holdProgress * 100}%`,
              background: holdProgress >= 1 ? "#FFD700" : "#5DCAA5",
              borderRadius: 2,
              transition: "width 0.1s, background 0.3s",
            }}
          />
        </div>
      )}

      {phase === "puzzle" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, color: "#555" }}>moves:</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#5DCAA5" }}>
            {moveCount}
          </span>
          <button
            onClick={resetPuzzle}
            style={{
              marginLeft: "auto",
              padding: "4px 14px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "transparent",
              color: "#666",
              cursor: "pointer",
              fontSize: 12,
              letterSpacing: 1,
            }}
          >
            Reset
          </button>
        </div>
      )}

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
          ref={camCanvasRef}
          style={{
            display: "block",
            width: 640,
            height: 480,
            background: "#000",
          }}
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
      </div>

      <div style={{ fontSize: 11, color: "#333", marginTop: 10 }}>
        {phase === "resize"
          ? "มือซ้าย (ส้ม) · มือขวา (ฟ้า) · จีบนิ้วโป้ง+ชี้ แล้วดึงแต่ละมุม"
          : "มือซ้าย (ส้ม) · มือขวา (ฟ้า) · นิ้วชี้เพื่อเลื่อนกระเบื้อง"}
      </div>
    </div>
  );
}
