/**
 * Shared classes for the small trigger buttons in the app header (layout.tsx): Admin, Ideas,
 * Sound, About, Help, Idea. Flat toolbar style — no shadow/ring, unlike the floating popover
 * panels these buttons open, which keep their own elevated look. Text-only, no icons — the
 * font size itself shrinks on narrow windows (via text-[11px] sm:text-xs) instead of hiding
 * or wrapping the label.
 */
export const HEADER_BUTTON_CLASS =
  "rounded-md bg-zinc-800/60 px-2 py-1.5 text-[11px] sm:text-xs font-medium text-zinc-300 whitespace-nowrap transition-colors hover:bg-zinc-700 hover:text-zinc-100";
