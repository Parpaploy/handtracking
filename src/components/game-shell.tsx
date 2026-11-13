import { useEffect, useState, type ReactNode } from "react";
import { perfStats } from "../lib/hand-detector";
import { Link } from "react-router-dom";

interface GameShellProps {
  title: string;
  subtitle: string;
  tracking: boolean;
  statusText: string;
  toolbar?: ReactNode;
  /** Extra floating content shown under the header (game status, notes…). */
  topBar?: ReactNode;
  hint?: ReactNode;
  /** Put the hint at the bottom instead of under the header. */
  hintAtBottom?: boolean;
  /** Dark gradient behind the header (off when the canvas draws UI there). */
  headerShade?: boolean;
  children: ReactNode;
}

/**
 * Full-screen game layout: the camera stage fills the whole viewport and
 * the header / hint float above it.
 */
export default function GameShell({
  title,
  subtitle,
  tracking,
  statusText,
  toolbar,
  topBar,
  hint,
  hintAtBottom = false,
  headerShade = true,
  children,
}: GameShellProps) {
  const hintEl = hint && (
    <div className="rounded-full bg-ink-deep/60 px-4 py-1.5 text-center text-[13px] leading-relaxed text-paper/90 backdrop-blur-sm">
      {hint}
    </div>
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink-deep font-body text-ink">
      <main className="absolute inset-0">{children}</main>
      {SHOW_PERF && <PerfHud />}

      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2.5 ${headerShade ? "bg-linear-to-b from-ink-deep/55 to-transparent" : ""} px-4 pt-4 pb-10`}
      >
        <header className="pointer-events-auto flex w-full flex-wrap items-center gap-x-4 gap-y-3">
          <Link
            to="/"
            className="group inline-flex items-center gap-2 rounded-full border border-stone-light bg-surface px-4 py-2 text-sm transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
          >
            <span
              aria-hidden
              className="transition-transform duration-200 group-hover:-translate-x-0.5"
            >
              ←
            </span>
            กลับ
          </Link>

          <div className="leading-tight text-paper [text-shadow:0_1px_6px_rgba(0,0,0,0.55)]">
            <div className="font-display text-lg font-medium">{title}</div>
            <div className="text-[10px] tracking-[0.25em] text-paper/70">
              {subtitle}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            {toolbar}
            <div className="flex items-center gap-2 rounded-full border border-stone-light bg-surface px-3.5 py-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  tracking ? "animate-pulse-soft bg-clay" : "bg-stone-light"
                }`}
              />
              <span className="text-xs text-ink-soft">{statusText}</span>
            </div>
          </div>
        </header>

        {topBar && <div className="pointer-events-auto">{topBar}</div>}

        {!hintAtBottom && hintEl}
      </div>

      {hintAtBottom && hintEl && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4">
          {hintEl}
        </div>
      )}
    </div>
  );
}

function friendlyCameraError(raw: string): { title: string; detail: string } {
  const msg = raw.replace(/^❌\s*(Error:\s*)?/, "");
  if (/NotAllowedError|Permission denied|denied/i.test(msg)) {
    return {
      title: "ยังไม่ได้อนุญาตให้ใช้กล้อง",
      detail: "กดไอคอนกล้องตรงแถบที่อยู่ของเบราว์เซอร์ เลือกอนุญาต แล้วกดลองใหม่",
    };
  }
  if (/NotFoundError|DevicesNotFound/i.test(msg)) {
    return {
      title: "ไม่พบกล้องในเครื่องนี้",
      detail: "ต่อกล้องหรือเปิดกล้องของเครื่องก่อน แล้วกดลองใหม่",
    };
  }
  if (/NotReadableError|TrackStart/i.test(msg)) {
    return {
      title: "กล้องถูกใช้งานอยู่",
      detail: "ปิดแอปหรือแท็บอื่นที่กำลังใช้กล้อง แล้วกดลองใหม่",
    };
  }
  return { title: "เปิดกล้องไม่ได้", detail: msg };
}

/** `?debug` in the URL: live speed numbers in the corner. */
function PerfHud() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-lg bg-black/70 px-3 py-2 font-mono text-[11px] leading-5 text-white">
      <div>fps {perfStats.fps.toFixed(0)}</div>
      <div>detect {perfStats.detectMs.toFixed(1)} ms</div>
      <div>
        {perfStats.delegate} · max {perfStats.numHands} มือ
        {perfStats.downgraded ? " (ลดอัตโนมัติ)" : ""}
      </div>
      <div>กล้อง {perfStats.camera}</div>
      <div className="max-w-64 truncate opacity-70">{perfStats.renderer}</div>
      <div>โหมด {perfStats.level}</div>
    </div>
  );
}

const SHOW_PERF =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debug");

/** Full-screen camera stage, with loading/error overlays. Children
 *  (canvases) should fill it with `absolute inset-0 h-full w-full`. */
export function StageFrame({
  children,
  loading = false,
  error = null,
}: {
  children: ReactNode;
  loading?: boolean;
  error?: string | null;
}) {
  const friendly = error ? friendlyCameraError(error) : null;

  return (
    <div className="absolute inset-0">
      <div className="relative h-full w-full overflow-hidden bg-ink-deep">
        {children}
        {loading && !friendly && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="h-2.5 w-2.5 animate-pulse-soft rounded-full bg-clay" />
            <span className="text-sm text-paper/80">
              กำลังเตรียมกล้องและตัวจับมือ…
            </span>
          </div>
        )}
        {friendly && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <span className="font-display text-lg font-medium text-paper">
              {friendly.title}
            </span>
            <span className="max-w-sm text-sm leading-relaxed text-paper/70">
              {friendly.detail}
            </span>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 cursor-pointer rounded-full bg-clay px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              ลองใหม่
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
