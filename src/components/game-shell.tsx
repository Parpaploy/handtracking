import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface GameShellProps {
  title: string;
  subtitle: string;
  tracking: boolean;
  statusText: string;
  toolbar?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export default function GameShell({
  title,
  subtitle,
  tracking,
  statusText,
  toolbar,
  hint,
  children,
}: GameShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-paper font-body text-ink">
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-6 pt-6">
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

        <div className="leading-tight">
          <div className="font-display text-lg font-medium">{title}</div>
          <div className="text-[10px] tracking-[0.25em] text-stone">
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

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8">
        {children}
        {hint && (
          <div className="text-center text-[13px] leading-relaxed text-ink-soft">
            {hint}
          </div>
        )}
      </main>
    </div>
  );
}

function friendlyCameraError(raw: string): { title: string; detail: string } {
  const msg = raw.replace(/^❌\s*(Error:\s*)?/, "");
  if (/NotAllowedError|Permission denied|denied/i.test(msg)) {
    return {
      title: "ยังไม่ได้อนุญาตให้ใช้กล้อง",
      detail:
        "กดไอคอนกล้องตรงแถบที่อยู่ของเบราว์เซอร์ เลือกอนุญาต แล้วกดลองใหม่",
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

/** White craft-frame around the camera stage, with loading/error overlays. */
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
    <div className="rounded-[24px] bg-surface p-2 ring-1 ring-stone-light shadow-[0_18px_40px_-24px_rgba(67,61,53,0.4)]">
      <div className="relative overflow-hidden rounded-2xl bg-ink-deep">
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
