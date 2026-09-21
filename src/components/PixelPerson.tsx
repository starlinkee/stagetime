import { DEFAULT_COLOR } from "@/lib/useProfile";

/** Sylwetka 8×12: B — kolor postaci, E — oczy. */
const SPRITE = [
  "..BBBB..",
  ".BBBBBB.",
  ".BEBBEB.",
  ".BBBBBB.",
  "..BBBB..",
  ".BBBBBB.",
  "B.BBBB.B",
  "B.BBBB.B",
  "..BBBB..",
  "..B..B..",
  "..B..B..",
  ".BB..BB.",
];

/** Jedna postać pixelart w podanym kolorze. */
export function PixelPerson({
  color = DEFAULT_COLOR,
  label,
  size = 4,
}: {
  color?: string;
  label?: string;
  /** Rozmiar jednego piksela w px. */
  size?: number;
}) {
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
      {SPRITE.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={cell === "E" ? "#18181b" : color}
            />
          ),
        ),
      )}
    </svg>
  );
}
