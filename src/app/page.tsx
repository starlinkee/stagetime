"use client";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { HOUSE_SIZE } from "@/components/LobbyDecor";
import { type RoomZone, RoomStage } from "@/components/RoomStage";
import { HOUSE_ROOM_SLUG, ROOMS } from "@/lib/rooms";
import { getSupabase } from "@/lib/supabase";
import { useMyProfile } from "@/lib/useProfile";
import { useRoomOccupancy } from "@/lib/useRoomOccupancy";
import { useSession } from "@/lib/useSession";
import { SCREEN_H, SCREEN_W, worldH, worldW } from "@realtime-shared/constants";

/**
 * Kwadraty pokoi w lobby: ułożone w kółko wokół wspólnego środka, zamiast kolumny pomodoro +
 * osobnego rzędu timer/shop/arena. Środek i promień muszą być identyczne w
 * realtime-server/shared/rooms.ts's buildLobbyZoneRects — patrz komentarz tam.
 */
const RING_CENTER_X = SCREEN_W / 2;
const RING_CENTER_Y = 550;
const RING_RADIUS = 320;

/** Rozmiar kwadratu pomodoro vs. pozostałych (timer/shop/arena) — jak w starym układzie. */
const POMODORO_ZONE_W = 180;
const POMODORO_ZONE_H = 100;
const WIDE_ZONE_W = 220;
const WIDE_ZONE_H = 140;

/** Kąt (stopnie, 0° = w prawo, rosnąco zgodnie z ruchem wskazówek zegara) każdego pokoju na
 * okręgu — sześć pokoi rozstawionych równo co 60°, zaczynając od góry. */
const RING_ANGLES_DEG: Record<string, number> = {
  "25-5": -90,
  "20-5": -30,
  "50-10": 30,
  arena: 90,
  shop: 150,
  timer: 210,
};

function ringPos(slug: string, w: number, h: number) {
  const rad = (RING_ANGLES_DEG[slug] * Math.PI) / 180;
  return {
    x: RING_CENTER_X + RING_RADIUS * Math.cos(rad) - w / 2,
    y: RING_CENTER_Y + RING_RADIUS * Math.sin(rad) - h / 2,
  };
}

const pomodoroRooms = ROOMS.filter((r) => r.kind === "pomodoro");
const stopwatchRooms = ROOMS.filter((r) => r.kind === "stopwatch");
const shopRooms = ROOMS.filter((r) => r.kind === "shop");
const arenaRooms = ROOMS.filter((r) => r.kind === "arena");

const pomodoroZones: RoomZone[] = pomodoroRooms.map((r) => ({
  slug: r.slug,
  name: r.name,
  ...ringPos(r.slug, POMODORO_ZONE_W, POMODORO_ZONE_H),
  w: POMODORO_ZONE_W,
  h: POMODORO_ZONE_H,
  color: r.color,
  phase: { workMin: r.workMin, breakMin: r.breakMin },
}));

const stopwatchZones: RoomZone[] = stopwatchRooms.map((r) => ({
  slug: r.slug,
  name: "Timer",
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
}));
const shopZones: RoomZone[] = shopRooms.map((r) => ({
  slug: r.slug,
  name: "Shop",
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
  requiresAuth: true,
  noReward: true,
  badge: "shop",
}));

// Arena — a quick test room for a room-owned enemy everyone can fight (see ARENA_ROOM_SLUG in
// realtime-server/shared/constants.ts). Must match the "arena" branch in
// realtime-server/shared/rooms.ts's buildLobbyZoneRects exactly.
const arenaZones: RoomZone[] = arenaRooms.map((r) => ({
  slug: r.slug,
  name: "Arena",
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
  badge: "arena",
}));

// STU-56: portal to lobby2, a completely separate location — deliberately placed at a fixed
// corner of the world instead of via ringPos(), so it reads as "a different place" rather than
// another room door on the same ring. `noReward: true` (same flag Shop uses) suppresses the
// XP/coins reward text a normal room zone would otherwise show.
const LOBBY2_PORTAL_W = 220;
const LOBBY2_PORTAL_H = 140;
const lobby2PortalZone: RoomZone = {
  slug: "lobby2",
  name: "Lobby 2",
  x: worldW(true) - LOBBY2_PORTAL_W - 80,
  y: worldH(true) - LOBBY2_PORTAL_H - 80,
  w: LOBBY2_PORTAL_W,
  h: LOBBY2_PORTAL_H,
  color: "#0e7490",
  noReward: true,
};

// House: an empty room (src/lib/rooms.ts's HOUSE_ROOM_SLUG) entered through the decorative house
// sprite instead of a normal door. That sprite sits at a fixed spot in the world's outer margin —
// raw world coordinates (left:0, top:height/2-HOUSE_SIZE/2, see LobbyDecor.tsx) — while zones here
// are content-square-relative (RoomStage's toWorldZone adds CONTENT_OX/OY before using them), so
// subtract that same offset to land this zone on top of the sprite instead of in the ring. `hidden`
// (RoomStage.tsx) suppresses the usual box/name so it reads as walking into the house itself; the
// "E to enter room" prompt still shows once in range, same as any other door.
const HOUSE_PORTAL_W = 220;
const HOUSE_PORTAL_H = 140;
const HOUSE_CONTENT_OX = (worldW(true) - SCREEN_W) / 2;
const HOUSE_CONTENT_OY = (worldH(true) - SCREEN_H) / 2;
const housePortalZone: RoomZone = {
  slug: HOUSE_ROOM_SLUG,
  name: "House",
  x: HOUSE_SIZE / 2 - HOUSE_CONTENT_OX - HOUSE_PORTAL_W / 2,
  y: worldH(true) / 2 - HOUSE_CONTENT_OY - HOUSE_PORTAL_H / 2,
  w: HOUSE_PORTAL_W,
  h: HOUSE_PORTAL_H,
  hidden: true,
  noReward: true,
};

// Fountain of Wealth: donate coins into a room-scoped fund (see
// supabase/migrations/0052_fountain_of_wealth.sql). Hand-placed at the top of the ring, above all
// the pomodoro/timer/shop/arena doors, rather than via ringPos() — it isn't a navigable room, just
// a floor button (kind: "action", same pattern as the Shop's floor buttons in ShopRoom.tsx) that
// opens a donate dialog in place. `room_funds` is keyed by room slug so a future guild room can
// reuse the same fund mechanism (see AGENTS.md). `hidden` (RoomStage.tsx) suppresses the box/
// name/fund-total caption so only the fountain sprite (LobbyDecor.tsx) shows from a distance; the
// "E  Fountain of Wealth" / "Press E to interact" prompt (plus the fund total) appears centered on
// the character once in range, same mechanism as the always-hidden `kind: "action"` case below.
export const FOUNTAIN_ZONE_SLUG = "fountain-of-wealth";
const FOUNTAIN_ZONE_W = 220;
const FOUNTAIN_ZONE_H = 140;
const fountainZone: RoomZone = {
  slug: FOUNTAIN_ZONE_SLUG,
  name: "Fountain of Wealth",
  kind: "action",
  x: RING_CENTER_X - FOUNTAIN_ZONE_W / 2,
  y: -50,
  w: FOUNTAIN_ZONE_W,
  h: FOUNTAIN_ZONE_H,
  color: "#ca8a04",
  requiresAuth: true,
  noReward: true,
  hidden: true,
};

const LOBBY_ZONES: RoomZone[] = [
  fountainZone,
  housePortalZone,
  ...pomodoroZones,
  ...stopwatchZones,
  ...shopZones,
  ...arenaZones,
  lobby2PortalZone,
];

// STU-56: derived from LOBBY_ZONES (not the full ROOMS roster) so this only ever subscribes to
// occupancy for zones actually shown on this page — ROOMS now also lists lobby2's own rooms
// (arena-2/timer-2), which have no zone here. Including the portal's own "lobby2" slug shows a
// live occupant count for lobby2 itself, same as any other zone. Action zones (the fountain) are
// excluded — they're floor buttons inside the lobby itself, not a separate room with its own
// occupancy channel.
const ROOM_SLUGS = LOBBY_ZONES.filter((z) => (z.kind ?? "nav") === "nav").map((z) => z.slug);

export default function Home() {
  const occupancy = useRoomOccupancy(ROOM_SLUGS);
  const { coins, donateToFountain } = useMyProfile();
  const { ready: sessionReady, session } = useSession();
  const signedIn = Boolean(session?.user);
  const [fountainOpen, setFountainOpen] = useState(false);
  const [fountainAmount, setFountainAmount] = useState("0");
  const [fountainBusy, setFountainBusy] = useState(false);
  const [fountainError, setFountainError] = useState<string | null>(null);
  const [fundTotal, setFundTotal] = useState<number | null>(null);
  const [myDonated, setMyDonated] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Fund total is public (see room_funds' select policy) — fetched once on mount so the "already
  // donated" caption under the zone (see fountainZoneWithCaption below) shows without opening the
  // dialog, and refetched whenever the dialog opens so it stays accurate if others donated meanwhile.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;
    void sb
      .from("room_funds")
      .select("total")
      .eq("room", FOUNTAIN_ZONE_SLUG)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFundTotal(Number(data?.total ?? 0));
      });
    return () => {
      cancelled = true;
    };
  }, [fountainOpen]);

  // Own donated-so-far total (room_fund_donors, added in 0054) — restricted by RLS to the caller's
  // own row, so this only ever shows the signed-in player their own history, not anyone else's.
  // Refetched whenever the dialog opens for the same reason as fundTotal above.
  useEffect(() => {
    if (!fountainOpen || !session?.user) {
      setMyDonated(null);
      return;
    }
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;
    void sb
      .from("room_fund_donors")
      .select("total")
      .eq("room", FOUNTAIN_ZONE_SLUG)
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMyDonated(Number(data?.total ?? 0));
      });
    return () => {
      cancelled = true;
    };
  }, [fountainOpen, session?.user]);

  const zones = useMemo(
    () =>
      LOBBY_ZONES.map((z) =>
        z.slug === FOUNTAIN_ZONE_SLUG && fundTotal !== null
          ? { ...z, caption: `Donated: ${fundTotal.toFixed(1)} coins` }
          : z,
      ),
    [fundTotal],
  );

  const onZoneAction = useCallback((slug: string) => {
    if (slug === FOUNTAIN_ZONE_SLUG) {
      setFountainAmount("0");
      setFountainError(null);
      setFountainOpen(true);
    }
  }, []);

  const closeFountain = useCallback(() => {
    if (fountainBusy) return;
    setFountainOpen(false);
    setFountainError(null);
  }, [fountainBusy]);

  const parsedAmount = Number(fountainAmount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= coins;

  const donate = useCallback(async () => {
    if (fountainBusy || !validAmount) return;
    setFountainBusy(true);
    setFountainError(null);
    const result = await donateToFountain(parsedAmount);
    setFountainBusy(false);
    if (!result.ok) {
      setFountainError(result.error);
      return;
    }
    setFundTotal(result.fundTotal);
    setMyDonated(result.myTotal);
    setFountainAmount("0");
    setToast(`Donated ${parsedAmount} coins to the Fountain of Wealth!`);
  }, [fountainBusy, validAmount, donateToFountain, parsedAmount]);

  return (
    <>
    <Suspense fallback={null}>
      <RoomStage roomSlug="lobby" zones={zones} occupancy={occupancy} onZoneAction={onZoneAction} />
    </Suspense>
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-2 p-8 pt-16 text-center">
      <div className="flex items-center justify-center gap-3">
        <h1 className="title-64 text-5xl sm:text-6xl">StudyQuest.Party</h1>
      </div>
      {toast && <p className="text-sm font-semibold text-emerald-400">{toast}</p>}
    </main>
    {fountainOpen && sessionReady && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Fountain of Wealth"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      >
        <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">Fountain of Wealth</h2>
            {signedIn && (
              <span className="flex flex-col gap-1 text-right text-sm text-zinc-400">
                Your balance
                <span className="text-lg font-semibold text-zinc-100">{coins.toFixed(1)} coins</span>
              </span>
            )}
          </div>
          <p className="mb-3 text-center text-sm text-zinc-400">
            Toss your coins into the fountain and make a wish. Who knows what it&apos;s good for —
            but every coin that goes in stays in for good, growing the shared fund for whatever
            comes next.
          </p>
          {fundTotal !== null && (
            <p className="mb-1 text-center text-sm text-amber-400">
              Fund total so far: <span className="font-semibold">{fundTotal.toFixed(1)} coins</span>
            </p>
          )}
          {signedIn && myDonated !== null && (
            <p className="mb-5 text-center text-sm text-zinc-400">
              You&apos;ve donated <span className="font-semibold text-zinc-200">{myDonated.toFixed(1)} coins</span>
            </p>
          )}
          {signedIn ? (
            <>
              <div className="mb-3 flex items-center justify-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={coins}
                  step="any"
                  value={fountainAmount}
                  onChange={(e) => setFountainAmount(e.target.value)}
                  disabled={fountainBusy}
                  className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-sm text-zinc-100 disabled:opacity-50"
                />
                <span className="text-sm text-zinc-500">/ {coins.toFixed(1)} coins</span>
              </div>
              {!validAmount && parsedAmount > coins && (
                <p className="mb-3 text-center text-sm text-rose-400">You don&apos;t have that many coins.</p>
              )}
              {fountainError && <p className="mb-3 text-center text-sm text-rose-400">{fountainError}</p>}
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={closeFountain}
                  disabled={fountainBusy}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void donate()}
                  disabled={fountainBusy || !validAmount}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fountainBusy ? "Processing…" : "Donate"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-5 text-center text-sm text-rose-400">You must be signed in to donate.</p>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={closeFountain}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
