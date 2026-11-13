import { useEffect, useState } from "react";

/**
 * Hide-all-UI mode shared by every page (like foggy-glass): a button
 * toggles it, H toggles from the keyboard, Esc brings the UI back.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHideUi() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "h" || e.key === "H" || e.key === "ห") {
        setHidden((h) => !h);
      } else if (e.key === "Escape") {
        setHidden(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return [hidden, setHidden] as const;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Pill button for a toolbar: hides the UI. */
export function HideUiButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="ซ่อน UI (กด H)"
      aria-label="ซ่อน UI"
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-stone-light bg-surface px-3 py-2 text-xs text-ink-soft transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
    >
      <EyeIcon off />
      ซ่อน UI
    </button>
  );
}

/** Small corner button shown while the UI is hidden: brings it back.
 *  Faint until hovered so it doesn't spoil the view. */
export function ShowUiButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="แสดง UI (กด H หรือ Esc)"
      aria-label="แสดง UI"
      className="absolute top-3 right-3 z-30 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-black/35 text-white/80 opacity-40 backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <EyeIcon off={false} />
    </button>
  );
}

/** For pages without the game header: a hide button in the top-right
 *  corner, swapped for the faint show button while hidden. */
export function UiCorner({
  hidden,
  setHidden,
  className = "top-3 right-3",
}: {
  hidden: boolean;
  setHidden: (h: boolean) => void;
  /** Where the hide button sits (Tailwind position classes). */
  className?: string;
}) {
  if (hidden) return <ShowUiButton onClick={() => setHidden(false)} />;
  return (
    <div className={`absolute z-30 ${className}`}>
      <HideUiButton onClick={() => setHidden(true)} />
    </div>
  );
}
