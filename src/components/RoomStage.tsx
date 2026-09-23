"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DungeonBackground } from "@/components/DungeonBackground";
import { LevelBadge } from "@/components/LevelBadge";
import { DIR_DOWN, type Dir } from "@/components/PixelPerson";
import { PlayerSprite } from "@/components/PlayerSprite";
import { getAdminSettings, isAdminUiEnabled } from "@/lib/adminSettings";
import { setHowToPlay } from "@/lib/howToPlay";
import { roomLabel } from "@/lib/rooms";
import { getSupabase } from "@/lib/supabase";
import { formatMs, getTimerState, type Phase } from "@/lib/timer";
import { useAccountLock } from "@/lib/useAccountLock";
import { MAX_BODY, useChat, type ChatMessage } from "@/lib/useChat";
import { safeColor, useMyProfile } from "@/lib/useProfile";
import { useServerNow } from "@/lib/useServerClock";
import { useSession } from "@/lib/useSession";
import { coinsForMinutes } from "@/lib/coins";
import { useStudyXp } from "@/lib/useStudyXp";
import { xpForMinutes } from "@/lib/xp";
import type { ClientMessage, HitEvent, ServerBall, ServerMessage } from "@realtime-shared/types";
import {
  BALL_SPEED,
  CHARGE_MS,
  DASH_COOLDOWN_MS,
  DASH_DISTANCE_MULT,
  DASH_MS,
  DASH_TELEPORT_AT_MS,
  DIRS,
  DIR_OF,
  GHOST_OPACITY,
  HITBOX_H,
  HITBOX_OFFSET_X,
  HITBOX_OFFSET_Y,
  HITBOX_W,
  HIT_PAD,
  IMMUNE_OPACITY,
  KILL_GOLD_REWARD,
  KILL_XP_REWARD,
  MAX_HP,
  ORB_R_MAX,
  ORB_R_MIN,
  PERSON_H,
  PERSON_W,
  ROLL_COOLDOWN_MS,
  ROLL_MS,
  ROLL_SPEED_MULT,
  SCREEN_H,
  SCREEN_W,
  STAMINA_COST_PER_SHOT,
  STAMINA_MAX,
  STAMINA_REGEN_PER_SEC,
  STRIKE_MS,
  STRIKE_R,
  STRIKE_REACH,
  TAG_H,
  TICK_MS,
  DEFAULT_PLAYER_SPEED,
  worldH,
  worldW,
} from "@realtime-shared/constants";
import { clampPos } from "@realtime-shared/physics";

/** Kolor etykiety fazy pod kwadratem pokoju: praca na czerwono (nie da się teraz wejść), przerwa na zielono. */
const PHASE_COLOR = { work: "#ef4444", break: "#22c55e" } as const;

/** Pisanie w polu/textarea/select nie może być przechwycone przez sterowanie postacią ani skrótem otwierającym czat. */
function isTypingTarget(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Ekran startowy / rozmiar mapy (SCREEN_W/H, worldW/worldH), rozmiar postaci (PERSON_W/H) i
 * miejsce na podpis (TAG_H) importowane z realtime-server/shared/constants.ts, jedynego miejsca,
 * które je definiuje — serwer ruchu liczy nimi clamp granic mapy, więc redefiniowanie ich tu
 * osobno groziłoby cichym rozjazdem klient/serwer, dokładnie jak przy playerSpeed (patrz
 * clientSpeed niżej), tylko trudniejszym do zauważenia, bo dotyczyłoby samych granic ruchu, a nie
 * tylko jego prędkości.
 *
 * Cała mapa: w lobby 2× szersza i 2× wyższa niż ekran (4 ekrany łącznie, 4× powierzchnia) — reszta
 * poza startowym ekranem jest pusta, chodząc od startu w stronę krawędzi kamera ją odsłania, dopóki
 * nie trafi na koniec mapy (patrz applyCamera niżej). Pojedynczy pokój jest 4× mniejszy (mapa =
 * ekran, jak dawniej) — nie ma tam po co odkrywać pustki dookoła.
 */
/** Prędkość gracza w jednostkach świata na sekundę — domyślna albo nadpisana z panelu admina, patrz playerSpeed w src/lib/adminSettings.ts. */
const playerSpeed = () => getAdminSettings().playerSpeed;
/** Minimalny odstęp losowego miejsca startu w pokoju od krawędzi ekranu. */
const SPAWN_MARGIN = 80;
const NO_NAME = "[no-name]";
/** Klucz w sessionStorage strefy, z której gracz właśnie wyszedł — patrz `fromSlug` niżej. */
const SPAWN_FROM_KEY = "stagetime:spawnFrom";
/**
 * Zmiana pokoju (router.push) odmontowuje i montuje RoomStage od nowa — jeśli gracz cały czas
 * trzyma E, nowa instancja od razu widziałaby ją jako wciśniętą (dzięki auto-repeat klawiatury)
 * i natychmiast zaczęłaby odliczać wejście/wyjście w nowym pokoju, dając efekt migania
 * wchodzę-wychodzę. Ta zmienna żyje poza komponentem, więc przetrwa remount: E musi zostać
 * realnie puszczone (keyup), zanim znowu policzy się jako wciśnięte.
 */
let eKeyLockedAcrossRooms = false;
/**
 * Najczęściej co ile ms wysyłamy własną pozycję/input. Zsynchronizowane z TICK_MS
 * (realtime-server/shared/constants.ts) — dawniej to było niezależne 60ms, które biło w
 * nieregularnej fazie z 50ms tickiem serwera i pogłębiało widoczne korekty pozycji (patrz
 * RECONCILE_HZ niżej).
 */
const SEND_EVERY = TICK_MS;

/**
 * Reconciliation (patrz WS "state" handler i tick() niżej): serwer jest jedynym źródłem prawdy o
 * naszej pozycji, ale zamiast co broadcast (20/s) twardo nadpisywać lokalną, przewidywaną
 * pozycję jego wartością — co przy 60 kl/s renderowania wygląda jak drganie/cofanie się co
 * ~50ms — domykamy różnicę stopniowo, klatka po klatce. Duży błąd (dash, spawn, reconnect)
 * nadal ląduje natychmiast, bo wygładzanie skoku na drugi koniec mapy wyglądałoby jak ślizganie.
 */
const RECONCILE_SNAP_PX = 80;
/** Jak szybko (1/s) domykamy mały błąd korekty — patrz alpha w tick(). */
const RECONCILE_HZ = 12;

/**
 * Serwer walidujący ruch (realtime-server/, patrz docs/stateful_server_plan.md) — ustawiony
 * tylko na tej gałęzi/deployu podglądowym. Bez tej zmiennej zachowanie jest identyczne jak
 * wcześniej: cały kod z nią związany w tym pliku jest wtedy pomijany.
 */
const REALTIME_SERVER_URL = process.env.NEXT_PUBLIC_REALTIME_SERVER_URL || null;

/**
 * Prędkość, jaką liczy własna predykcja klienta. Na gałęzi z realtime-server to NIE MOŻE być
 * `playerSpeed()` (panel admina, localStorage) — panel nadpisuje ją tylko lokalnie w jednej
 * przeglądarce, a serwer zawsze liczy fizykę stałym `DEFAULT_PLAYER_SPEED`
 * (realtime-server/src/server.ts). Jeśli ktoś kiedyś ruszył suwak "Prędkość gracza" w panelu
 * admina na tej przeglądarce, klient i serwer po cichu liczyły ruch dwiema różnymi prędkościami
 * — rozjazd rósł z każdą sekundą trzymania klawisza i był najbardziej widoczny na końcu ruchu
 * (patrz reconciliation w tick()), bo to wtedy lokalna predykcja przestawała go maskować.
 * Bez serwera ruchu (stary tryb peer-to-peer) panel admina nadal działa normalnie.
 */
const clientSpeed = () => (REALTIME_SERVER_URL ? DEFAULT_PLAYER_SPEED : playerSpeed());

/** Jak długo wisi dymek z wiadomością nad postacią, zanim zniknie sam. */
const BUBBLE_MS = 6000;

/**
 * Jak długo wisi popup "+1 🪙 · +XP" nad postacią po co-minutowym tick-u nagrody, zanim go
 * usuniemy ze stanu (musi być >= czasu animacji pp-reward w globals.css, żeby fade dograł do końca).
 */
const REWARD_MS = 1500;

/** Jak długo wisi ekran "Congratulations" po zakończeniu fazy work, zanim wszystkich wyrzuci do lobby. */
const CONGRATS_MS = 10_000;

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

// DIRS/DIR_OF (direction vectors, movement → facing) plus all combat tuning (CHARGE_MS, ROLL_*,
// DASH_*, ORB_R_*, BALL_SPEED, STRIKE_*, HIT_PAD) live in realtime-server/shared/constants.ts (see
// docs/combat_sync_plan.md, Faza F1) — imported above, not redefined here, so this client and the
// server can't silently drift the way movement constants briefly did before that migration's own
// A2. DIR_OF's cells are typed as plain numbers there (shared with server code that has no
// dependency on this component's own `Dir` type), so reads of it below are cast `as Dir`.
/**
 * Faza F4: once the combat server owns hit decisions, this client no longer judges its own
 * fire/strike locally — but still shows it immediately (not waiting for a round trip) as a
 * *predicted* visual, replaced by the server's own broadcast (at most BROADCAST_MS later, see
 * realtime-server/shared/constants.ts) which is what everyone's flashes/particles actually key
 * off. See predictedRef below.
 *
 * A thrown ball's predicted preview used to be pruned by a short fixed timer instead of flying
 * under the same out-of-bounds rule ballsRef uses — on a real connection to Fly.io (round trip
 * routinely slower than localhost) that timer fired before the server's own broadcast of the same
 * shot ever arrived, reading as the shot stopping short and disappearing. It now flies the same
 * as a real ball and is handed off to ballsRef (see the "state" handler) once the server confirms
 * it, so it and the real ball are never both on screen for more than one broadcast.
 */

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  owner: string;
  /** Atak wręcz zamiast rzuconej kuli: stoi w miejscu i znika po `until` zamiast po opuszczeniu sceny. */
  melee?: boolean;
  until?: number;
};
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  born: number;
};

/** Pływający napis z obrażeniami nad postacią — "-N" na czerwono u trafionego, "N" na biało u
 * tego, kto trafił (patrz miejsce wypełniania w handlerze "state" WS). */
type DmgText = {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
};

/**
 * Floating "KILL" + reward text shown only on the killer's own screen, above the victim's corpse
 * (see the `killed` flag on HitEvent in realtime-server/shared/types.ts) — three stacked lines
 * ("KILL", "+N xp", "+N gold"), each its own entry sharing one `born` timestamp so they fade
 * together. `big` marks the "KILL" line for the larger font.
 */
type KillText = {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
  big?: boolean;
  /** Vertical stack offset (px) from the base "above the corpse" position — 0 for "KILL", then
   * increasing for each reward line stacked underneath it. */
  offset: number;
};

/** Czas trwania animacji uderzenia (ms) i życia odłamków kuli. */
const HIT_MS = 350;
const SHARD_MS = 500;
const DMG_TEXT_MS = 800;
/** "KILL" callout fades 3x slower than a regular damage number — long enough for the killer to
 * actually read the reward lines before they're gone. */
const KILL_TEXT_MS = DMG_TEXT_MS * 3;

/**
 * Kwadrat na scenie: przytrzymanie E przez ROOM_ENTER_MS stojąc w nim albo przenosi do innego
 * pokoju ("nav", domyślne — jak dotąd), albo wywołuje `onZoneAction` z tym `slug` bez nawigacji
 * ("action" — np. przyciski podłogowe stopera), i może się powtórzyć po puszczeniu E.
 */
export type RoomZone = {
  slug: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: "nav" | "action";
  /** Pokój pomodoro — długości faz i przesunięcie do wyliczenia etykiety "Work"/"Break" pod kwadratem. */
  phase?: { workMin: number; breakMin: number; offsetMs?: number };
  /** Kolor obrysu/wypełnienia kwadratu w lobby, odróżniający typ i wariant pokoju. */
  color?: string;
  /** Wejście tylko dla zalogowanych (np. Shop) — bez konta kwadrat pokazuje kłódkę zamiast numeru/nazwy. */
  requiresAuth?: boolean;
  /** Pokój nie daje XP ani coinów za obecność (np. Shop) — pod numerem nie pokazujemy nagrody. */
  noReward?: boolean;
};
/** Ile ms trzeba przytrzymać E stojąc w kwadracie, żeby go użyć — patrz roomEnterSec w src/lib/adminSettings.ts. */
const roomEnterMs = () => getAdminSettings().roomEnterSec * 1000;

/** Czy prostokąt postaci (px, py, PERSON_W×PERSON_H) nachodzi na kwadrat pokoju. */
function inZone(px: number, py: number, z: RoomZone) {
  return px < z.x + z.w && px + PERSON_W > z.x && py < z.y + z.h && py + PERSON_H > z.y;
}

/**
 * `zones` z propsów opisują układ we współrzędnych ekranu startowego (SCREEN_W×SCREEN_H) —
 * osoby definiujące pokój (np. TimerRoom.tsx) nie muszą wiedzieć nic o rozmiarze całej mapy. Tu
 * dodajemy ox/oy (0 w pokoju, gdzie mapa = ekran), żeby ten układ wylądował na środku mapy.
 */
const toWorldZone = (z: RoomZone, ox: number, oy: number): RoomZone => ({ ...z, x: z.x + ox, y: z.y + oy });

/** Czy koło (kula) styka się z hitboxem postaci o lewym górnym rogu (px, py). */
function hits(b: Ball, px: number, py: number) {
  const nx = Math.max(px + HITBOX_OFFSET_X - HIT_PAD, Math.min(b.x, px + HITBOX_OFFSET_X + HITBOX_W + HIT_PAD));
  const ny = Math.max(py + HITBOX_OFFSET_Y - HIT_PAD, Math.min(b.y, py + HITBOX_OFFSET_Y + HITBOX_H + HIT_PAD));
  return Math.hypot(b.x - nx, b.y - ny) <= b.r;
}

/** Wygląd osoby, rozgłaszany przez Presence. */
type Meta = {
  at: number;
  color: string;
  nick: string | null;
  /** Study XP (see src/lib/xp.ts) — shown as a level badge next to the name tag. */
  xp?: number;
  /** Id zalogowanego użytkownika (null bez konta) — jedno konto to jedna postać. */
  user?: string | null;
  x?: number;
  y?: number;
  d?: unknown;
};
/** Pozycja lewego górnego rogu postaci w jednostkach świata, plus kierunek i czy trwa przewrót (roll) / unik (dash). */
type Pos = {
  x: number;
  y: number;
  d: Dir;
  r?: boolean;
  dash?: boolean;
  /** HP/respawn/immunity — only set on the realtime-server branch (see REALTIME_SERVER_URL), from
   * PlayerState.hp/respawnAt/immuneUntil (realtime-server/shared/types.ts). */
  hp?: number;
  respawnAt?: number;
  immuneUntil?: number;
  /** Ghost position/facing while respawnAt is in the future — only meaningful then (see
   * PlayerState.gx/gy/gd's doc comment in realtime-server/shared/types.ts); the corpse stays
   * rendered at x/y/d for the same window. */
  gx?: number;
  gy?: number;
  gd?: Dir;
};
type Others = Record<string, Meta & Pos>;

const orbRadius = (p: number) => ORB_R_MIN + (ORB_R_MAX - ORB_R_MIN) * p;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const asDir = (d: unknown): Dir =>
  Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 7 ? (d as Dir) : DIR_DOWN;

/** Jak często (ms) zapisujemy pozycję w bazie, o ile się zmieniła. */
const SAVE_EVERY = 2000;

/** Ostatnia zapisana pozycja konta w pokoju (null: brak zapisu albo brak dostępu do bazy). */
async function fetchSpawn(userId: string, room: string): Promise<Pos | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("player_positions")
    .select("x, y, d")
    .eq("user_id", userId)
    .eq("room", room)
    .maybeSingle();
  if (error) {
    console.warn("player_positions select (see supabase/migrations/0004)", error);
    return null;
  }
  if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return null;
  return { ...clampPos(data.x, data.y, room === "lobby"), d: asDir(data.d) };
}

async function savePosition(userId: string, room: string, p: Pos) {
  const { error } = await getSupabase()
    ?.from("player_positions")
    .upsert(
      { user_id: userId, room, x: p.x, y: p.y, d: p.d, updated_at: new Date().toISOString() },
      { onConflict: "user_id,room" },
    ) ?? { error: null };
  if (error) console.warn("player_positions upsert (see supabase/migrations/0004)", error);
}

/**
 * Signed token realtime-server requires on WS `join` — proves `userId` to the movement server
 * instead of the client just asserting it (see /api/realtime/token and
 * docs/stateful_server_plan.md, Faza A / A1). `null` on any failure (offline, misconfigured
 * server): the caller then simply skips joining the movement server for this attempt, same as
 * REALTIME_SERVER_URL being unset.
 */
async function fetchRealtimeJoinToken(roomSlug: string, accessToken: string | null): Promise<string | null> {
  try {
    const res = await fetch("/api/realtime/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ roomSlug }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const token = data && typeof data === "object" && "token" in data ? (data as { token: unknown }).token : null;
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}

/** Środek kuli ładowanej nad głową postaci (nie wychodzi poza górną krawędź sceny). */
function orbAt(x: number, y: number, p: number) {
  const r = orbRadius(p);
  return { r, cx: x + PERSON_W / 2, cy: Math.max(r + 2, y - r - 4) };
}

/** Wypuszcza kulę znad postaci stojącej w (x, y) w kierunku d. */
function launch(balls: Ball[], x: number, y: number, d: Dir, p: number, color: string, owner: string) {
  const { r, cx, cy } = orbAt(x, y, p);
  const [ux, uy] = DIRS[d];
  const n = Math.hypot(ux, uy);
  balls.push({
    x: cx,
    y: cy,
    vx: (ux / n) * BALL_SPEED,
    vy: (uy / n) * BALL_SPEED,
    r,
    color,
    owner,
  });
}

/** Wypuszcza krótkozasięgowy hitbox ataku wręcz tuż przed postacią stojącą w (x, y), patrzącą w d. */
function strike(balls: Ball[], x: number, y: number, d: Dir, color: string, owner: string) {
  const [ux, uy] = DIRS[d];
  const n = Math.hypot(ux, uy) || 1;
  balls.push({
    x: x + PERSON_W / 2 + (ux / n) * STRIKE_REACH,
    y: y + PERSON_H / 2 + (uy / n) * STRIKE_REACH,
    vx: 0,
    vy: 0,
    r: STRIKE_R,
    color,
    owner,
    melee: true,
    until: performance.now() + STRIKE_MS,
  });
}

function drawOrb(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, glow: number) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 + glow * 18;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.4, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(24,24,27,0.5)";
  ctx.stroke();
  ctx.restore();
}

/**
 * Podpis nad postacią: poziom i nick albo [no-name]. `xp` undefined = gość (niezalogowany) —
 * pokazujemy szary "Lv.0" zamiast prawdziwego LevelBadge (STU-21), żeby było widać, że jeszcze
 * nie zbiera się XP, zamiast po prostu nic nie pokazywać obok nicku.
 */
function NameTag({ name, xp }: { name: string | null; xp?: number }) {
  return (
    <span
      className="absolute bottom-full left-1/2 mb-0.5 flex max-w-56 -translate-x-1/2 items-center gap-1 whitespace-nowrap text-base font-medium leading-5 text-zinc-700 dark:text-zinc-200"
      style={{ height: TAG_H - 2 }}
    >
      {xp !== undefined ? (
        <LevelBadge xp={xp} />
      ) : (
        <span
          title="Sign in to start earning XP"
          className="inline-flex items-center rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-400"
        >
          Lv.0
        </span>
      )}
      <span className="truncate">{name?.trim() || NO_NAME}</span>
    </span>
  );
}

/**
 * Popup "+1 🪙 · +0.2 XP" nad postacią po co-minutowym tick-u nagrody (patrz useStudyXp) — sam
 * znika po odegraniu animacji pp-reward (globals.css). `id` w key wymusza restart animacji, gdy
 * kolejny tick trafi zanim poprzedni popup zdąży zniknąć.
 */
function RewardPopup({ coins, xp, id }: { coins: number; xp: number; id: number }) {
  const parts = [coins > 0 && `+${coins} 🪙`, xp > 0 && `+${xp} XP`].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span
      key={id}
      className="pp-reward absolute bottom-full left-1/2 mb-5 whitespace-nowrap text-sm font-bold text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
    >
      {parts.join(" · ")}
    </span>
  );
}

/** Dymek nad postacią z jej ostatnią wiadomością — znika sam po BUBBLE_MS. */
function ChatBubble({ text }: { text: string }) {
  return (
    <div className="chat-fade absolute bottom-full left-1/2 mb-5 max-w-60 -translate-x-1/2 whitespace-pre-wrap break-words rounded-xl bg-white px-3 py-2 text-center text-sm text-zinc-900 shadow-lg after:absolute after:left-1/2 after:top-full after:-ml-1.5 after:border-4 after:border-transparent after:border-t-white">
      {text}
    </div>
  );
}

/**
 * Cały ekran jest sceną: własną postacią (biała bez konta, w kolorze profilu po zalogowaniu)
 * chodzi się strzałkami, a postaci wszystkich osób z pokoju są widoczne dla każdego.
 * Przytrzymana spacja ładuje nad postacią kulę (do 3 s), puszczona wystrzeliwuje ją w stronę,
 * w którą patrzy postać.
 */
export function RoomStage({
  roomSlug,
  zones = [],
  occupancy,
  spawnZoneSlug,
  onZoneAction,
  xpRunning = true,
  phase,
}: {
  roomSlug: string;
  zones?: RoomZone[];
  /** Ile osób jest naprawdę w każdym pokoju (patrz useRoomOccupancy) — etykieta pod numerem/kłódką. */
  occupancy?: Record<string, number>;
  /**
   * Czy naliczać XP w tej chwili (patrz useStudyXp) — domyślnie zawsze. Timer Room ustawia to
   * na `running` stopera: XP (0.1/5min) leci tylko, gdy stoper jest wystartowany, patrz
   * src/components/TimerRoom.tsx.
   */
  xpRunning?: boolean;
  /**
   * Faza TEGO pokoju (work/break) — gdy podana (pokój typu "pomodoro"), XP i coiny naliczają się
   * wyłącznie w fazie "work": przerwa (i czas oczekiwania przed startem pracy) nie daje nic.
   * useStudyXp resetuje zegar heartbeatu przy każdej zmianie tego gate'u (patrz `running` w
   * src/lib/useStudyXp.ts), więc po starcie pracy odliczanie realnie zaczyna się od zera, a nie
   * dolicza czas spędzony na przerwie.
   */
  phase?: { workMin: number; breakMin: number; offsetMs?: number };
  /**
   * Slug strefy z `zones`, w której zawsze — niezależnie od zapisanej w bazie pozycji — staje
   * postać, np. strefa wyjścia, żeby wejście do pokoju kończyło się dokładnie przy wyjściu i dało
   * się od razu wyjść, trzymając E w tym samym miejscu. Gdy nieustawiony, o strefę pyta się
   * parametru `from` w URL (patrz `effectiveSpawnZoneSlug` niżej) — tak lobby, w którym stref jest
   * wiele, wie, do której wrócić po wyjściu z konkretnego pokoju.
   */
  spawnZoneSlug?: string;
  /**
   * Wywoływane po przytrzymaniu E przez roomEnterMs() w strefie typu "action".
   * `pressedAt` (Date.now()) to chwila NACIŚNIĘCIA E, nie potwierdzenia — wywołujący może
   * liczyć skutek akcji od tego momentu, żeby czas trzymania nie wliczał się do wyniku.
   */
  onZoneAction?: (slug: string, pressedAt: number) => void;
}) {
  const router = useRouter();
  // Tylko lobby dostaje powiększoną (4× powierzchni) mapę z kamerą — pojedynczy pokój ma mapę
  // wielkości ekranu, jak dawniej (patrz worldW/worldH powyżej).
  const isLobby = roomSlug === "lobby";
  const WORLD_W = worldW(isLobby);
  const WORLD_H = worldH(isLobby);
  const CONTENT_OX = (WORLD_W - SCREEN_W) / 2;
  const CONTENT_OY = (WORLD_H - SCREEN_H) / 2;
  // Brak spawnZoneSlug (np. lobby, gdzie stref jest wiele) — bierzemy strefę odpowiadającą
  // pokojowi, z którego właśnie wyszliśmy (zapisaną w sessionStorage, patrz router.push niżej
  // w tym pliku). Czytamy i od razu czyścimy, żeby URL nigdy nie niósł tej informacji i żeby
  // odświeżenie strony / wejście bezpośrednim linkiem nie podchwyciło starej wartości.
  const [fromSlug] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.sessionStorage.getItem(SPAWN_FROM_KEY);
    window.sessionStorage.removeItem(SPAWN_FROM_KEY);
    return v;
  });
  const effectiveSpawnZoneSlug = spawnZoneSlug ?? (fromSlug && zones.some((z) => z.slug === fromSlug) ? fromSlug : undefined);
  const { ready, session } = useSession();
  // Czas serwera do etykiety fazy (work/break) pod kwadratami pokoi — ref, żeby pętla rysowania
  // (rAF, poza reactem) widziała najświeższą wartość bez przebudowy efektu.
  const serverNow = useServerNow();
  const serverNowRef = useRef(serverNow);
  useEffect(() => {
    serverNowRef.current = serverNow;
  }, [serverNow]);
  const profile = useMyProfile();
  const color = session ? profile.color : "#ffffff";
  const nick = session ? profile.nickname : null;
  const userId = session?.user.id ?? null;
  // Whether THIS room is currently in its "work" phase — null when the room has no pomodoro
  // phase (stopwatch/shop) or before the server clock is synced, in which case it doesn't gate
  // anything (see xpAccruing below).
  const roomPhase = phase && serverNow !== null ? getTimerState(serverNow, phase).phase : null;
  // Pokój bez `phase` (Timer Room, patrz src/components/TimerRoom.tsx) ma indywidualny stoper —
  // tick nagrody widzi tylko właściciel, nie jest rozgłaszany do innych w pokoju. Zdefiniowane tu
  // (przed xpAccruing), bo obie strony nowego podziału nagród (heartbeat vs lump sum niżej) go
  // potrzebują.
  const isSharedTick = phase !== undefined;
  // Credits XP for time spent in this room via the per-minute heartbeat (no-op in the lobby or
  // signed out) — see supabase/migrations/0010_xp.sql and 0014_timer_xp_rate.sql. Only for rooms
  // with no fixed pomodoro cycle (Timer Room/Shop, `isSharedTick` false): a pomodoro room instead
  // pays its whole session's XP/coins in one lump sum on the work→break transition below (see
  // supabase/migrations/0026_room_session_reward.sql) — `xpRunning` still gates the Timer Room's
  // own stopwatch-running condition. Own XP then updates live via useMyProfile's Realtime sub.
  const xpAccruing = !isSharedTick && xpRunning && (roomPhase === null || roomPhase === "work");
  // Work → break transition (this room only, never the lobby itself, which has no `phase`):
  // shows a "Congratulations" screen for CONGRATS_MS, then sends everyone in the room back to
  // the lobby, and (pomodoro rooms only) pays out the whole session's XP/coins in one lump sum —
  // see room_session_complete's doc comment in supabase/migrations/0026_room_session_reward.sql
  // for why this can't be claimed for a cycle you weren't actually present for. `roomPhase` is a
  // pure function of the server clock (see getTimerState), so every client watching the same room
  // sees the transition — and computes the same `cycle` number — at the same instant, without
  // needing a server broadcast for either.
  const prevRoomPhaseRef = useRef<Phase | null>(null);
  const [showCongrats, setShowCongrats] = useState(false);
  useEffect(() => {
    const prev = prevRoomPhaseRef.current;
    prevRoomPhaseRef.current = roomPhase;
    if (prev !== "work" || roomPhase !== "break") return;
    setShowCongrats(true);
    if (isSharedTick && userId && phase && serverNow !== null) {
      const cycle = getTimerState(serverNow, phase).cycle;
      const dXp = xpForMinutes(phase.workMin);
      const dCoins = coinsForMinutes(phase.workMin);
      void getSupabase()
        ?.rpc("room_session_complete", { p_room: roomSlug, p_cycle: cycle })
        .then(({ data, error }) => {
          if (error) {
            console.error("room_session_complete", error);
            return;
          }
          const row = (Array.isArray(data) ? data[0] : data) as { credited: boolean } | undefined;
          // `credited` false means this cycle was already paid out for this account (e.g. a
          // reconnect firing the effect twice) — no popup, no rebroadcast, nothing double-paid.
          if (!row?.credited) return;
          triggerReward("me", dCoins, dXp);
          channelRef.current?.send({
            type: "broadcast",
            event: "reward",
            payload: { k: keyRef.current, coins: dCoins, xp: dXp },
          });
        });
    }
  }, [roomPhase]);
  useEffect(() => {
    if (!showCongrats) return;
    const timer = setTimeout(() => {
      window.sessionStorage.setItem(SPAWN_FROM_KEY, roomSlug);
      router.push("/");
    }, CONGRATS_MS);
    return () => clearTimeout(timer);
  }, [showCongrats, roomSlug, router]);
  // Explicit "Leave room" button (see JSX below) — the only way out of a pomodoro room during its
  // "work" phase now that movement (and so the walk-to-the-exit-zone E-hold flow) is frozen for
  // the whole phase (see AGENTS.md's realtime-server section / isFrozen in
  // realtime-server/src/server.ts). Confirms first when leaving would forfeit the session's
  // reward — during "work" itself, since the lump sum only ever pays out on the work→break
  // transition above; leaving during "break" costs nothing, so no confirmation needed then.
  const handleLeaveRoom = () => {
    if (isSharedTick && phase && roomPhase === "work") {
      const ok = window.confirm(
        `Leaving now forfeits the +${xpForMinutes(phase.workMin)} XP and +${coinsForMinutes(phase.workMin)} coins for this work session. Leave anyway?`,
      );
      if (!ok) return;
    }
    window.sessionStorage.setItem(SPAWN_FROM_KEY, roomSlug);
    router.push("/");
  };

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const personRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [others, setOthers] = useState<Others>({});
  // Klucz tej karty w kanale; pozycje innych trzymamy osobno od Presence. Stały przez cały
  // czas życia komponentu (nie per-efekt), żeby ten sam klucz mógł posłużyć zarówno kanałowi
  // Supabase, jak i (na gałęzi podglądowej) serwerowi ruchu — patrz REALTIME_SERVER_URL.
  const [netKey] = useState(() => crypto.randomUUID());
  const keyRef = useRef("");
  const posRef = useRef<Record<string, Pos>>({});
  const metaRef = useRef<Meta>({ at: 0, color, nick, xp: profile.xp, user: userId });
  // Popupy "+1 🪙 · +XP" nad postaciami po co-minutowym tick-u nagrody (patrz useStudyXp niżej) —
  // `id` rośnie przy każdym tick-u, żeby RewardPopup dostał nowy key i animacja pp-reward wystartowała
  // od nowa, nawet gdy poprzedni popup tej samej osoby jeszcze wisi.
  const [rewards, setRewards] = useState<Record<string, { coins: number; xp: number; id: number }>>({});
  const rewardTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rewardIdRef = useRef(0);
  const triggerReward = (k: string, coins: number, xp: number) => {
    if (coins <= 0 && xp <= 0) return;
    rewardIdRef.current += 1;
    setRewards((r) => ({ ...r, [k]: { coins, xp, id: rewardIdRef.current } }));
    clearTimeout(rewardTimers.current[k]);
    rewardTimers.current[k] = setTimeout(() => {
      setRewards((r) => {
        const rest = { ...r };
        delete rest[k];
        return rest;
      });
    }, REWARD_MS);
  };
  useEffect(() => {
    const timers = rewardTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);
  // Poprzednie totale z heartbeatu (useStudyXp) — do wyliczenia delty przy kolejnym tick-u; null
  // dopóki nie przyszedł pierwszy (p_reset) heartbeat, który tylko synchronizuje zegar.
  const prevStudyRef = useRef<{ xp: number; coins: number } | null>(null);
  // isSharedTick is defined earlier (next to xpAccruing) — this heartbeat path is now only ever
  // "running" (xpAccruing true) for the Timer Room, where isSharedTick is always false, so the
  // broadcast below never actually fires for a pomodoro room's own lump-sum reward.
  useStudyXp(roomSlug, xpAccruing, (u, credited) => {
    const prev = prevStudyRef.current;
    prevStudyRef.current = { xp: u.xp, coins: u.coins };
    if (!credited || !prev) return;
    const dCoins = Math.max(0, Math.round((u.coins - prev.coins) * 100) / 100);
    const dXp = Math.max(0, Math.round((u.xp - prev.xp) * 100) / 100);
    if (dCoins <= 0 && dXp <= 0) return;
    triggerReward("me", dCoins, dXp);
    if (isSharedTick) {
      channelRef.current?.send({
        type: "broadcast",
        event: "reward",
        payload: { k: keyRef.current, coins: dCoins, xp: dXp },
      });
    }
  });
  // Czy ta karta steruje postacią; false, gdy nowsza karta tego konta (w dowolnym pokoju) przejęła konto.
  const activeRef = useRef(true);
  const { superseded, reclaim } = useAccountLock(userId);
  // Pozycja z bazy czeka tu na najbliższą klatkę pętli ruchu.
  const spawnRef = useRef<Pos | null>(null);
  // Zapisu pozycji nie wolno zacząć przed wczytaniem starej — inaczej losowy start ją nadpisze.
  const spawnLoadedRef = useRef(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Czerwony komunikat po odmowie wejścia (np. trwa faza work) — znika sam po kilku sekundach.
  const [entryError, setEntryError] = useState<string | null>(null);
  const entryErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Stan połączenia z serwerem ruchu (realtime-server/) — tylko gdy REALTIME_SERVER_URL jest
   * ustawiony (patrz Faza B / B1 w docs/stateful_server_plan.md). "connecting" to pierwsza próba
   * po zamontowaniu (nie pokazujemy dla niej banera — to nie jest "reconnecting", tylko normalny
   * start); "reconnecting" to próba po zerwanym połączeniu, z automatycznym retry z backoffem —
   * to jedyny stan pokazujący baner w UI.
   */
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const myPos = useRef<Pos>({
    ...clampPos(WORLD_W / 2, WORLD_H / 2, isLobby),
    d: DIR_DOWN,
  });
  const [myDir, setMyDir] = useState<Dir>(DIR_DOWN);
  const [myWalking, setMyWalking] = useState(false);
  const [myRolling, setMyRolling] = useState(false);
  const [myDashing, setMyDashing] = useState(false);
  // HP/respawn/immunity — updated from the server's own "state" broadcast (see the WS message
  // handler below), never predicted locally: unlike movement, there's nothing useful to predict
  // here, and the server is broadcasting at BROADCAST_MS anyway.
  const [myHp, setMyHp] = useState(MAX_HP);
  // Fire stamina — same "server broadcasts, we just display" rule as myHp above, for the green
  // meter under the health bar (see the JSX below). `myStaminaMax` isn't STAMINA_MAX: it's this
  // connection's own stats.staminaMax (see PlayerState.staminaMax's doc comment in
  // realtime-server/shared/types.ts), which a future character/item bonus can raise per player.
  const [myStamina, setMyStamina] = useState(STAMINA_MAX);
  const [myStaminaMax, setMyStaminaMax] = useState(STAMINA_MAX);
  /** Written to directly from tick() every frame (see predictedStamina there) instead of through
   * setMyStamina, so the fast-changing "12/40" label tracks client-predicted regen without forcing
   * a React re-render 60x/sec — only the DOM text node changes, and only when the rounded value
   * actually moves. */
  const staminaTextRef = useRef<HTMLSpanElement>(null);
  const [myRespawnAt, setMyRespawnAt] = useState(0);
  /** Mirrors PlayerState.immuneUntil for the rAF tick loop below (see its `person.style.opacity`
   * line) — that loop reads refs every frame instead of depending on React state/re-renders. */
  const myImmuneUntilRef = useRef(0);
  /** Mirrors myRespawnAt for the same reason: tick() (a rAF loop, not a React re-render) needs to
   * know every frame whether this player is currently a ghost, to reconcile against the server's
   * gx/gy/gd instead of x/y/d — see PlayerState.gx/gy/gd's doc comment in
   * realtime-server/shared/types.ts. */
  const myRespawnAtRef = useRef(0);
  /** This player's own corpse — frozen at the death spot (server's x/y/d, which stop moving the
   * moment respawnAt is set — see the isDead(conn) branch of the movement loop in
   * realtime-server/src/server.ts) — rendered separately from `personRef`, which becomes the
   * controllable ghost for the same window. null while alive. */
  const [myCorpse, setMyCorpse] = useState<{ x: number; y: number; d: Dir } | null>(null);
  const myCorpseRef = useRef<{ x: number; y: number; d: Dir } | null>(null);
  // A React-render-safe "now" (Date.now() can't be called directly during render, see
  // react-hooks/purity) for the respawn countdown and others' immunity opacity below — ticks
  // while REALTIME_SERVER_URL is set, since either can happen at any time, not just while dead.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!REALTIME_SERVER_URL) return;
    const id = setInterval(() => setNowTick(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const respawnRemainingSec = myRespawnAt > 0 ? Math.max(0, Math.ceil((myRespawnAt - nowTick) / 1000)) : 0;
  // Kto z innych właśnie się porusza (do animacji chodu) i timery wygaszania.
  const [walkers, setWalkers] = useState<Record<string, boolean>>({});
  const walkTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ballsRef = useRef<Ball[]>([]);
  /** Mirrors the connect effect's local `ws` so the color/nick-change effect below (a separate
   * effect, doesn't close over that one's local variable) can push a live `profile` update instead
   * of only sending the color realtime-server saw at the original `join` — otherwise a color
   * fetched asynchronously after that join (see useProfile's DEFAULT_COLOR fallback) would leave
   * every ball this player throws stuck showing the placeholder color forever. */
  const realtimeWsRef = useRef<WebSocket | null>(null);
  /**
   * Faza F4 (docs/combat_sync_plan.md): only populated when REALTIME_SERVER_URL is set. Holds the
   * shooter's own just-fired ball/strike for instant local feedback — never checked against
   * anyone's position, purely visual, and pruned by `until` (PREDICT_MS/STRIKE_MS) regardless of
   * whether the server's own broadcast of the same shot has arrived yet. `ballsRef` itself is, in
   * that mode, replaced wholesale by the server's ball list on every `state` message instead of
   * being simulated/hit-tested locally — see the WS message handler and tick() below.
   */
  const predictedRef = useRef<Ball[]>([]);
  const shardsRef = useRef<Shard[]>([]);
  const dmgTextRef = useRef<DmgText[]>([]);
  const killTextRef = useRef<KillText[]>([]);
  /** Kiedy (performance.now) dana osoba dostała kulą: klucz → czas; własna pod "me". */
  const hitRef = useRef<Record<string, number>>({});
  /** Kto teraz ładuje kulę: klucz → początek ładowania (performance.now). */
  const chargingRef = useRef<Record<string, number>>({});
  const othersRef = useRef<Others>({});
  const colorRef = useRef(color);
  const userIdRef = useRef(userId);
  // Bieżąca sesja (access token) do nagłówka Authorization przy wejściu do pokoi wymagających
  // logowania (np. Shop) — ref, żeby fetch w pętli ruchu (efekt montowany raz) widział świeży token.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // Kwadraty pokoi (tylko na scenie z listą pokoi) — ref, żeby pętla ruchu nie zależała od propsa.
  const zonesRef = useRef(zones.map((z) => toWorldZone(z, CONTENT_OX, CONTENT_OY)));
  useEffect(() => {
    zonesRef.current = zones.map((z) => toWorldZone(z, CONTENT_OX, CONTENT_OY));
  }, [zones, CONTENT_OX, CONTENT_OY]);
  // Prawdziwa liczba osób w każdym pokoju (z useRoomOccupancy) — ref, żeby pętla rysowania
  // (rAF, poza reactem) widziała najświeższą wartość bez przebudowy efektu.
  const occupancyRef = useRef(occupancy);
  useEffect(() => {
    occupancyRef.current = occupancy;
  }, [occupancy]);
  // Callback dla stref "action" — ref, żeby pętla ruchu nie zależała od propsa.
  const onZoneActionRef = useRef(onZoneAction);
  useEffect(() => {
    onZoneActionRef.current = onZoneAction;
  }, [onZoneAction]);

  // Zalogowany zaczyna tam, gdzie zostawił postać; kanał pokoju czeka na tę pozycję,
  // żeby inni nie zobaczyli najpierw losowego miejsca.
  const wantKey = `${roomSlug}:${userId}`;
  useEffect(() => {
    spawnLoadedRef.current = false;
    if (!ready || !userId || !getSupabase()) return;
    let cancelled = false;
    void fetchSpawn(userId, roomSlug).then((p) => {
      if (cancelled) return;
      // Wejście/wyjście przez strefę ma zawsze lądować dokładnie w jej środku — zapisana
      // pozycja z bazy liczy się tylko, gdy nie ma strefy startowej (np. bezpośredni URL).
      if (p && !effectiveSpawnZoneSlug) {
        myPos.current = p;
        spawnRef.current = p;
      }
      spawnLoadedRef.current = true;
      setLoadedKey(wantKey);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, userId, roomSlug, wantKey, effectiveSpawnZoneSlug]);
  const spawned = ready && (!userId || !getSupabase() || loadedKey === wantKey);

  // Ruch własnej postaci, kule i wysyłanie pozycji.
  useEffect(() => {
    const stage = stageRef.current;
    const world = worldRef.current;
    const person = personRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!stage || !world || !person || !canvas || !ctx) return;

    const held = new Set<string>();
    const spawnZone = effectiveSpawnZoneSlug ? zonesRef.current.find((z) => z.slug === effectiveSpawnZoneSlug) : undefined;
    let x: number;
    let y: number;
    if (spawnZone) {
      // Bez zapisanej pozycji postać staje na środku strefy wejścia/wyjścia — tak jakby właśnie
      // przez nią weszła, i może od razu trzymać E, żeby tą samą drogą wyjść.
      x = spawnZone.x + spawnZone.w / 2 - PERSON_W / 2;
      y = spawnZone.y + spawnZone.h / 2 - PERSON_H / 2;
    } else {
      // Losowe miejsce z marginesem od krawędzi ekranu startowego (środek mapy, patrz CONTENT_OX/OY).
      // Na malutkim ekranie margines maleje (max ¼ wolnego miejsca), a gdy miejsca brak — postać ląduje na środku.
      const freeW = SCREEN_W - PERSON_W;
      const freeH = SCREEN_H - PERSON_H - TAG_H;
      const mx = Math.min(SPAWN_MARGIN, freeW / 4);
      const my = Math.min(SPAWN_MARGIN, freeH / 4);
      x = CONTENT_OX + mx + Math.random() * (freeW - 2 * mx);
      y = CONTENT_OY + TAG_H + my + Math.random() * (freeH - 2 * my);
    }
    // Spawn znany od razu, żeby pierwsze wysłanie / Presence nie niosło pozycji ze środka.
    myPos.current = { ...clampPos(x, y, isLobby), d: DIR_DOWN };

    // Kamera: okno SCREEN_W×SCREEN_H wyśrodkowane w oknie przeglądarki (pasy po bokach, jak dawniej
    // cała plansza), przesuwające pod sobą całą (większą) mapę tak, żeby środek postaci zawsze
    // wypadał na środku ekranu — dopóki nie natrafi na krawędź mapy: wtedy kamera się zatrzymuje
    // i dalszy ruch w tę stronę już tylko przesuwa postać w kadrze, aż do samego brzegu mapy.
    let scale = 1;
    let baseOx = 0;
    let baseOy = 0;
    const clampCamera = (center: number, screenSize: number, worldSize: number) =>
      Math.min(worldSize - screenSize, Math.max(0, center - screenSize / 2));
    const applyCamera = () => {
      const camX = clampCamera(x + PERSON_W / 2, SCREEN_W, WORLD_W);
      const camY = clampCamera(y + PERSON_H / 2, SCREEN_H, WORLD_H);
      world.style.transform = `translate(${baseOx - camX * scale}px, ${baseOy - camY * scale}px) scale(${scale})`;
    };
    // Dopasowanie okna kamery (nie całej mapy) do rozmiaru okna przeglądarki; canvas nadal
    // pokrywa całą mapę w jednostkach świata (rysujemy w nich zawsze, kamera tylko przesuwa widok).
    const resize = () => {
      scale = Math.min(stage.clientWidth / SCREEN_W, stage.clientHeight / SCREEN_H);
      baseOx = (stage.clientWidth - SCREEN_W * scale) / 2;
      baseOy = (stage.clientHeight - SCREEN_H * scale) / 2;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(WORLD_W * scale * dpr);
      canvas.height = Math.round(WORLD_H * scale * dpr);
      ctx.setTransform(canvas.width / WORLD_W, 0, 0, canvas.height / WORLD_H, 0, 0);
      applyCamera();
    };
    resize();
    let last = performance.now();
    let lastSent = 0;
    let dirty = false;
    let raf = 0;
    let dir: Dir = DIR_DOWN;
    let walkingNow = false;
    let rollingNow = false;
    /** Znormalizowany wektor przewrotu (kierunek w chwili wciśnięcia C) i chwile (performance.now) jego końca / końca cooldownu. */
    let rollDx = 0;
    let rollDy = 0;
    let rollUntil = 0;
    let rollCooldownUntil = 0;
    let dashingNow = false;
    /** Cel teleportu unik-u, chwila (performance.now) w której ma nastąpić skok pozycji, koniec
     * animacji unik-u i koniec jego cooldownu. dashTeleported pilnuje, żeby skok wykonał się raz. */
    let dashTargetX = 0;
    let dashTargetY = 0;
    let dashTeleportAt = 0;
    let dashUntil = 0;
    let dashCooldownUntil = 0;
    let dashTeleported = false;
    /** Początek ładowania własnej kuli (performance.now) albo null. */
    let chargeStart: number | null = null;
    // Mirrors the server's own stamina state (see currentStamina()/Conn.staminaAt in
    // realtime-server/src/server.ts) — without this, our own predicted preview kept showing shots
    // the server would actually refuse. Regenerated every frame in tick() (STAMINA_REGEN_PER_SEC),
    // spent in release() below, and resynced to the authoritative value on every "state" broadcast
    // (see setMyStamina above) so small drift never accumulates.
    let predictedStamina = STAMINA_MAX;
    // Mirrors myStaminaMax state for the same reason predictedStamina mirrors myStamina: tick()
    // below writes the stamina label directly to the DOM every frame and can't wait on a re-render
    // to see a fresh value.
    let predictedStaminaMax = STAMINA_MAX;
    // Wejście do pokoju: trzymając E w jego kwadracie przez ROOM_ENTER_MS, wchodzimy na jego stronę.
    let eDown = false;
    // Jeśli E zostało wciśnięte jeszcze w poprzednim pokoju, ignorujemy je, dopóki nie przyjdzie keyup.
    let eLocked = eKeyLockedAcrossRooms;
    let eHoldStart: number | null = null;
    let eHoldSlug: string | null = null;
    let entered = false;
    // Strefa "action": po zadziałaniu trzeba puścić E (albo zejść ze strefy), żeby użyć jej znowu.
    let eActionFired = false;
    // Wyjście podczas fazy work: pierwsze przytrzymanie E tylko ostrzega (traci się XP z sesji),
    // dopiero drugie (po puszczeniu i ponownym przytrzymaniu, stojąc cały czas w tej samej strefie)
    // faktycznie wyprowadza z pokoju. Nie kasuje się przy samym puszczeniu E — patrz reset niżej.
    let exitWarned = false;

    // Zapis pozycji w bazie (tylko zalogowany, aktywna karta, po wczytaniu starej pozycji).
    let saved = { x: NaN, y: NaN, d: -1 };
    const persist = () => {
      // realtime-server owns saving position on this path (Faza C / C2, see
      // docs/stateful_server_plan.md) — writing here too would race it, sometimes overwriting
      // the server's authoritative position with the client's own (possibly pre-reconciliation)
      // one.
      if (REALTIME_SERVER_URL) return;
      const uid = userIdRef.current;
      const p = myPos.current;
      if (!uid || !activeRef.current || !spawnLoadedRef.current) return;
      if (p.x === saved.x && p.y === saved.y && p.d === saved.d) return;
      saved = { ...p };
      void savePosition(uid, roomSlug, p);
    };
    const saveTimer = setInterval(persist, SAVE_EVERY);
    const onHidden = () => {
      if (document.visibilityState === "hidden") persist();
    };

    // Serwer ruchu (realtime-server/) — tylko na gałęzi podglądowej, patrz REALTIME_SERVER_URL.
    // Serwer jest źródłem prawdy o własnej pozycji: co event "state" nadpisujemy nią lokalne
    // przewidywanie (patrz reconciliation w tick() niżej) — dzięki temu sfałszowana lokalnie
    // pozycja wraca na miejsce w ciągu jednego rozgłoszenia serwera (patrz BROADCAST_MS).
    //
    // `ws` jest `let`, nie `const` — reconnect (Faza B / B1) podmienia je na nowy socket pod tym
    // samym bindingiem, więc `tick()` niżej (który czyta `ws` z tego domknięcia) automatycznie
    // widzi aktualne połączenie bez własnej logiki reconnect.
    let ws: WebSocket | null = null;
    let wsCleanedUp = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Ostatnia znana autorytatywna pozycja z serwera dla nas — NIE jest zerowana po jednym użyciu:
    // tick() dogania ją co klatkę (patrz RECONCILE_HZ), więc kolejny "state" po prostu przesuwa
    // cel, do którego lokalna predykcja nadal płynnie dąży.
    let serverMe: { x: number; y: number; d: number; gx: number; gy: number; gd: number } | null = null;
    // Mirrors myRespawnAtRef, read by the roll/dash/charge key handlers below (a ghost can move
    // but not attack — the server already rejects those messages while isDead(conn), this just
    // avoids the wasted message and the locally-predicted preview it would otherwise show).
    let myDead = false;
    // Kierunek koryguje się jednorazowo, nie płynnie (to dyskretna orientacja sprite'a, nie
    // pozycja) — osobna flaga, żeby nie stosować go ponownie co klatkę dopóki nie przyjdzie nowy.
    let serverDirPending = false;
    // Czy TEN pokój jest teraz w fazie "work" — realtime-server odrzuca ruch/roll/dash/charge/fire
    // przez cały ten czas (patrz isFrozen w realtime-server/src/server.ts), więc lokalna predykcja
    // musi się zatrzymać w tej samej chwili, inaczej trzymanie strzałki wygląda jak ruch, dopóki
    // reconciliation nie ściągnie z powrotem na miejsce. Ta sama, czysta funkcja zegara co
    // getTimerState gdzie indziej w tym pliku — zero komunikacji z serwerem ruchu potrzebnej, żeby
    // się z nim zgadzać. Nie dotyczy strefy E (wejście/wyjście z pokoju) — wyjście podczas pracy
    // zostaje możliwe (z ostrzeżeniem), patrz zone-hold logika niżej.
    const frozenByWork = () =>
      Boolean(phase && serverNowRef.current !== null && getTimerState(serverNowRef.current, phase).phase === "work");

    const scheduleReconnect = () => {
      if (wsCleanedUp) return;
      setWsStatus("reconnecting");
      // Backoff: 500ms, 1s, 2s, 4s, 8s (cap), ±20% jitter to avoid every dropped tab retrying in
      // lockstep against the same Machine right after a blip.
      const delayBase = Math.min(8000, 500 * 2 ** reconnectAttempts);
      reconnectAttempts += 1;
      const delay = delayBase * (0.8 + Math.random() * 0.4);
      reconnectTimer = setTimeout(connectWs, delay);
    };

    function connectWs() {
      if (wsCleanedUp || !REALTIME_SERVER_URL) return;
      const socket = new WebSocket(REALTIME_SERVER_URL);
      ws = socket;
      realtimeWsRef.current = socket;
      socket.addEventListener("open", () => {
        if (socket !== ws) return;
        reconnectAttempts = 0;
        setWsStatus("connected");
        // userId isn't sent directly — the token (minted server-side from the real Supabase
        // session) is the only thing realtime-server trusts for it, see fetchRealtimeJoinToken.
        void (async () => {
          const token = await fetchRealtimeJoinToken(roomSlug, sessionRef.current?.access_token ?? null);
          if (!token || socket !== ws || socket.readyState !== WebSocket.OPEN) return;
          // Same `id` (netKey) on every (re)join — this is exactly what lets realtime-server
          // recognize a reconnect as the same player and resume position instead of respawning
          // (B2 grace period, see docs/stateful_server_plan.md).
          // Lobby only: names the room we just left (same value as `effectiveSpawnZoneSlug`
          // above) so the server can spawn us at that room's own lobby zone instead of guessing —
          // see `fromRoomSlug` in @realtime-shared/types.
          const join: ClientMessage = {
            type: "join",
            id: netKey,
            token,
            nick: metaRef.current.nick,
            color: colorRef.current,
            fromRoomSlug: isLobby ? effectiveSpawnZoneSlug ?? null : null,
          };
          socket.send(JSON.stringify(join));
        })();
      });
      socket.addEventListener("message", (ev) => {
        if (socket !== ws) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.type === "join_rejected") {
          // No occupancy-aware room picker on this path yet — surfacing this is future UX work,
          // not required for the server to correctly defend itself (A3 in
          // docs/stateful_server_plan.md). The player simply doesn't appear to others via this
          // server; Supabase presence/positions are unaffected.
          console.warn("realtime-server: join rejected —", msg.reason);
          return;
        }
        if (msg.type === "respawn_redirect") {
          // The server has already moved this connection into the lobby room and reset its
          // hp/immunity server-side (see the tick loop in realtime-server/src/server.ts) — but
          // rooms are separate Next.js routes (see AGENTS.md), so only this navigation actually
          // gets the player looking at the lobby. The new page's own `join` resumes from the
          // ghost this leaves behind (same reconnect path as any other room switch).
          window.sessionStorage.removeItem(SPAWN_FROM_KEY);
          router.push("/");
          return;
        }
        if (msg.type !== "state") return;
        for (const p of msg.players) {
          if (p.id === netKey) {
            serverMe = { x: p.x, y: p.y, d: p.d, gx: p.gx, gy: p.gy, gd: p.gd };
            serverDirPending = true;
            setMyHp(p.hp);
            setMyStamina(p.stamina);
            setMyStaminaMax(p.staminaMax);
            // Resyncs the local predicted mirror (see predictedStamina below) to the server's own
            // value on every broadcast, same reasoning as shotsFired used to need for the old
            // salvo model: without this, small client/server clock drift over a long session would
            // slowly desync when this player's own fire actually gets refused.
            predictedStamina = p.stamina;
            predictedStaminaMax = p.staminaMax;
            setMyRespawnAt(p.respawnAt);
            myRespawnAtRef.current = p.respawnAt;
            myDead = p.respawnAt > 0;
            myImmuneUntilRef.current = p.immuneUntil;
            if (myDead && !myCorpseRef.current) {
              myCorpseRef.current = { x: p.x, y: p.y, d: asDir(p.d) };
              setMyCorpse(myCorpseRef.current);
            } else if (!myDead && myCorpseRef.current) {
              myCorpseRef.current = null;
              setMyCorpse(null);
            }
            continue;
          }
          // Mirrors the Supabase "pos" broadcast handler below (same posRef/setOthers/setWalkers
          // pattern) — posRef alone wouldn't trigger a re-render, `others` state has to change too.
          const prevPos = posRef.current[p.id];
          const ghostClamped = clampPos(p.gx, p.gy, isLobby);
          const nextPos = {
            ...clampPos(p.x, p.y, isLobby),
            d: asDir(p.d),
            hp: p.hp,
            respawnAt: p.respawnAt,
            immuneUntil: p.immuneUntil,
            gx: ghostClamped.x,
            gy: ghostClamped.y,
            gd: asDir(p.gd),
          };
          posRef.current[p.id] = nextPos;
          if (!prevPos || prevPos.x !== nextPos.x || prevPos.y !== nextPos.y) {
            setWalkers((w) => (w[p.id] ? w : { ...w, [p.id]: true }));
            clearTimeout(walkTimers.current[p.id]);
            walkTimers.current[p.id] = setTimeout(() => setWalkers((w) => ({ ...w, [p.id]: false })), 300);
          }
          setOthers((prevOthers) =>
            prevOthers[p.id] ? { ...prevOthers, [p.id]: { ...prevOthers[p.id], ...nextPos } } : prevOthers,
          );
        }
        // Faza F4 (docs/combat_sync_plan.md): the server is the only judge of hits now — replace
        // ballsRef wholesale with its list (rendering only, no local physics/collision against
        // it) instead of simulating balls locally the way the pre-migration code did. `predictedRef`
        // (below, tick()) still gives the shooter's own shot instant local feedback in the
        // meantime; everyone's hit flash/particles come exclusively from `msg.hits` here.
        ballsRef.current = msg.balls.map(
          (b: ServerBall): Ball => ({
            x: b.x,
            y: b.y,
            vx: b.vx,
            vy: b.vy,
            r: b.r,
            color: b.color,
            owner: b.owner,
            melee: b.melee,
            until: b.until,
          }),
        );
        // predictedRef only ever holds this connection's own shots, so the moment the server
        // confirms at least one of ours is alive, the local preview has done its job — drop it
        // instead of drawing both side by side (which, before this, is exactly what a slow round
        // trip would do: show the correctly-colored prediction *and* the server's own ball, the
        // latter still carrying whatever color/nick this connection's original `join` sent — see
        // the "profile" message below for why that can lag the real one).
        const myKey = keyRef.current || "me";
        if (predictedRef.current.length > 0 && ballsRef.current.some((b) => b.owner === myKey)) {
          predictedRef.current = [];
        }
        const hits: HitEvent[] = msg.hits;
        for (const h of hits) {
          const t = performance.now();
          const isMe = h.targetId === netKey;
          hitRef.current[isMe ? "me" : h.targetId] = t;
          burst({ x: h.x, y: h.y, r: h.r, color: h.color }, t);
          // Trafiony widzi "-N" na czerwono nad sobą; ten, kto trafił, widzi "N" na biało nad
          // celem. Bez tekstu w bezpiecznym lobby (dmg 0 — patrz MAX_HP w shared/constants.ts).
          if (h.dmg > 0) {
            if (isMe) {
              dmgTextRef.current.push({ x: h.x, y: h.y, text: `-${h.dmg}`, color: "#ef4444", born: t });
            } else if (h.ownerId === (keyRef.current || "me")) {
              dmgTextRef.current.push({ x: h.x, y: h.y, text: `${h.dmg}`, color: "#ffffff", born: t });
              // The killing blow: big "KILL" callout plus the reward that just landed (see
              // KILL_XP_REWARD/KILL_GOLD_REWARD's doc comment) — shown only here, on the killer's
              // own screen, stacked under the regular "N" damage number above.
              if (h.killed) {
                killTextRef.current.push(
                  { x: h.x, y: h.y, text: "KILL", color: "#ef4444", born: t, big: true, offset: 0 },
                  { x: h.x, y: h.y, text: `+${KILL_XP_REWARD} xp`, color: "#facc15", born: t, offset: 24 },
                  { x: h.x, y: h.y, text: `+${KILL_GOLD_REWARD} gold`, color: "#facc15", born: t, offset: 46 },
                );
              }
            }
          }
        }
      });
      socket.addEventListener("close", () => {
        if (socket !== ws || wsCleanedUp) return;
        scheduleReconnect();
      });
    }
    if (REALTIME_SERVER_URL) connectWs();
    let lastInputSent = 0;
    // Ostatni dx/dy faktycznie wysłany do serwera — patrz edge-triggered send w tick() niżej:
    // bez tego krótkie stuknięcie strzałki (krócej niż SEND_EVERY) mogło nigdy nie trafić do
    // serwera, bo wysyłka była tylko na zegarze, nie na zmianie stanu klawiszy.
    let lastSentDx = 0;
    let lastSentDy = 0;

    const emit = (event: string, payload: object = {}) => {
      if (!activeRef.current) return;
      channelRef.current?.send({
        type: "broadcast",
        event,
        payload: { k: keyRef.current, ...payload },
      });
    };
    const send = () => emit("pos", myPos.current);

    const release = () => {
      if (chargeStart === null) return;
      const chargeMs = performance.now() - chargeStart;
      const p = Math.min(1, chargeMs / CHARGE_MS);
      chargeStart = null;
      if (!activeRef.current) return;
      // Same stamina rule the server enforces (see currentStamina()/the "fire" handler in
      // realtime-server/src/server.ts): once our own predicted pool can't cover the cost, this
      // release doesn't actually fire — no predicted ball, no message, no stamina spent — but
      // still clears the charging halo below, same as a real shot would. Without this, spamming
      // fire kept adding unlimited local predicted balls while the server (and everyone else)
      // only ever confirmed shots this connection could actually afford.
      const firing = !myDead && !frozenByWork() && (!REALTIME_SERVER_URL || predictedStamina >= STAMINA_COST_PER_SHOT);
      if (firing) {
        if (REALTIME_SERVER_URL) {
          // Faza F4: the server decides the real ball (chargeMs capped to what it actually saw
          // elapse since our own `charge: { on: true }`, see the "fire" handler in
          // realtime-server/src/server.ts) — this is only the shooter's own instant, cosmetic
          // preview. It flies under the same rule as a real ball (out-of-bounds, see tick()
          // below) rather than a short fixed timer, and gets handed off to ballsRef the moment
          // the server's own broadcast confirms it — see the "state" handler above.
          launch(predictedRef.current, x, y, dir, p, colorRef.current, keyRef.current || "me");
          if (ws && ws.readyState === WebSocket.OPEN) {
            const fire: ClientMessage = { type: "fire", chargeMs };
            ws.send(JSON.stringify(fire));
          }
          predictedStamina -= STAMINA_COST_PER_SHOT;
          setMyStamina(predictedStamina);
        } else {
          launch(ballsRef.current, x, y, dir, p, colorRef.current, keyRef.current || "me");
        }
      }
      // Still emitted in both modes (and even when the cooldown blocked the shot above) — other
      // clients use "fire" only to clear the charging halo they're drawing for this player
      // (chargingRef), unrelated to who-hit-who.
      emit("fire", { ...myPos.current, p });
      // Every real shot by a signed-in user bumps their all-time count (shown in
      // src/components/ProfileMenu.tsx), server-side via supabase/migrations/0012_balls_shot.sql.
      if (firing && userIdRef.current)
        void getSupabase()
          ?.rpc("increment_balls_shot")
          .then(({ error }) => {
            if (error) console.error("increment_balls_shot", error);
          });
    };
    const cancelCharge = () => {
      if (chargeStart === null) return;
      chargeStart = null;
      if (REALTIME_SERVER_URL && ws && ws.readyState === WebSocket.OPEN) {
        // Tell the server charging stopped too — otherwise its recorded chargeStartAt for this
        // connection would linger and let a later, genuinely-quick fire claim a bogus high
        // chargeMs (see the "charge"/"fire" handlers in realtime-server/src/server.ts).
        const off: ClientMessage = { type: "charge", on: false };
        ws.send(JSON.stringify(off));
      }
      emit("charge", { on: false });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, WORLD_W, WORLD_H);
      ctx.globalAlpha = 0.85;
      // Kwadraty pokoi: podświetlone, gdy postać w nich stoi; pasek postępu podczas trzymania E.
      for (const z of zonesRef.current) {
        const active = z.slug === eHoldSlug && eHoldStart !== null;
        const phaseState = z.phase && serverNowRef.current !== null ? getTimerState(serverNowRef.current, z.phase) : null;
        // Strefa wymagająca konta (np. Shop) bez zalogowania — zamknięta niezależnie od fazy.
        const authLocked = Boolean(z.requiresAuth) && !userIdRef.current;
        const workClosedPre = phaseState?.phase === "work";
        // Pokój zamknięty (praca w toku albo wymaga konta) ledwo widoczny, żeby wzrok od razu
        // szedł na jedyny otwarty (aktualnie dostępny) pokój — patrz reset globalAlpha po pętli.
        const closed = (authLocked || workClosedPre) && !active;
        ctx.globalAlpha = closed ? 0.18 : 0.85;
        ctx.lineWidth = active ? 3 : 1.5;
        ctx.strokeStyle = active ? "#ffffff" : (z.color ?? "rgba(255,255,255,0.4)");
        ctx.fillStyle = active ? "rgba(255,255,255,0.12)" : (z.color ? `${z.color}26` : "rgba(255,255,255,0.05)");
        ctx.beginPath();
        ctx.roundRect(z.x, z.y, z.w, z.h, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (authLocked || phaseState?.phase === "work") {
          // Zablokowane (praca w toku albo trzeba się zalogować) — kłódka zamiast numeru pokoju.
          ctx.font = "28px sans-serif";
          ctx.fillText("🔒", z.x + z.w / 2, z.y + z.h / 2 - 6);
        } else {
          ctx.font = "600 24px sans-serif";
          ctx.fillText(z.name, z.x + z.w / 2, z.y + z.h / 2 - 6);
        }
        // Pod numerem/kłódką: stojąc na wyjściu (kwadrat "lobby" na scenie samego pokoju) — zielony
        // "E to exit room"; stojąc na wejściu — zielony "E to enter room" (albo "Room is closed",
        // gdy trwa faza work i wejście jest zablokowane); w innym wypadku prawdziwa liczba osób
        // w pokoju, ale tylko gdy ktoś tam jest.
        const occupants = occupancyRef.current?.[z.slug];
        const isExitHere = roomSlug !== "lobby" && z.slug === "lobby";
        // Pokój zamknięty (trwa faza work): kłódka, czerwone odliczanie pod kwadratem (patrz
        // niżej, phaseState) i liczba osób w środku (STU-26) — bez nagrody i tekstów wejścia,
        // bo i tak nie można teraz wejść.
        const workClosed = phaseState?.phase === "work";
        // Nagroda XP tego pokoju i długość faz: pod numerem/kłódką, zawsze widoczna (nie tylko
        // stojąc na kwadracie) — dla pomodoro to praca+przerwa w minutach i nagroda za całą sesję
        // pracy, dla stopwatch/timer stała stawka za ciągłą obecność (patrz STUDY_SECONDS_PER_XP
        // w src/lib/xp.ts).
        if ((z.kind ?? "nav") === "nav" && !isExitHere && !z.noReward && !workClosed) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = "600 14px sans-serif";
          ctx.fillText(z.phase ? `${z.phase.workMin}+${z.phase.breakMin} min` : "no timer", z.x + z.w / 2, z.y + z.h / 2 + 14);
          ctx.fillStyle = "#fbbf24";
          ctx.font = "700 14px sans-serif";
          ctx.fillText(
            z.phase
              ? `+${xpForMinutes(z.phase.workMin)} XP · +${coinsForMinutes(z.phase.workMin)} coins/session`
              : "+0.1 XP/5min · +0.1 coins/min while running",
            z.x + z.w / 2,
            z.y + z.h / 2 + 30,
          );
        }
        if (inZone(x, y, z) && (z.kind ?? "nav") === "nav" && !workClosed) {
          if (isExitHere) {
            ctx.fillStyle = "#22c55e";
            ctx.font = "700 16px sans-serif";
            ctx.fillText("E to exit room", z.x + z.w / 2, z.y + z.h / 2 + 42);
          } else if (authLocked) {
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.font = "700 16px sans-serif";
            ctx.fillText("Sign in required", z.x + z.w / 2, z.y + z.h / 2 + 42);
          } else {
            ctx.fillStyle = "#22c55e";
            ctx.font = "700 16px sans-serif";
            ctx.fillText("E to enter room", z.x + z.w / 2, z.y + z.h / 2 + 42);
          }
        } else if (occupants) {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.font = "500 16px sans-serif";
          ctx.fillText(`${occupants} player${occupants === 1 ? "" : "s"} inside`, z.x + z.w / 2, z.y + z.h / 2 + 42);
        }
        if (active && eHoldStart !== null) {
          const p = Math.min(1, (t - eHoldStart) / roomEnterMs());
          const barW = z.w - 16;
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(z.x + 8, z.y + z.h - 14, barW, 6);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(z.x + 8, z.y + z.h - 14, barW * p, 6);
        }
        // Pod kwadratem pomodoro: czy właśnie trwa "Work" (czerwony, zablokowany) czy "Break"
        // (zielony), ile zostało do końca fazy i pasek postępu — jak w RoomTimer w samym pokoju.
        if (phaseState) {
          const state = phaseState;
          const phaseColor = PHASE_COLOR[state.phase];
          ctx.fillStyle = phaseColor;
          ctx.font = "700 19px sans-serif";
          ctx.fillText(
            `${state.phase === "work" ? "WORK" : "STARTS IN"} · ${formatMs(state.remainingMs)}`,
            z.x + z.w / 2,
            z.y + z.h + 24,
          );
          const barW = z.w - 16;
          const barY = z.y + z.h + 36;
          const progress = 1 - state.remainingMs / state.phaseMs;
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.fillRect(z.x + 8, barY, barW, 6);
          ctx.fillStyle = phaseColor;
          ctx.fillRect(z.x + 8, barY, barW * progress, 6);
        }
      }
      ctx.globalAlpha = 0.85;
      // W pełni naładowana kula pulsuje.
      const pulse = (p: number) => (p >= 1 ? 1 + 0.06 * Math.sin(t / 70) : 1);
      if (chargeStart !== null) {
        const p = Math.min(1, (t - chargeStart) / CHARGE_MS);
        const { r, cx, cy } = orbAt(x, y, p);
        drawOrb(ctx, cx, cy, r * pulse(p), colorRef.current, p);
      }
      for (const [k, start] of Object.entries(chargingRef.current)) {
        const pos = posRef.current[k];
        if (!pos) continue;
        const p = Math.min(1, (t - start) / CHARGE_MS);
        const { r, cx, cy } = orbAt(pos.x, pos.y, p);
        drawOrb(ctx, cx, cy, r * pulse(p), othersRef.current[k]?.color ?? "#ffffff", p);
      }
      // predictedRef is empty in the legacy (no REALTIME_SERVER_URL) branch, so this concat is a
      // no-op there — see predictedRef's own doc comment.
      for (const b of [...ballsRef.current, ...predictedRef.current]) {
        if (b.melee) {
          // Zamach pięścią: krótki, gasnący błysk zamiast pływającej kuli.
          const life = b.until !== undefined ? Math.max(0, (b.until - t) / STRIKE_MS) : 1;
          drawOrb(ctx, b.x, b.y, b.r * (0.6 + 0.4 * life), b.color, 0.9 * life);
        } else {
          drawOrb(ctx, b.x, b.y, b.r, b.color, 0.6);
        }
      }
      // Błysk uderzenia na trafionych postaciach.
      const flash = (px: number, py: number, at: number | undefined) => {
        if (at === undefined || t - at > HIT_MS) return;
        const f = 1 - (t - at) / HIT_MS;
        ctx.globalAlpha = 0.75 * f;
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.roundRect(px + HITBOX_OFFSET_X, py + HITBOX_OFFSET_Y, HITBOX_W, HITBOX_H, 16);
        ctx.fill();
        ctx.globalAlpha = f;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px + PERSON_W / 2, py + PERSON_H / 2, 28 + (1 - f) * 52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.85;
      };
      flash(x, y, hitRef.current.me);
      for (const [k, o] of Object.entries(othersRef.current)) {
        const px = posRef.current[k] ?? o;
        flash(px.x, px.y, hitRef.current[k]);
      }
      // Odłamki rozpadniętej kuli.
      shardsRef.current = shardsRef.current.filter((s) => t - s.born < SHARD_MS);
      for (const s of shardsRef.current) {
        const age = (t - s.born) / 1000;
        const life = 1 - (t - s.born) / SHARD_MS;
        ctx.globalAlpha = 0.9 * life;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x + s.vx * age, s.y + s.vy * age + 300 * age * age, s.r * life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.85;
      // Pływające napisy z obrażeniami — unoszą się i gasną (patrz push w handlerze "state" WS).
      dmgTextRef.current = dmgTextRef.current.filter((d) => t - d.born < DMG_TEXT_MS);
      ctx.font = "bold 21px sans-serif";
      ctx.textAlign = "center";
      for (const d of dmgTextRef.current) {
        const age = t - d.born;
        const life = 1 - age / DMG_TEXT_MS;
        ctx.globalAlpha = life;
        ctx.fillStyle = d.color;
        ctx.fillText(d.text, d.x, d.y - 20 - 26 * (age / DMG_TEXT_MS));
      }
      // "KILL" callout + reward, stacked below it — see the `killed` push in the "state" WS
      // handler above. Fades 3x slower than a regular damage number (KILL_TEXT_MS), floats up the
      // same way but starting from each line's own stack offset.
      killTextRef.current = killTextRef.current.filter((k) => t - k.born < KILL_TEXT_MS);
      ctx.textAlign = "center";
      for (const k of killTextRef.current) {
        const age = t - k.born;
        const life = 1 - age / KILL_TEXT_MS;
        ctx.font = k.big ? "bold 34px sans-serif" : "bold 20px sans-serif";
        ctx.globalAlpha = life;
        ctx.fillStyle = k.color;
        ctx.fillText(k.text, k.x, k.y - 40 - k.offset - 30 * (age / KILL_TEXT_MS));
      }
      ctx.textAlign = "left";
      ctx.globalAlpha = 0.85;
    };

    const burst = (b: { x: number; y: number; r: number; color: string }, t: number) => {
      const n = 8 + Math.round(b.r / 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const v = 80 + Math.random() * 200;
        shardsRef.current.push({
          x: b.x,
          y: b.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          r: 2 + Math.random() * Math.max(2, b.r / 4),
          color: b.color,
          born: t,
        });
      }
    };

    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      // Continuous local regen mirroring currentStamina() server-side (see STAMINA_REGEN_PER_SEC's
      // doc comment in realtime-shared/constants.ts) — resynced to the authoritative value on
      // every "state" broadcast (see setMyStamina above), so this only ever has to be right for
      // the ~50ms between broadcasts, not for a whole session.
      if (REALTIME_SERVER_URL && predictedStamina < STAMINA_MAX) {
        predictedStamina = Math.min(STAMINA_MAX, predictedStamina + dt * STAMINA_REGEN_PER_SEC);
      }
      // Direct DOM write, not setState: predictedStamina changes every frame while regenerating,
      // and routing that through React would re-render the whole component at 60fps for a single
      // <span>. Only touches the node when the rounded number actually changed.
      if (REALTIME_SERVER_URL) {
        const el = staminaTextRef.current;
        if (el) {
          const text = `${Math.max(0, Math.round(predictedStamina))}/${Math.round(predictedStaminaMax)}`;
          if (el.textContent !== text) el.textContent = text;
        }
      }
      // Pozycja wczytana z bazy zastępuje losowy start.
      const spawn = spawnRef.current;
      if (spawn) {
        spawnRef.current = null;
        x = spawn.x;
        y = spawn.y;
        dir = spawn.d;
        setMyDir(spawn.d);
      }
      // Korekta z serwera ruchu (patrz WS wyżej). Faza F2 (docs/combat_sync_plan.md): serwer
      // teraz też liczy przewrót/unik (patrz "roll"/"dash" w realtime-server/src/server.ts) tą
      // samą matematyką co niżej, więc korekta przestała być pomijana w ich trakcie — wcześniej
      // pomijano ją tylko dlatego, że serwer o nich nic nie wiedział.
      //
      // Reconciliation, nie twardy snap: `serverMe` żyje między broadcastami (nie jest tu
      // zerowane), więc każda klatka domyka tylko ułamek błędu (`alpha`, zależny od dt — patrz
      // RECONCILE_HZ). Przy typowym drobnym rozjeździe (kwantyzacja 20Hz ticku, zaokrąglenia)
      // to wygląda jak płynny ruch; przy dużym skoku (dash, spawn, reconnect po grace period)
      // przekraczamy RECONCILE_SNAP_PX i wtedy nadal lądujemy tam natychmiast — wygładzanie
      // takiego skoku wyglądałoby jak ślizganie się przez pół mapy.
      if (serverMe) {
        // Dead: the body (x/y/d) is the frozen corpse (rendered separately, see myCorpse below) —
        // what this node reconciles against, and what the player still steers, is the ghost
        // (gx/gy/gd) for the rest of the respawn countdown. See PlayerState.gx/gy/gd's doc comment
        // in realtime-server/shared/types.ts.
        const dead = myRespawnAtRef.current > 0;
        const targetX = dead ? serverMe.gx : serverMe.x;
        const targetY = dead ? serverMe.gy : serverMe.y;
        const errX = targetX - x;
        const errY = targetY - y;
        const errDist = Math.hypot(errX, errY);
        if (errDist > RECONCILE_SNAP_PX) {
          x = targetX;
          y = targetY;
        } else if (errDist > 0.05) {
          const alpha = 1 - Math.exp(-RECONCILE_HZ * dt);
          x += errX * alpha;
          y += errY * alpha;
        }
        if (serverDirPending) {
          const newDir = asDir(dead ? serverMe.gd : serverMe.d);
          if (newDir !== dir) {
            dir = newDir;
            setMyDir(newDir);
          }
          serverDirPending = false;
        }
      }
      const on = activeRef.current;
      // Zablokowane przez fazę "work" tego pokoju — patrz frozenByWork. Osobne od `on`: strefa
      // wejścia/wyjścia (E) niżej nadal używa samego `on`, bo wyjście podczas pracy ma zostać
      // możliwe (z ostrzeżeniem o utracie XP), tylko ruch/przewrót/unik mają zamarznąć.
      const canAct = on && !frozenByWork();
      const dashing = canAct && t < dashUntil;
      if (dashing !== dashingNow) {
        dashingNow = dashing;
        setMyDashing(dashing);
      }
      // W połowie animacji unik-u postać znika w starym miejscu i w tej samej klatce ląduje w celu —
      // dashTeleported pilnuje, żeby skok wykonał się dokładnie raz na jeden unik.
      if (dashing && !dashTeleported && t >= dashTeleportAt) {
        dashTeleported = true;
        x = dashTargetX;
        y = dashTargetY;
        dirty = true;
      }
      const rolling = !dashing && canAct && t < rollUntil;
      if (rolling !== rollingNow) {
        rollingNow = rolling;
        setMyRolling(rolling);
      }
      const dx = dashing
        ? 0
        : rolling
          ? rollDx
          : canAct
            ? (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0)
            : 0;
      const dy = dashing
        ? 0
        : rolling
          ? rollDy
          : canAct
            ? (held.has("ArrowDown") ? 1 : 0) - (held.has("ArrowUp") ? 1 : 0)
            : 0;
      // Surowa intencja ruchu (bez przewrotu/uniku — te idą przez osobne wiadomości "roll"/"dash",
      // patrz onKeyDown, Faza F2 w docs/combat_sync_plan.md) wysyłana do serwera ruchu. Niezależnie
      // od `dirty` (które dotyczy pozycji, nie intencji) — inaczej puszczenie strzałki nigdy by się
      // nie wysłało, gdyby akurat ostatnia klatka ruchu nie zmieniła pozycji.
      //
      // Wysyłka na zmianę (edge-triggered), nie tylko na zegarze: `held` zmienia się na
      // keydown/keyup (patrz onKeyDown/onKeyUp), ale ta pętla próbkuje je tylko raz na klatkę —
      // przy starym kodzie (wysyłka wyłącznie co SEND_EVERY) krótkie stuknięcie strzałki mogło w
      // całości zmieścić się między dwiema wysyłkami i serwer nigdy się o nim nie dowiadywał:
      // klient lokalnie ruszał się i wracał, po czym reconciliation ściągała go z powrotem, bo
      // serwer twierdził, że w ogóle się nie ruszył. Heartbeat co SEND_EVERY zostaje jako
      // zabezpieczenie (np. na wypadek zgubienia stanu przy reconnect), ale to zmiana dx/dy jest
      // teraz głównym wyzwalaczem wysyłki.
      const rawDx = canAct ? (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0) : 0;
      const rawDy = canAct ? (held.has("ArrowDown") ? 1 : 0) - (held.has("ArrowUp") ? 1 : 0) : 0;
      const inputChanged = rawDx !== lastSentDx || rawDy !== lastSentDy;
      if (ws && ws.readyState === WebSocket.OPEN && (inputChanged || t - lastInputSent >= SEND_EVERY)) {
        const input: ClientMessage = {
          type: "input",
          dx: rawDx as -1 | 0 | 1,
          dy: rawDy as -1 | 0 | 1,
          // Admin panel debug knob — realtime-server only honors this outside production, see
          // DEV_OVERRIDES_ENABLED in server.ts.
          ...(isAdminUiEnabled() ? { speedOverride: getAdminSettings().playerSpeed } : {}),
        };
        ws.send(JSON.stringify(input));
        lastInputSent = t;
        lastSentDx = rawDx;
        lastSentDy = rawDy;
      }
      const moving = !rolling && !dashing && Boolean(dx || dy);
      if (moving !== walkingNow) {
        walkingNow = moving;
        setMyWalking(moving);
      }
      if (!rolling && !dashing && (dx || dy)) {
        const nd = DIR_OF[dy + 1][dx + 1] as Dir;
        if (nd !== dir) {
          dir = nd;
          setMyDir(nd);
          dirty = true;
        }
      }
      const norm = !rolling && dx && dy ? Math.SQRT1_2 : 1;
      const speed = clientSpeed() * (rolling ? ROLL_SPEED_MULT : 1);
      const maxX = WORLD_W - PERSON_W;
      const maxY = WORLD_H - PERSON_H;
      const nx = Math.max(0, Math.min(maxX, x + dx * speed * dt * norm));
      const ny = Math.max(TAG_H, Math.min(maxY, y + dy * speed * dt * norm));
      if (nx !== x || ny !== y) dirty = true;
      x = nx;
      y = ny;
      // Kamera podąża za postacią co klatkę (nie tylko przy zmianie rozmiaru okna).
      applyCamera();
      // Własna postać drży po trafieniu.
      const hitAge = t - (hitRef.current.me ?? -Infinity);
      const shake = hitAge < HIT_MS ? Math.sin(hitAge / 18) * 5 * (1 - hitAge / HIT_MS) : 0;
      person.style.transform = `translate(${x + shake}px, ${y}px)`;
      // Lower opacity while immune (post-respawn grace window) or ghost (mid-respawn-countdown) —
      // mirrors the `others` rendering below, but imperative like `transform` above: this
      // component's own position/appearance is driven straight from refs every rAF frame rather
      // than React state, for the same reason (avoiding a state update, and the resulting
      // re-render, every single frame).
      if (REALTIME_SERVER_URL) {
        person.style.opacity =
          myRespawnAtRef.current > 0
            ? String(GHOST_OPACITY)
            : myImmuneUntilRef.current > Date.now()
              ? String(IMMUNE_OPACITY)
              : "0.7";
        person.style.filter = myRespawnAtRef.current > 0 ? "grayscale(1) brightness(1.3)" : "";
      }
      myPos.current = { x, y, d: dir, r: rolling, dash: dashing };
      // Wejście do pokoju: E trzeba trzymać nieprzerwanie, stojąc w jego kwadracie.
      const zone = on ? zonesRef.current.find((z) => inZone(x, y, z)) : undefined;
      if (!zone) {
        eHoldStart = null;
        eHoldSlug = null;
        eActionFired = false;
        exitWarned = false;
      } else if (!eDown) {
        // E puszczone, ale wciąż w tej samej strefie — licznik trzymania startuje od nowa przy
        // kolejnym wciśnięciu, ale exitWarned zostaje, żeby drugie przytrzymanie liczyło się jako
        // potwierdzenie wyjścia, a nie kolejne ostrzeżenie.
        eHoldStart = null;
        eActionFired = false;
      } else if (zone.slug !== eHoldSlug) {
        eHoldSlug = zone.slug;
        eHoldStart = t;
        eActionFired = false;
        exitWarned = false;
      } else if (eHoldStart === null) {
        // Strefa "action" już zadziałała podczas tego samego, nieprzerwanego trzymania E — pasek
        // nie ma się ładować drugi raz; trzeba puścić E (patrz onKeyUp, kasuje eActionFired) i
        // przytrzymać je od nowa.
        if (!(zone.kind === "action" && eActionFired)) {
          eHoldStart = t;
        }
      } else if (t - eHoldStart >= roomEnterMs()) {
        if (zone.kind === "action") {
          if (!eActionFired) {
            eActionFired = true;
            // Data zdarzenia to chwila NACIŚNIĘCIA E (początek trzymania), nie chwila potwierdzenia
            // po roomEnterMs() — inaczej np. pauza doliczałaby czas spędzony na trzymaniu przycisku.
            onZoneActionRef.current?.(zone.slug, Date.now() - (t - eHoldStart));
            // Bez tego pasek zostawałby wypełniony w 100% aż do puszczenia E zamiast wrócić do 0.
            eHoldStart = null;
          }
        } else if (!entered) {
          const isExit = zone.slug === "lobby";
          const zonePhase =
            zone.phase && serverNowRef.current !== null ? getTimerState(serverNowRef.current, zone.phase).phase : null;
          if (!isExit && zone.requiresAuth && !userIdRef.current) {
            // Strefa zamknięta bez konta (np. Shop) — nie ma sensu nawet pytać serwera o bilet.
            if (entryErrorTimer.current) clearTimeout(entryErrorTimer.current);
            setEntryError(`You must be signed in to enter ${zone.name}.`);
            entryErrorTimer.current = setTimeout(() => setEntryError(null), 4000);
          } else if (isExit && zonePhase === "work" && !exitWarned) {
            // Pierwsze przytrzymanie E podczas fazy work: tylko ostrzeżenie, bez wyjścia —
            // trzeba puścić E i przytrzymać je jeszcze raz, żeby naprawdę wyjść.
            exitWarned = true;
            if (entryErrorTimer.current) clearTimeout(entryErrorTimer.current);
            // zone.phase is guaranteed here: zonePhase can only be "work" when zone.phase exists.
            setEntryError(
              `Leaving now forfeits the +${xpForMinutes(zone.phase!.workMin)} XP and +${coinsForMinutes(zone.phase!.workMin)} coins for this work session — hold E again to confirm.`,
            );
            entryErrorTimer.current = setTimeout(() => setEntryError(null), 4000);
            // Bez tego kolejna klatka (E wciąż wciśnięte) natychmiast trafiłaby w gałąź "else"
            // niżej i wyszła naprawdę — trzeba wymusić puszczenie i ponowne przytrzymanie E.
            eHoldStart = null;
          } else {
            entered = true;
            eKeyLockedAcrossRooms = true;
            // sessionStorage (nie URL) mówi drugiej stronie, z którego pokoju przyszliśmy — lobby
            // ma wiele stref wejścia/wyjścia i inaczej nie wiedziałoby, w której z nich dokładnie
            // wylądować. Zapisujemy tuż przed nawigacją, docelowa strona odczytuje to raz i czyści.
            window.sessionStorage.setItem(SPAWN_FROM_KEY, roomSlug);
            if (isExit) {
              router.push("/");
            } else {
              // Wejście do pokoju wymaga biletu wydanego tylko za to przytrzymanie E — samo
              // wklejenie /rooms/<slug> w pasku adresu nic nie da (patrz proxy.ts). Token sesji
              // (gdy jest) leci jako Bearer, żeby serwer mógł potwierdzić konto dla stref typu
              // Shop (patrz requiresAuth) — dla zwykłych pokoi serwer go po prostu ignoruje.
              const accessToken = sessionRef.current?.access_token;
              void fetch("/api/rooms/enter", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                },
                body: JSON.stringify({ slug: zone.slug }),
              })
              .then(async (res) => {
                if (res.ok) {
                  router.push(`/rooms/${zone.slug}`);
                  return;
                }
                const data: unknown = await res.json().catch(() => null);
                const code = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
                throw new Error(
                  code === "work-in-progress" ? "work-in-progress" : code === "auth-required" ? "auth-required" : "entry ticket request failed",
                );
              })
              .catch((err: unknown) => {
                // Serwer odmówił biletu — zostajemy tu, E można spróbować przytrzymać ponownie.
                entered = false;
                eKeyLockedAcrossRooms = false;
                if (err instanceof Error && (err.message === "work-in-progress" || err.message === "auth-required")) {
                  if (entryErrorTimer.current) clearTimeout(entryErrorTimer.current);
                  setEntryError(
                    err.message === "work-in-progress"
                      ? "You can only enter during the break — a work session is in progress."
                      : `You must be signed in to enter ${zone.name}.`,
                  );
                  entryErrorTimer.current = setTimeout(() => setEntryError(null), 4000);
                }
              });
            }
          }
        }
      }
      // Ostatnią pozycję po zatrzymaniu też wysyłamy (dirty zostaje do skutecznego wysłania).
      if (dirty && t - lastSent >= SEND_EVERY) {
        send();
        lastSent = t;
        dirty = false;
      }
      if (REALTIME_SERVER_URL) {
        // Faza F4 (docs/combat_sync_plan.md): the server already decided who got hit (see the WS
        // "state" handler above, which replaces ballsRef wholesale and raises hitRef from
        // msg.hits) — this only keeps positions moving smoothly between broadcasts
        // (extrapolation, same per-frame math as the legacy branch below), never re-deciding
        // anything. predictedRef is the shooter's own instant, purely cosmetic shot/strike —
        // pruned by its own short `until` regardless of whether the server's real one has
        // arrived yet, never checked against anyone's position.
        ballsRef.current = ballsRef.current.filter((b) => {
          if (b.until !== undefined && t > b.until) return false;
          if (!b.melee) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
          }
          if (b.melee) return true;
          return b.x > -b.r && b.x < WORLD_W + b.r && b.y > -b.r && b.y < WORLD_H + b.r;
        });
        predictedRef.current = predictedRef.current.filter((b) => {
          // Melee still expires on its own short `until` (set by strike()) — it doesn't move, so
          // there's no out-of-bounds moment to prune it on. A thrown ball has no `until` at all:
          // it flies under the exact same out-of-bounds rule as ballsRef above, and is normally
          // handed off (removed here) by the "state" handler well before it'd ever reach that edge.
          if (b.melee) return b.until !== undefined && t <= b.until;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          return b.x > -b.r && b.x < WORLD_W + b.r && b.y > -b.r && b.y < WORLD_H + b.r;
        });
      } else {
        // Kule w locie (własne i cudze) znikają po opuszczeniu sceny; hitboxy ataku wręcz stoją
        // w miejscu i znikają po `until`, niezależnie od tego czy kogoś trafiły.
        ballsRef.current = ballsRef.current.filter((b) => {
          if (b.until !== undefined && t > b.until) return false;
          if (!b.melee) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
          }
          // Pierwsza trafiona osoba (nie strzelec) zatrzymuje kulę: kula się rozpada, postać dostaje.
          let target: string | null = null;
          if (b.owner !== (keyRef.current || "me") && hits(b, x, y)) target = "me";
          else {
            for (const [k, o] of Object.entries(othersRef.current)) {
              if (k === b.owner) continue;
              const px = posRef.current[k] ?? o;
              if (hits(b, px.x, px.y)) {
                target = k;
                break;
              }
            }
          }
          if (target) {
            hitRef.current[target] = t;
            burst(b, t);
            return false;
          }
          if (b.melee) return true;
          return b.x > -b.r && b.x < WORLD_W + b.r && b.y > -b.r && b.y < WORLD_H + b.r;
        });
      }
      draw(t);
      raf = requestAnimationFrame(tick);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current || document.documentElement.dataset.stale || isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey)
        return;
      // A ghost can move but not attack (roll/dash/charge/fire) — see myDead's doc comment above.
      // Same for a room currently in its "work" phase (see frozenByWork): nobody rolls/dashes/
      // fires while frozen, the server would reject it anyway (isFrozen in server.ts).
      if ((myDead || frozenByWork()) && (e.code === "Space" || e.code === "KeyC" || e.code === "KeyV")) return;
      if (e.code === "Space") {
        e.preventDefault(); // spacja nie przewija strony ani nie klika fokusowanego przycisku
        if (!e.repeat && chargeStart === null) {
          chargeStart = performance.now();
          if (REALTIME_SERVER_URL && ws && ws.readyState === WebSocket.OPEN) {
            const on: ClientMessage = { type: "charge", on: true };
            ws.send(JSON.stringify(on));
          }
          emit("charge", { on: true });
        }
        return;
      }
      if (e.code === "KeyE") {
        if (!eLocked) eDown = true;
        return;
      }
      if (e.code === "KeyC") {
        if (!e.repeat) {
          const now = performance.now();
          if (now >= rollCooldownUntil && now >= dashUntil) {
            const [ux, uy] = DIRS[dir];
            const n = Math.hypot(ux, uy) || 1;
            rollDx = ux / n;
            rollDy = uy / n;
            rollUntil = now + ROLL_MS;
            rollCooldownUntil = rollUntil + ROLL_COOLDOWN_MS;
            // Faza F2 (docs/combat_sync_plan.md): request only — the server derives direction
            // from its own copy of `d` and enforces its own cooldown independently (see the
            // "roll" handler in realtime-server/src/server.ts); this local state still drives our
            // own animation/prediction exactly as before.
            if (ws && ws.readyState === WebSocket.OPEN) {
              const roll: ClientMessage = { type: "roll" };
              ws.send(JSON.stringify(roll));
            }
          }
        }
        return;
      }
      if (e.code === "KeyV") {
        if (!e.repeat) {
          const now = performance.now();
          if (now >= dashCooldownUntil && now >= rollUntil) {
            const [ux, uy] = DIRS[dir];
            const n = Math.hypot(ux, uy) || 1;
            const dashDistance = clientSpeed() * ROLL_SPEED_MULT * (ROLL_MS / 1000) * DASH_DISTANCE_MULT;
            const maxX = WORLD_W - PERSON_W;
            const maxY = WORLD_H - PERSON_H;
            dashTargetX = Math.max(0, Math.min(maxX, x + (ux / n) * dashDistance));
            dashTargetY = Math.max(TAG_H, Math.min(maxY, y + (uy / n) * dashDistance));
            dashTeleportAt = now + DASH_TELEPORT_AT_MS;
            dashUntil = now + DASH_MS;
            dashCooldownUntil = dashUntil + DASH_COOLDOWN_MS;
            dashTeleported = false;
            // Faza F2: same "request, not assertion" pattern as roll above — see the "dash"
            // handler in realtime-server/src/server.ts.
            if (ws && ws.readyState === WebSocket.OPEN) {
              const dash: ClientMessage = { type: "dash" };
              ws.send(JSON.stringify(dash));
            }
          }
        }
        return;
      }
      if (!ARROWS.has(e.key)) return;
      e.preventDefault(); // strzałki nie przewijają strony
      held.add(e.key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (chargeStart !== null) e.preventDefault();
        release();
        return;
      }
      if (e.code === "KeyE") {
        eLocked = false;
        eKeyLockedAcrossRooms = false;
        eDown = false;
        // eHoldSlug i exitWarned NIE resetują się tu — o nich decyduje tick() na podstawie tego, w
        // jakiej strefie faktycznie stoi postać, żeby drugie przytrzymanie E (bez zejścia ze strefy)
        // liczyło się jako potwierdzenie wyjścia podczas fazy work, a nie nowa próba od zera.
        eHoldStart = null;
        eActionFired = false;
        return;
      }
      held.delete(e.key);
    };
    const onBlur = () => {
      held.clear();
      cancelCharge();
      rollUntil = 0;
      dashUntil = 0;
      eDown = false;
      eHoldStart = null;
      eHoldSlug = null;
      eActionFired = false;
      persist(); // przełączenie na inne okno — tam ma zacząć się od tego miejsca
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      clearInterval(saveTimer);
      wsCleanedUp = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      realtimeWsRef.current = null;
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", persist);
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
    };
  }, [roomSlug, router, effectiveSpawnZoneSlug, netKey]);

  // Kanał pokoju: Presence mówi, kto jest i jak wygląda, Broadcast niesie pozycje i kule.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !ready || !spawned) return;
    const key = netKey;
    keyRef.current = key;
    const channel = sb.channel(`world3:${roomSlug}`, {
      config: { presence: { key } },
    });
    channelRef.current = channel;

    const sendPos = () =>
      channel.send({
        type: "broadcast",
        event: "pos",
        payload: { k: key, ...myPos.current },
      });

    channel
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const { k, x, y, d, r, dash } = payload as {
          k: string;
          x: number;
          y: number;
          d: unknown;
          r?: boolean;
          dash?: boolean;
        };
        if (k === key || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const prev = posRef.current[k];
        posRef.current[k] = { ...clampPos(x, y, isLobby), d: asDir(d), r: Boolean(r), dash: Boolean(dash) };
        if (!prev || prev.x !== posRef.current[k].x || prev.y !== posRef.current[k].y) {
          setWalkers((w) => (w[k] ? w : { ...w, [k]: true }));
          clearTimeout(walkTimers.current[k]);
          walkTimers.current[k] = setTimeout(() => setWalkers((w) => ({ ...w, [k]: false })), 300);
        }
        setOthers((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], ...posRef.current[k] } } : prev));
      })
      .on("broadcast", { event: "charge" }, ({ payload }) => {
        const { k, on } = payload as { k: string; on: boolean };
        if (k === key) return;
        if (on) chargingRef.current[k] = performance.now();
        else delete chargingRef.current[k];
      })
      .on("broadcast", { event: "fire" }, ({ payload }) => {
        const { k, x, y, d, p } = payload as {
          k: string;
          x: number;
          y: number;
          d: unknown;
          p: number;
        };
        if (k === key || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) return;
        delete chargingRef.current[k];
        // Faza F4 (docs/combat_sync_plan.md): once the combat server owns hits, this event is
        // only used above to clear the charging halo — the actual ball comes from realtime-
        // server's own "state" broadcast instead, so spawning a second, peer-simulated one here
        // would double-render the same shot.
        if (!REALTIME_SERVER_URL) {
          const px = clampPos(x, y, isLobby);
          const c = othersRef.current[k]?.color ?? "#ffffff";
          launch(ballsRef.current, px.x, px.y, asDir(d), clamp01(p), c, k);
        }
      })
      .on("broadcast", { event: "strike" }, ({ payload }) => {
        // Faza F4: no longer emitted by other clients once REALTIME_SERVER_URL is set (see the
        // KeyDown handler above) — this listener only still matters for the legacy path.
        if (REALTIME_SERVER_URL) return;
        const { k, x, y, d } = payload as { k: string; x: number; y: number; d: unknown };
        if (k === key || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const px = clampPos(x, y, isLobby);
        const c = othersRef.current[k]?.color ?? "#ffffff";
        strike(ballsRef.current, px.x, px.y, asDir(d), c, k);
      })
      .on("broadcast", { event: "reward" }, ({ payload }) => {
        const { k, coins, xp } = payload as { k: string; coins: number; xp: number };
        if (k === key || !Number.isFinite(coins) || !Number.isFinite(xp)) return;
        triggerReward(k, coins, xp);
      })
      .on("presence", { event: "sync" }, () => {
        const next: Others = {};
        // Jedno konto = jedna postać: o tym, która karta jest aktywna, decyduje useAccountLock
        // (wyparta karta robi untrack). Gdyby na moment zostały dwie, pokazujemy najświeższą,
        // a własne konto nigdy nie jest „innym”.
        const byUser = new Map<string, { k: string; at: number }>();
        const state = channel.presenceState<Meta>();
        for (const [k, metas] of Object.entries(state)) {
          const m = metas.reduce<Meta | null>((b, x) => (b && b.at >= x.at ? b : x), null);
          if (!m?.user) continue;
          const seen = byUser.get(m.user);
          if (!seen || m.at > seen.at) byUser.set(m.user, { k, at: m.at });
        }
        for (const [k, metas] of Object.entries(state)) {
          if (k === key) continue;
          const latest = metas.reduce<Meta | null>((b, m) => (b && b.at >= m.at ? b : m), null);
          if (!latest) continue;
          if (latest.user && (latest.user === userIdRef.current || byUser.get(latest.user)?.k !== k)) continue;
          // Pozycja z broadcastu jest świeższa; bez niej bierzemy tę z Presence (dołączenie).
          if (!posRef.current[k]) {
            if (!Number.isFinite(latest.x) || !Number.isFinite(latest.y)) continue;
            posRef.current[k] = { ...clampPos(latest.x!, latest.y!, isLobby), d: asDir(latest.d) };
          }
          next[k] = {
            ...latest,
            color: safeColor(latest.color),
            ...posRef.current[k],
          };
        }
        for (const k of Object.keys(posRef.current)) if (!next[k]) delete posRef.current[k];
        for (const k of Object.keys(chargingRef.current)) if (!next[k]) delete chargingRef.current[k];
        setOthers(next);
      })
      // Nowa osoba nie zna naszej pozycji, dopóki się nie ruszymy — podajemy ją od razu.
      .on("presence", { event: "join" }, ({ key: joined }) => {
        if (joined !== key) sendPos();
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        if (!activeRef.current) return;
        await channel.track({ ...metaRef.current, ...myPos.current, at: Date.now() });
        sendPos();
      });

    return () => {
      channelRef.current = null;
      posRef.current = {};
      chargingRef.current = {};
      setOthers({});
      sb.removeChannel(channel);
    };
  }, [roomSlug, ready, spawned, netKey]);

  // „Play here” w wypartej karcie: bierzemy postać z miejsca, gdzie zostawiła ją druga karta,
  // i przejmujemy konto z powrotem (tamta karta zostaje wyparta).
  const resume = async () => {
    if (!userId) return;
    const p = await fetchSpawn(userId, roomSlug);
    if (p) {
      myPos.current = p;
      spawnRef.current = p;
    }
    activeRef.current = true;
    await reclaim();
    const channel = channelRef.current;
    if (!channel) return;
    await channel.track({ ...metaRef.current, ...myPos.current, at: Date.now() });
    channel.send({ type: "broadcast", event: "pos", payload: { k: keyRef.current, ...myPos.current } });
  };

  // Wyparta karta przestaje sterować postacią i znika z pokoju.
  useEffect(() => {
    activeRef.current = !superseded;
    if (superseded) {
      for (const k of Object.keys(chargingRef.current)) delete chargingRef.current[k];
      void channelRef.current?.untrack();
    }
  }, [superseded]);

  // Pętla rysowania korzysta z aktualnej listy osób i własnego koloru bez przebudowy efektu.
  useEffect(() => {
    othersRef.current = others;
  }, [others]);

  // Zmiana koloru / nicku / XP (np. po zalogowaniu albo po heartbeacie) — odświeżamy wpis w Presence.
  useEffect(() => {
    colorRef.current = color;
    userIdRef.current = userId;
    metaRef.current = { at: Date.now(), color, nick, xp: profile.xp, user: userId };
    const channel = channelRef.current;
    if (channel?.state === "joined" && activeRef.current) void channel.track({ ...metaRef.current, ...myPos.current });
    // realtime-server only learns nick/color from the original `join` — this profile fetch
    // routinely resolves after that join already went out with useProfile's DEFAULT_COLOR
    // placeholder, so without this every ball this connection ever throws would keep the
    // placeholder color server-side forever (see realtimeWsRef's own doc comment).
    const socket = realtimeWsRef.current;
    if (REALTIME_SERVER_URL && socket && socket.readyState === WebSocket.OPEN) {
      const profileMsg: ClientMessage = { type: "profile", nick, color };
      socket.send(JSON.stringify(profileMsg));
    }
  }, [color, nick, profile.xp, userId]);

  useEffect(() => () => {
    if (entryErrorTimer.current) clearTimeout(entryErrorTimer.current);
  }, []);

  // Czat: Enter otwiera pole (domyślnie widok "room"), Tab przełącza na "all", Enter znowu wysyła.
  // Wysyłanie zawsze trafia do roomSlug — tam stoi postać — dymek nad nią widzą tylko inni w tym pokoju.
  const chat = useChat(roomSlug);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<"room" | "all">("room");
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  // "all" scope subskrybujemy zawsze (nie tylko gdy panel jest otwarty na tej zakładce) — to
  // źródło danych zarówno dla podglądu w panelu, jak i dla pływających toastów niżej, które mają
  // pokazywać wiadomości z całego serwera, a nie tylko z pokoju, w którym akurat stoi postać.
  const chatAll = useChat(roomSlug, { scope: "all" });
  const chatPreview = chatScope === "room" ? chat.messages : chatAll.messages;
  const chatListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatPreview]);

  // Publikujemy sterowanie tego pokoju do przycisku "How to play" w headerze (poza drzewem RoomStage) —
  // patrz src/lib/howToPlay.ts. Czyścimy przy odmontowaniu, żeby stary tekst nie wisiał po zmianie pokoju.
  useEffect(() => {
    let text =
      "Use the arrow keys ← ↑ ↓ → to move around · hold Space to charge a ball, release to shoot · tap C to roll in the direction you're facing (faster than walking) · tap V to dash further away in a puff of cloud (longer cooldown)";
    if (zones.some((z) => (z.kind ?? "nav") === "nav")) text += " · walk into a room and hold E to enter";
    if (zones.some((z) => z.kind === "action")) text += " · stand on a button and hold E to use it";
    if (chat.available && chat.canSend) text += " · Enter opens chat, Tab switches room/all";
    setHowToPlay(text);
    return () => setHowToPlay(null);
  }, [zones, chat.available, chat.canSend]);

  // Dymki: tylko dla naprawdę nowych wiadomości (nie dla historii wczytanej przy montowaniu).
  const [bubbles, setBubbles] = useState<Record<string, { text: string; id: string }>>({});
  const bubbleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Historia dociera asynchronicznie: dopóki się nie wczyta, nie ustalamy punktu odniesienia,
    // bo inaczej cała wczytana historia wygląda jak "nowe" wiadomości (dymki nad wszystkimi po
    // wejściu do pokoju, w którym już się było).
    if (!chat.loaded) return;
    const ids = new Set(chat.messages.map((m) => m.id));
    const seen = seenIdsRef.current;
    seenIdsRef.current = ids;
    if (!seen) return;
    for (const m of chat.messages) {
      if (seen.has(m.id)) continue;
      const k = m.user_id === userIdRef.current ? "me" : Object.entries(othersRef.current).find(([, o]) => o.user === m.user_id)?.[0];
      if (!k) continue;
      setBubbles((b) => ({ ...b, [k]: { text: m.body, id: m.id } }));
      clearTimeout(bubbleTimers.current[k]);
      bubbleTimers.current[k] = setTimeout(() => {
        setBubbles((b) => {
          const rest = { ...b };
          delete rest[k];
          return rest;
        });
      }, BUBBLE_MS);
    }
  }, [chat.messages, chat.loaded]);
  useEffect(() => {
    const timers = bubbleTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  // Toasty czatu: wiadomości z kanału "all", pokazywane w tym samym miejscu co panel czatu, gdy
  // panel jest zamknięty — znikają po BUBBLE_MS, tak jak dymek nad postacią (ten sam czas fadingu,
  // patrz .chat-fade w globals.css). Dopóki panel jest otwarty, te same wiadomości widać już w
  // liście czatu w dokładnie tym samym miejscu, więc toasty się chowają — stąd wrażenie, że
  // najnowsze wiadomości "nakrywają się 1-1" z listą po otwarciu.
  const [toasts, setToasts] = useState<ChatMessage[]>([]);
  const toastTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const toastSeenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!chatAll.loaded) return;
    const ids = new Set(chatAll.messages.map((m) => m.id));
    const seen = toastSeenIdsRef.current;
    toastSeenIdsRef.current = ids;
    if (!seen) return;
    for (const m of chatAll.messages) {
      if (seen.has(m.id)) continue;
      setToasts((t) => [...t, m]);
      toastTimers.current[m.id] = setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== m.id));
        delete toastTimers.current[m.id];
      }, BUBBLE_MS);
    }
  }, [chatAll.messages, chatAll.loaded]);
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  // Enter otwiera czat (poza polami tekstowymi) — dopóki jest otwarty, pole samo obsługuje swoje klawisze.
  useEffect(() => {
    if (chatOpen || !chat.available || !chat.canSend) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.documentElement.dataset.stale || isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, chat.available, chat.canSend]);

  useEffect(() => {
    if (chatOpen) chatInputRef.current?.focus();
  }, [chatOpen]);

  // Esc zamyka czat nawet gdy pole straciło focus (np. po kliknięciu poza czatem).
  useEffect(() => {
    if (!chatOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setChatOpen(false);
        setChatDraft("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen]);

  const onChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      setChatScope((s) => (s === "room" ? "all" : "room"));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setChatOpen(false);
      setChatDraft("");
    }
  };

  const onChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text || chatSending) {
      setChatOpen(false);
      setChatDraft("");
      return;
    }
    setChatSending(true);
    const ok = await chat.send(text);
    setChatSending(false);
    // Zamykamy tylko po udanym wysłaniu — przy błędzie (np. rate limit) tekst i panel zostają,
    // żeby było widać komunikat błędu i dało się spróbować jeszcze raz.
    if (ok) {
      setChatDraft("");
      setChatOpen(false);
    } else {
      chatInputRef.current?.focus();
    }
  };

  // Warstwa na cały ekran, pod treścią strony: postacie są „za” tekstem i czatem, lekko przygaszone.
  return (
    <>
    {showCongrats && (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-zinc-950/90 text-center backdrop-blur-sm">
        <p className="text-4xl font-bold text-amber-400">🎉 Congratulations!</p>
        <p className="text-lg text-zinc-200">Work session complete — heading back to the lobby…</p>
      </div>
    )}
    {entryError && (
      <div
        role="alert"
        className="pointer-events-none fixed left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-red-600/90 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        {entryError}
      </div>
    )}
    {isSharedTick && (
      <button
        type="button"
        onClick={handleLeaveRoom}
        className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-zinc-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-zinc-800 dark:bg-zinc-100/95 dark:text-zinc-900 dark:hover:bg-white"
      >
        Leave room
      </button>
    )}
    {REALTIME_SERVER_URL && (
      <div className="pointer-events-none fixed bottom-9 right-4 z-20 flex items-center gap-2">
        <span className="text-xs font-semibold tabular-nums text-white [text-shadow:0_1px_2px_rgb(0_0_0_/_0.8)]">
          {Math.max(0, myHp)}/{MAX_HP}
        </span>
        <div
          role="meter"
          aria-label="Health"
          aria-valuemin={0}
          aria-valuemax={MAX_HP}
          aria-valuenow={myHp}
          className="h-3 w-40 overflow-hidden rounded-full bg-zinc-900/80 shadow-lg outline outline-1 outline-black/40"
        >
          <div
            className="h-full rounded-full bg-red-600 transition-[width]"
            style={{ width: `${(Math.max(0, myHp) / MAX_HP) * 100}%` }}
          />
        </div>
      </div>
    )}
    {REALTIME_SERVER_URL && (
      <div className="pointer-events-none fixed bottom-4 right-4 z-20 flex items-center gap-2">
        {/* Text set directly in tick() via staminaTextRef, not React state — see its declaration
            above for why (stamina can regen/deplete every frame). */}
        <span
          ref={staminaTextRef}
          className="text-xs font-semibold tabular-nums text-white [text-shadow:0_1px_2px_rgb(0_0_0_/_0.8)]"
        >
          {Math.max(0, Math.round(myStamina))}/{myStaminaMax}
        </span>
        <div
          role="meter"
          aria-label="Stamina"
          aria-valuemin={0}
          aria-valuemax={myStaminaMax}
          aria-valuenow={Math.round(myStamina)}
          className="h-2 w-40 overflow-hidden rounded-full bg-zinc-900/80 shadow-lg outline outline-1 outline-black/40"
        >
          <div
            className="h-full rounded-full bg-green-500 transition-[width]"
            style={{ width: `${(Math.max(0, myStamina) / myStaminaMax) * 100}%` }}
          />
        </div>
      </div>
    )}
    {respawnRemainingSec > 0 && (
      <div className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-zinc-950/60">
        <p className="text-4xl font-extrabold text-red-500">You died…</p>
        <p className="text-lg font-medium text-zinc-200">Respawning in {respawnRemainingSec}…</p>
      </div>
    )}
    {REALTIME_SERVER_URL && wsStatus === "reconnecting" && (
      <div
        role="status"
        className="pointer-events-none fixed left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-zinc-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-zinc-100/95 dark:text-zinc-900"
      >
        Reconnecting…
      </div>
    )}
    {superseded && (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-zinc-950/40 pb-6 backdrop-blur-[2px]">
      <div
        role="alert"
        className="flex items-center gap-3 rounded-full bg-zinc-900/90 px-4 py-2 text-sm text-zinc-100 shadow-lg dark:bg-zinc-100/95 dark:text-zinc-900"
      >
        <span>Your account is active in another window.</span>
        <button
          type="button"
          onClick={() => void resume()}
          className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-900 hover:bg-white dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-black"
        >
          Play here
        </button>
      </div>
      </div>
    )}
    <div ref={stageRef} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left outline outline-1 outline-zinc-400/30"
        style={{ width: WORLD_W, height: WORLD_H }}
      >
        {isLobby && <DungeonBackground width={WORLD_W} height={WORLD_H} />}
        {Object.entries(others).map(([k, o]) => {
          // respawnAt > 0: this player just died — o.x/o.y/o.d is their corpse, frozen where it
          // dropped, and o.gx/o.gy/o.gd is the ghost they're still steering (see
          // PlayerState.gx/gy/gd's doc comment in realtime-server/shared/types.ts). Both render,
          // for everyone in the room, until respawnAt clears.
          const dead = Boolean(o.respawnAt && o.respawnAt > 0);
          return (
            <div key={k}>
              {dead && (
                <div className="absolute left-0 top-0" style={{ transform: `translate(${o.x}px, ${o.y}px)`, opacity: GHOST_OPACITY }}>
                  <NameTag name={o.nick} xp={o.user ? o.xp : undefined} />
                  <PlayerSprite label={o.nick ?? NO_NAME} size={PERSON_W / 8} dir={o.d} walking={false} rolling={false} dashing={false} />
                </div>
              )}
              <div
                className={`absolute left-0 top-0 ease-linear ${o.dash ? "" : "transition-transform duration-100"}`}
                style={{
                  transform: `translate(${dead ? (o.gx ?? o.x) : o.x}px, ${dead ? (o.gy ?? o.y) : o.y}px)`,
                  // Lower opacity while immune (post-respawn grace window) or ghost (mid-respawn
                  // countdown, see GHOST_OPACITY) — see IMMUNE_OPACITY in
                  // realtime-server/shared/constants.ts. `others` re-renders every state broadcast
                  // (~BROADCAST_MS) regardless of movement, so this clears on its own.
                  opacity: dead ? GHOST_OPACITY : o.immuneUntil && o.immuneUntil > nowTick ? IMMUNE_OPACITY : 0.7,
                  filter: dead ? "grayscale(1) brightness(1.3)" : undefined,
                }}
              >
                {bubbles[k] && <ChatBubble text={bubbles[k].text} />}
                {rewards[k] && <RewardPopup coins={rewards[k].coins} xp={rewards[k].xp} id={rewards[k].id} />}
                <NameTag name={o.nick} xp={o.user ? o.xp : undefined} />
                <PlayerSprite
                  label={o.nick ?? NO_NAME}
                  size={PERSON_W / 8}
                  dir={dead ? (o.gd ?? o.d) : o.d}
                  walking={!dead && walkers[k] && !o.r && !o.dash}
                  rolling={o.r}
                  dashing={o.dash}
                />
              </div>
            </div>
          );
        })}
        {myCorpse && (
          <div
            className="absolute left-0 top-0 opacity-40 grayscale"
            style={{ transform: `translate(${myCorpse.x}px, ${myCorpse.y}px)` }}
          >
            <NameTag name={nick} xp={session ? profile.xp : undefined} />
            <PlayerSprite label={nick ?? NO_NAME} size={PERSON_W / 8} dir={myCorpse.d} walking={false} rolling={false} dashing={false} />
          </div>
        )}
        <div
          ref={personRef}
          className={`absolute left-0 top-0 opacity-70 will-change-transform ${superseded ? "invisible" : ""}`}
        >
          {bubbles.me && <ChatBubble text={bubbles.me.text} />}
          {rewards.me && <RewardPopup coins={rewards.me.coins} xp={rewards.me.xp} id={rewards.me.id} />}
          <NameTag name={nick} xp={session ? profile.xp : undefined} />
          <PlayerSprite
            label={nick ?? NO_NAME}
            size={PERSON_W / 8}
            dir={myDir}
            walking={myWalking}
            rolling={myRolling}
            dashing={myDashing}
          />
        </div>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
    {!chatOpen && toasts.length > 0 && (
      // Toasty z kanału "all": ta sama pozycja (fixed inset-x-0 bottom-6, ta sama kolumna po
      // odjęciu pustego miejsca na przełącznik room/all) co lista wiadomości w panelu poniżej —
      // dzięki temu, gdy panel się otworzy, ostatnia wiadomość ląduje dokładnie tam, gdzie przed
      // chwilą był jej toast ("nakrywają się 1-1").
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
        <div className="flex w-full max-w-xl items-end gap-2">
          {/* Niewidzialny klon przełącznika room/all z panelu niżej — samo utrzymanie tej samej
              szerokości (a nie zgadywanie px) gwarantuje, że kolumna wiadomości wyląduje dokładnie
              tam, gdzie w otwartym panelu, niezależnie od fontu/zawartości przycisków. */}
          <div className="invisible flex shrink-0 flex-col gap-1 rounded-xl p-1 text-xs" aria-hidden>
            <span className="px-2 py-1.5">Room</span>
            <span className="px-2 py-1.5">All</span>
          </div>
          <div className="flex h-64 flex-1 flex-col justify-end gap-1.5 overflow-hidden p-3 text-sm">
            {toasts.slice(-6).map((m) => (
              <p key={m.id} className="chat-fade break-words text-zinc-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                <span className="mr-1 rounded bg-zinc-800/70 px-1.5 py-0.5 text-xs text-zinc-300">{roomLabel(m.room_slug)}</span>
                <span className="font-medium text-sky-300">
                  {m.authorXp !== undefined && <LevelBadge xp={m.authorXp} className="mr-1" />}
                  {m.author}:{" "}
                </span>
                {m.body}
              </p>
            ))}
          </div>
        </div>
      </div>
    )}
    {chatOpen && (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
        <div className="pointer-events-auto flex w-full max-w-xl items-end gap-2">
          <div className="flex shrink-0 flex-col gap-1 rounded-xl bg-zinc-900/90 p-1 text-xs shadow-lg backdrop-blur dark:bg-zinc-100/90">
            <button
              type="button"
              onClick={() => setChatScope("room")}
              className={`rounded-lg px-2 py-1.5 ${chatScope === "room" ? "bg-zinc-700 text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-200 dark:text-zinc-600 dark:hover:text-zinc-800"}`}
            >
              Room
            </button>
            <button
              type="button"
              onClick={() => setChatScope("all")}
              className={`rounded-lg px-2 py-1.5 ${chatScope === "all" ? "bg-zinc-700 text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-200 dark:text-zinc-600 dark:hover:text-zinc-800"}`}
            >
              All
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div
              ref={chatListRef}
              className="flex h-64 flex-col gap-1.5 overflow-y-auto rounded-xl bg-zinc-900/5 p-3 text-sm shadow-lg backdrop-blur-[1px]"
            >
              {chatPreview.length === 0 ? (
                <p className="m-auto text-xs text-zinc-500">No messages yet.</p>
              ) : (
                chatPreview.map((m) => (
                  <p key={m.id} className="break-words text-zinc-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                    {chatScope === "all" && (
                      <span className="mr-1 rounded bg-zinc-800/70 px-1.5 py-0.5 text-xs text-zinc-300">{roomLabel(m.room_slug)}</span>
                    )}
                    <span className="font-medium text-sky-300">
                      {m.authorXp !== undefined && <LevelBadge xp={m.authorXp} className="mr-1" />}
                      {m.author}:{" "}
                    </span>
                    {m.body}
                  </p>
                ))
              )}
            </div>
            {chat.error && <p className="text-xs text-rose-400">{chat.error}</p>}
            <form
              onSubmit={(e) => void onChatSubmit(e)}
              className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-2 shadow-lg backdrop-blur dark:bg-zinc-100/90"
            >
              <input
                ref={chatInputRef}
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={onChatKeyDown}
                maxLength={MAX_BODY}
                disabled={chatSending}
                placeholder="Message… Tab: room/all · Enter: send · Esc: close"
                className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 dark:text-zinc-900"
              />
            </form>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
