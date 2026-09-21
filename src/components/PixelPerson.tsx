import { DEFAULT_COLOR } from "@/lib/useProfile";

/** Sylwetka 8×12: B — kolor postaci, L/D — światło/cień, F — stopy; oczy dorysowujemy zależnie od kierunku. */
const FRONT_TOP = [
  "..BBBB..",
  ".BLLBBB.",
  ".BLBBBD.",
  ".BBBBBD.",
  "..BBBD..",
];
/** Klatki przodu/tyłu: postój oraz dwie fazy chodu (naprzemienne ręce i nogi). */
const FRONT = {
  idle: [".BBBBBD.", "B.BBBD.D", "B.BLBD.D", "..DDDD..", "..B..D..", "..B..D..", ".FF..FF."],
  a: ["BBBBBBD.", "B.BBBD..", "..BLBD.D", "..DDDD.D", "..B..D..", "..B...D.", ".FF..FF."],
  b: [".BBBBBDD", "..BBBD.D", "B.BLBD..", "B.DDDD..", "..B..D..", ".B...D..", ".FF..FF."],
};
/** Profil (E/W): węższy tułów, ręka pośrodku, nogi razem — bez „dziubka”. */
const SIDE_TOP = [
  "..BBBB..",
  ".BLLBBB.",
  ".BLBBBD.",
  ".BBBBBD.",
  "..BBBD..",
];
const SIDE = {
  idle: ["..BLBD..", "..BBBD..", "..BBBD..", "..DDDD..", "..BD.D..", "..BD.D..", ".FFF.FF."],
  a: ["..BBBBB.", "..BLBDB.", "..BBBD..", "..DDDD..", "..BB.D..", ".BB..DD.", ".FF...FF"],
  b: [".BBBBB..", ".BDLBD..", "..BBBD..", "..DDDD..", "..BB.D..", "..BD.B..", "..FF.FF."],
};

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

function Frame({ rows, color }: { rows: string[]; color: string }) {
  return (
    <>
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y + 5} width={1} height={1} style={{ fill: SHADES[cell](color) }} />
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
  const set = side ? SIDE : FRONT;
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
      <g className={walking ? "pp-bob" : undefined}>
        {top.flatMap((row, y) =>
          [...row].map((cell, x) =>
            cell === "." ? null : (
              <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} style={{ fill: SHADES[cell](color) }} />
            ),
          ),
        )}
        {EYES[dir].map((x) => (
          <rect key={`eye-${x}`} x={x} y={2} width={1} height={1} fill="#18181b" />
        ))}
        {walking ? (
          <>
            <g className="pp-fa">
              <Frame rows={set.a} color={color} />
            </g>
            <g className="pp-fb">
              <Frame rows={set.b} color={color} />
            </g>
          </>
        ) : (
          <Frame rows={set.idle} color={color} />
        )}
      </g>
    </svg>
  );
}
