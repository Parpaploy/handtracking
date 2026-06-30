import { Link } from "react-router-dom";

const BONE = "#b1ada1";
const BONE_FADE = "#ddd9cf";
const ACTIVE = "#c15f3c";

function GlyphPinch() {
  return (
    <svg width="44" height="44" viewBox="0 0 56 56" fill="none" aria-hidden>
      <path
        d="M28,50 L20,34 M28,50 L27,32 M28,50 L33,34"
        stroke={BONE_FADE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <polyline
        points="27,32 27,21 26,14"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="33,34 34,25 34,19"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="28,50 15,41 18,30"
        stroke={ACTIVE}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="20,34 18,30"
        stroke={ACTIVE}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28" cy="50" r="2.2" fill={BONE} />
      <circle cx="27" cy="21" r="1.8" fill={BONE} />
      <circle cx="26" cy="14" r="1.8" fill={BONE} />
      <circle cx="34" cy="25" r="1.8" fill={BONE} />
      <circle cx="34" cy="19" r="1.8" fill={BONE} />
      <circle cx="15" cy="41" r="1.8" fill={ACTIVE} />
      <circle cx="18" cy="30" r="2.5" fill={ACTIVE} />
      <circle
        cx="18"
        cy="30"
        r="7.5"
        stroke={ACTIVE}
        strokeWidth="1.5"
        opacity="0.4"
      />
    </svg>
  );
}

function GlyphPress() {
  return (
    <svg width="44" height="44" viewBox="0 0 56 56" fill="none" aria-hidden>
      <line
        x1="16"
        y1="40"
        x2="16"
        y2="50"
        stroke={BONE_FADE}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <line
        x1="27"
        y1="43"
        x2="27"
        y2="50"
        stroke={BONE}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <line
        x1="38"
        y1="40"
        x2="38"
        y2="50"
        stroke={BONE_FADE}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M14,16 q14,-12 28,0"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M14,16 q-1,6 2,10"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M42,16 q1,6 -2,10"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M28,11 q1,12 -1,23"
        stroke={ACTIVE}
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <circle cx="28" cy="22" r="1.8" fill={ACTIVE} />
      <circle cx="27" cy="34" r="2.5" fill={ACTIVE} />
      <path
        d="M19,30 q-3,2 -2.5,5.5"
        stroke={ACTIVE}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M35,30 q3,2 2.5,5.5"
        stroke={ACTIVE}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

function GlyphPoint() {
  return (
    <svg width="44" height="44" viewBox="0 0 56 56" fill="none" aria-hidden>
      <rect
        x="8"
        y="10"
        width="14"
        height="14"
        rx="3"
        stroke={BONE_FADE}
        strokeWidth="2"
        strokeDasharray="3 3.5"
      />
      <rect
        x="27"
        y="10"
        width="14"
        height="14"
        rx="3"
        stroke={BONE}
        strokeWidth="2.5"
      />
      <path
        d="M26,17 h-6 m2.5,-3 l-3,3 l3,3"
        stroke={ACTIVE}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <polyline
        points="44,50 38,39 34,27"
        stroke={ACTIVE}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="38" cy="39" r="1.8" fill={ACTIVE} />
      <circle cx="34" cy="27" r="2.5" fill={ACTIVE} />
    </svg>
  );
}

function GlyphFist() {
  return (
    <svg width="44" height="44" viewBox="0 0 56 56" fill="none" aria-hidden>
      <path
        d="M19,30 q0,-7 9,-7 t9,7 v4 q0,8 -9,8 t-9,-8 z"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="22" cy="27" r="1.8" fill={BONE} />
      <circle cx="26" cy="25.5" r="1.8" fill={BONE} />
      <circle cx="30" cy="25.5" r="1.8" fill={BONE} />
      <circle cx="34" cy="27" r="1.8" fill={BONE} />
      <path
        d="M21,36 q7,4.5 14,0"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M12,24 q-4,8 0,16"
        stroke={ACTIVE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7,21 q-5.5,11 0,22"
        stroke={ACTIVE}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M44,24 q4,8 0,16"
        stroke={ACTIVE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M49,21 q5.5,11 0,22"
        stroke={ACTIVE}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}

function GlyphSteam() {
  return (
    <svg width="44" height="44" viewBox="0 0 56 56" fill="none" aria-hidden>
      <path
        d="M19,34 q0,-7 9,-7 t9,7 v3 q0,8 -9,8 t-9,-8 z"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="22" cy="31" r="1.8" fill={BONE} />
      <circle cx="26" cy="29.5" r="1.8" fill={BONE} />
      <circle cx="30" cy="29.5" r="1.8" fill={BONE} />
      <circle cx="34" cy="31" r="1.8" fill={BONE} />
      <path
        d="M21,40 q7,4.5 14,0"
        stroke={BONE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M22,24 q-3,-3 0,-6.5 q3,-3.5 0,-7"
        stroke={ACTIVE}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M30,22 q-3,-3 0,-6.5 q3,-3.5 0,-7"
        stroke={ACTIVE}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

const GAMES = [
  {
    path: "/drawing",
    name: "วาดรูป",
    desc: "จีบนิ้วแล้ววาดกลางอากาศ",
    glyph: <GlyphPinch />,
  },
  {
    path: "/piano",
    name: "เปียโน",
    desc: "โค้งนิ้วลงเพื่อกดคีย์",
    glyph: <GlyphPress />,
  },
  {
    path: "/puzzle",
    name: "เรียงภาพ",
    desc: "จีบแล้วลากกระเบื้องให้ครบภาพ",
    glyph: <GlyphPoint />,
  },
  {
    path: "/runner",
    name: "วิ่งสุดแรง",
    desc: "กำมือเขย่าให้ปุดตันวิ่ง",
    glyph: <GlyphFist />,
  },
  {
    path: "/steam",
    name: "ไอน้ำ",
    desc: "กำมือปล่อยไอน้ำขึ้นฟ้า",
    glyph: <GlyphSteam />,
  },
];

export default function Menu() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-12 font-body text-ink">
      <main className="w-full max-w-xl text-center">
        <h1 className="font-display text-3xl font-medium md:text-4xl">
          เล่นด้วยมือ
        </h1>
        <p className="mt-3 text-[15px] text-ink-soft">
          ขยับมือหน้ากล้อง แล้วเล่นได้เลย
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {GAMES.map((g) => (
            <Link
              key={g.path}
              to={g.path}
              className="group flex flex-col items-center gap-3 rounded-3xl border border-stone-light bg-surface px-6 py-8 shadow-[0_16px_40px_-14px_rgba(67,61,53,0.38)] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-clay/40 hover:shadow-[0_18px_40px_-16px_rgba(193,95,60,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
            >
              <span className="flex size-20 items-center justify-center rounded-full bg-clay/10 transition-colors duration-200 group-hover:bg-clay/20">
                <span className="transition-transform duration-200 ease-out group-hover:-rotate-6">
                  {g.glyph}
                </span>
              </span>
              <span className="font-display text-lg font-medium">{g.name}</span>
              <span className="text-[13px] leading-relaxed text-ink-soft">
                {g.desc}
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-xs text-stone">
          ภาพจากกล้องอยู่ในเครื่องคุณ ไม่ถูกส่งไปไหน
        </p>
      </main>
    </div>
  );
}
