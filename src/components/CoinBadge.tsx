/**
 * Copper coin glyph as inline SVG rather than the 🪙 emoji — emoji glyphs fall back to
 * mismatched/monochrome system fonts on some browsers and OSes, so we render our own to
 * guarantee a consistent copper-colored coin everywhere.
 */
export function CoinIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="7" fill="#d97706" stroke="#92400e" strokeWidth="1" />
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="#fbbf24" strokeWidth="1" />
    </svg>
  );
}

/** Small "🪙 N" pill showing a copper coin balance (see src/lib/coins.ts). */
export function CoinBadge({ coins, className = "" }: { coins: number; className?: string }) {
  return (
    <span
      title={`${coins.toFixed(1)} copper coin${coins === 1 ? "" : "s"}`}
      className={`inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-orange-300 ${className}`}
    >
      <CoinIcon className="h-2.5 w-2.5" />
      {coins.toFixed(1)}
    </span>
  );
}
