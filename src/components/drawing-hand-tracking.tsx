import { useRef } from "react";
import { useDrawingHandTracking } from "../hooks/use-drawing-hand-tracking";

// const COLORS = [
//   { label: "ขาว", value: "#FFFFFF" },
//   { label: "แดง", value: "#FF4D4D" },
//   { label: "ส้ม", value: "#FF9900" },
//   { label: "เหลือง", value: "#FFE600" },
//   { label: "เขียว", value: "#4DFF91" },
//   { label: "ฟ้า", value: "#4DC8FF" },
//   { label: "ม่วง", value: "#B44DFF" },
//   { label: "ชมพู", value: "#FF4DB8" },
// ];

export default function DrawHandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { status, handCount, drawMode, clearDrawing } = useDrawingHandTracking(
    videoRef,
    canvasRef,
  );

  const modeLabel = {
    draw: "✏️ กำลังวาด",
    erase: "🧹 กำลังลบ",
    idle: "✋ พร้อมใช้งาน",
  };

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        padding: 16,
        background: "#111",
        minHeight: "100vh",
        color: "#fff",
      }}
      className="relative flex flex-col justify-center items-center"
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
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
        <span style={{ fontSize: 13, color: "#aaa" }}>มือ: {handCount}</span>
        <span
          style={{
            fontSize: 13,
            padding: "2px 10px",
            borderRadius: 99,
            background:
              drawMode === "draw"
                ? "#3b82f6"
                : drawMode === "erase"
                  ? "#ef4444"
                  : "#444",
          }}
        >
          {modeLabel[drawMode]}
        </span>
        <button
          onClick={clearDrawing}
          style={{
            marginLeft: "auto",
            fontSize: 13,
            padding: "4px 14px",
            borderRadius: 8,
            border: "1px solid #555",
            background: "#222",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          🗑 ล้างทั้งหมด
        </button>
      </div>

      {/* <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "#888", marginRight: 4 }}>
          สีเส้น:
        </span>
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => setStrokeColor(c.value)}
            title={c.label}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: c.value,
              border:
                strokeColor === c.value
                  ? "3px solid #fff"
                  : "2px solid rgba(255,255,255,0.15)",
              cursor: "pointer",
              transition: "transform 0.1s",
              transform: strokeColor === c.value ? "scale(1.25)" : "scale(1)",
            }}
          />
        ))}

        <label
          title="สีกำหนดเอง"
          style={{ cursor: "pointer", position: "relative" }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background:
                "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              border: "2px solid rgba(255,255,255,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            ＋
          </div>
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => setStrokeColor(e.target.value)}
            style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
          />
        </label>

        <div
          style={{
            marginLeft: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#888",
          }}
        >
          <div
            style={{
              width: 40,
              height: 6,
              borderRadius: 99,
              background: strokeColor,
            }}
          />
          <span>{strokeColor}</span>
        </div>
      </div> */}

      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 12,
          fontSize: 12,
          color: "#666",
        }}
      >
        <span>🤌 มือซ้าย: นิ้วชี้+โป้งแตะ = วาด</span>
        <span>🤏 มือขวา: นิ้วชี้+โป้งแตะ = ลบ</span>
      </div>

      <div
        style={{
          position: "relative",
          display: "inline-block",
          borderRadius: 12,
          overflow: "hidden",
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
    </div>
  );
}
