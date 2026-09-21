import { DEFAULT_COLOR } from "@/lib/useProfile";

/** Sylwetka 8×12: B — kolor postaci, L/D — światło/cień, F — stopy; oczy dorysowujemy zależnie od kierunku. */
const FRONT_TOP = [
  "..BBBB..",
  ".BLLBBB.",
  ".BLBBBD.",
  ".BBBBBD.",
  "..BBBD..",
];
/** Tułów (rzędy 0–3 klatki postoju) — w chodzie zostaje sztywny, rusza się tylko nogami i podskokiem. */
const FRONT_BODY = [".BBBBBD.", "B.BBBD.D", "B.BLBD.D", "..DDDD.."];
/** Nogi (3 rzędy): postój oraz podniesiona lewa/prawa stopa. */
const FRONT_LEGS = {
  idle: ["..B..D..", "..B..D..", ".FF..FF."],
  l: ["..B..D..", "..F..D..", ".....FF."],
  r: ["..B..D..", "..B..F..", ".FF....."],
};
/** Profil (E/W): węższy tułów, ręka pośrodku, nogi razem — bez „dziubka”. */
const SIDE_TOP = [
  "..BBBB..",
  ".BLLBBB.",
  ".BLBBBD.",
  ".BBBBBD.",
  "..BBBD..",
];
const SIDE_BODY = ["..BLBD..", "..BBBD..", "..BBBD..", "..DDDD.."];
const SIDE_LEGS = {
  idle: ["..BD.D..", "..BD.D..", ".FFF.FF."],
  l: ["..BD.D..", "..BD.FF.", "..FF...."],
  r: ["..BD.D..", ".FF..D..", "....FF.."],
};

/**
 * Cykl chodu: krok (ciało niżej o 1 px) → noga w przejściu (ciało wyżej) → krok → druga noga.
 * Podskok zawsze o całe piksele, stopy stoją na ziemi.
 */
const WALK: { legs: "idle" | "l" | "r"; dy: number }[] = [
  { legs: "idle", dy: 1 },
  { legs: "l", dy: 0 },
  { legs: "idle", dy: 1 },
  { legs: "r", dy: 0 },
];

/** Kierunki co 45° zgodnie z ruchem wskazówek zegara od prawej: E, SE, S, SW, W, NW, N, NE. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const DIR_DOWN: Dir = 2;

/** Kolumny oczu (rząd 2) dla każdego kierunku; z tyłu oczu nie widać. */
const EYES: number[][] = [[5], [3, 5], [2, 5], [2, 4], [2], [2], [], [5]];

const SHADES: Record<string, (c: string) => string> = {
  B: (c) => c,
  L: (c) => `color-mix(in srgb, ${c} 65%, white)`,
  D: (c) => `color-mix(in srgb, ${c} 72%, black)`,
  F: (c) => `color-mix(in srgb, ${c} 45%, black)`,
};

function Rows({ rows, color, y0 }: { rows: string[]; color: string; y0: number }) {
  return (
    <>
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y + y0} width={1} height={1} style={{ fill: SHADES[cell](color) }} />
          ),
        ),
      )}
    </>
  );
}

/** Jedna postać pixelart w podanym kolorze; `walking` włącza animację rąk i nóg. */
export function PixelPerson({
  color = DEFAULT_COLOR,
  label,
  size = 4,
  dir = DIR_DOWN,
  walking = false,
}: {
  color?: string;
  label?: string;
  /** Rozmiar jednego piksela w px. */
  size?: number;
  /** W którą stronę patrzy postać. */
  dir?: Dir;
  /** Czy postać idzie (animacja chodu). */
  walking?: boolean;
}) {
  const side = dir === 0 || dir === 4;
  const top = side ? SIDE_TOP : FRONT_TOP;
  const bodyRows = side ? SIDE_BODY : FRONT_BODY;
  const legSet = side ? SIDE_LEGS : FRONT_LEGS;

  const body = (
    <>
      <Rows rows={top} color={color} y0={0} />
      {EYES[dir].map((x) => (
        <rect key={`eye-${x}`} x={x} y={2} width={1} height={1} fill="#18181b" />
      ))}
      <Rows rows={bodyRows} color={color} y0={5} />
    </>
  );

  return (
    <svg
      width={8 * size}
      height={12 * size}
      viewBox="0 0 8 12"
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? "Character"}
    >
      {label && <title>{label}</title>}
      {walking ? (
        WALK.map((f, i) => (
          <g key={i} className={`pp-f pp-f${i}`}>
            <Rows rows={legSet[f.legs]} color={color} y0={9} />
            <g transform={`translate(0 ${f.dy})`}>{body}</g>
          </g>
        ))
      ) : (
        <>
          <Rows rows={legSet.idle} color={color} y0={9} />
          {body}
        </>
      )}
    </svg>
  );
}
