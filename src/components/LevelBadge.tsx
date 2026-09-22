import { levelFromXp } from "@/lib/xp";

/** Small "Lv. N" pill shown next to a nickname; hover shows XP progress toward the next level. */
export function LevelBadge({ xp, className = "" }: { xp: number; className?: string }) {
  const { level, intoLevel, forNextLevel } = levelFromXp(xp);
  return (
    <span
      title={`${intoLevel}/${forNextLevel} XP to level ${level + 1}`}
      className={`inline-flex items-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-300 ${className}`}
    >
      Lv.{level}
    </span>
  );
}
