/** Small "🪙 N" pill showing a copper coin balance (see src/lib/coins.ts). */
export function CoinBadge({ coins, className = "" }: { coins: number; className?: string }) {
  return (
    <span
      title={`${coins} copper coin${coins === 1 ? "" : "s"}`}
      className={`inline-flex items-center gap-0.5 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-orange-300 ${className}`}
    >
      🪙{coins}
    </span>
  );
}
