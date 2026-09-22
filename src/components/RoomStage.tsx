"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DungeonBackground } from "@/components/DungeonBackground";
import { LevelBadge } from "@/components/LevelBadge";
import { DIR_DOWN, type Dir, PixelPerson } from "@/components/PixelPerson";
import { getAdminSettings } from "@/lib/adminSettings";
import { setHowToPlay } from "@/lib/howToPlay";
import { roomLabel } from "@/lib/rooms";
import { getSupabase } from "@/lib/supabase";
import { formatMs, getTimerState } from "@/lib/timer";
import { useAccountLock } from "@/lib/useAccountLock";
import { MAX_BODY, useChat } from "@/lib/useChat";
import { safeColor, useMyProfile } from "@/lib/useProfile";
import { useServerNow } from "@/lib/useServerClock";
import { useSession } from "@/lib/useSession";
import { coinsForMinutes } from "@/lib/coins";
import { useStudyXp } from "@/lib/useStudyXp";
import { xpForMinutes } from "@/lib/xp";
import type { ClientMessage, ServerMessage } from "../../realtime-server/shared/types";

/** Kolor etykiety fazy pod kwadratem pokoju: praca na czerwono (nie da się teraz wejść), przerwa na zielono. */
const PHASE_COLOR = { work: "#ef4444", break: "#22c55e" } as const;

/** Pisanie w polu/textarea/select nie może być przechwycone przez sterowanie postacią ani skrótem otwierającym czat. */
function isTypingTarget(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Ekran startowy (jednostki): rozmiar okna kamery — tyle widać naraz, niezależnie od rozmiaru mapy. */
const SCREEN_W = 1600;
const SCREEN_H = 900;
/**
 * Cała mapa: w lobby 2× szersza i 2× wyższa niż ekran (4 ekrany łącznie, 4× powierzchnia) — reszta
 * poza startowym ekranem jest pusta, chodząc od startu w stronę krawędzi kamera ją odsłania, dopóki
 * nie trafi na koniec mapy (patrz applyCamera niżej). Pojedynczy pokój jest 4× mniejszy (mapa =
 * ekran, jak dawniej) — nie ma tam po co odkrywać pustki dookoła.
 */
const worldW = (isLobby: boolean) => (isLobby ? SCREEN_W * 2 : SCREEN_W);
const worldH = (isLobby: boolean) => (isLobby ? SCREEN_H * 2 : SCREEN_H);
/** Prędkość gracza w jednostkach świata na sekundę — domyślna albo nadpisana z panelu admina, patrz playerSpeed w src/lib/adminSettings.ts. */
const playerSpeed = () => getAdminSettings().playerSpeed;
const PERSON_W = 32;
const PERSON_H = 48;
/** Miejsce nad postacią na podpis — postać nie wchodzi wyżej, żeby podpis się nie ucinał. */
const TAG_H = 18;
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
/** Najczęściej co ile ms wysyłamy własną pozycję. */
const SEND_EVERY = 60;

/**
 * Serwer walidujący ruch (realtime-server/, patrz docs/stateful_server_plan.md) — ustawiony
 * tylko na tej gałęzi/deployu podglądowym. Bez tej zmiennej zachowanie jest identyczne jak
 * wcześniej: cały kod z nią związany w tym pliku jest wtedy pomijany.
 */
const REALTIME_SERVER_URL = process.env.NEXT_PUBLIC_REALTIME_SERVER_URL || null;

/** Jak długo wisi dymek z wiadomością nad postacią, zanim zniknie sam. */
const BUBBLE_MS = 6000;

/**
 * Jak długo wisi popup "+1 🪙 · +XP" nad postacią po co-minutowym tick-u nagrody, zanim go
 * usuniemy ze stanu (musi być >= czasu animacji pp-reward w globals.css, żeby fade dograł do końca).
 */
const REWARD_MS = 1500;

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** Wektory ośmiu kierunków (kolejność jak w Dir: E, SE, S, SW, W, NW, N, NE). */
const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
/** Kierunek z kierunku ruchu: DIR_OF[dy + 1][dx + 1]. */
const DIR_OF: Dir[][] = [
  [5, 6, 7],
  [4, DIR_DOWN, 0],
  [3, 2, 1],
];

/** Tyle trzyma się spacja do pełnego naładowania kuli. */
const CHARGE_MS = 3000;
/**
 * Przewrót (roll): krótki, szybki skok w kierunku w który patrzy postać (jak kula z launch() —
 * ten sam wektor z DIRS), o tyle szybszy niż zwykły chód. ROLL_MS musi się zgadzać z czasem
 * animacji .pp-roll w globals.css.
 */
const ROLL_SPEED_MULT = 2.5;
const ROLL_MS = 240;
/** Ile ms po zakończeniu przewrotu trzeba odczekać, zanim C znów go uruchomi. */
const ROLL_COOLDOWN_MS = 260;
/**
 * Unik (dash, V): krótki teleport w kierunku w który patrzy postać — dalej niż przewrót, ale bez
 * pokonywania drogi po drodze. Postać znika (jakby za chmurą) w połowie DASH_MS i w tej samej
 * chwili ląduje w docelowym miejscu, po czym się z powrotem pojawia. Czas musi się zgadzać
 * z animacją .pp-dash w globals.css.
 */
const DASH_DISTANCE_MULT = 1.8;
const DASH_MS = 220;
const DASH_TELEPORT_AT_MS = DASH_MS / 2;
/** Cooldown unik-u jest 4× dłuższy niż cooldown przewrotu. */
const DASH_COOLDOWN_MS = ROLL_COOLDOWN_MS * 4;
const ORB_R_MIN = 5;
const ORB_R_MAX = 30;
/** Prędkość lotu kuli w px na sekundę. */
const BALL_SPEED = 520;
/**
 * Atak wręcz (Fist swings, klawisz 1): krótki zasięg, bez ładowania — uderza od razu po Space,
 * zamiast lecieć jak kula. Hitbox pojawia się tuż przed postacią i znika po STRIKE_MS.
 */
const STRIKE_REACH = 22;
const STRIKE_R = 20;
const STRIKE_MS = 150;
/** Cooldown między atakami wręcz, żeby nie dało się spamować Space bez ograniczeń. */
const STRIKE_COOLDOWN_MS = 260;

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

/** Czas trwania animacji uderzenia (ms) i życia odłamków kuli. */
const HIT_MS = 350;
const SHARD_MS = 500;
/** Hitbox postaci: prostokąt sylwetki powiększony o tyle px z każdej strony. */
const HIT_PAD = 4;

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
  const nx = Math.max(px - HIT_PAD, Math.min(b.x, px + PERSON_W + HIT_PAD));
  const ny = Math.max(py - HIT_PAD, Math.min(b.y, py + PERSON_H + HIT_PAD));
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
type Pos = { x: number; y: number; d: Dir; r?: boolean; dash?: boolean };
type Others = Record<string, Meta & Pos>;

const orbRadius = (p: number) => ORB_R_MIN + (ORB_R_MAX - ORB_R_MIN) * p;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const asDir = (d: unknown): Dir =>
  Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 7 ? (d as Dir) : DIR_DOWN;

/** Ogranicza pozycję (np. z sieci) do planszy. */
const clampPos = (x: number, y: number, isLobby: boolean) => ({
  x: Math.min(worldW(isLobby) - PERSON_W, Math.max(0, x)),
  y: Math.min(worldH(isLobby) - PERSON_H, Math.max(TAG_H, y)),
});

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

/** Podpis nad postacią: poziom (zalogowana osoba) i nick albo [no-name]. */
function NameTag({ name, xp }: { name: string | null; xp?: number }) {
  return (
    <span
      className="absolute bottom-full left-1/2 mb-0.5 flex max-w-40 -translate-x-1/2 items-center gap-1 whitespace-nowrap text-xs leading-4 text-zinc-700 dark:text-zinc-200"
      style={{ height: TAG_H - 2 }}
    >
      {xp !== undefined && <LevelBadge xp={xp} />}
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
      className="pp-reward absolute bottom-full left-1/2 mb-5 whitespace-nowrap text-xs font-bold text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
    >
      {parts.join(" · ")}
    </span>
  );
}

/** Dymek nad postacią z jej ostatnią wiadomością — znika sam po BUBBLE_MS. */
function ChatBubble({ text }: { text: string }) {
  return (
    <div className="absolute bottom-full left-1/2 mb-5 max-w-48 -translate-x-1/2 whitespace-pre-wrap break-words rounded-xl bg-white px-2.5 py-1.5 text-center text-xs text-zinc-900 shadow-lg after:absolute after:left-1/2 after:top-full after:-ml-1.5 after:border-4 after:border-transparent after:border-t-white">
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
  // Credits XP for time spent in this room (no-op in the lobby or signed out) — see
  // supabase/migrations/0010_xp.sql and 0014_timer_xp_rate.sql. `xpRunning` gates accrual (used
  // by the Timer Room, see prop doc above); for pomodoro rooms it's further gated to the "work"
  // phase only — no XP/coins while waiting for work to start or during the break. Own XP then
  // updates live via useMyProfile's Realtime sub.
  const xpAccruing = xpRunning && (roomPhase === null || roomPhase === "work");

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
  // Pokój bez `phase` (Timer Room, patrz src/components/TimerRoom.tsx) ma indywidualny stoper —
  // tick nagrody widzi tylko właściciel, nie jest rozgłaszany do innych w pokoju.
  const isSharedTick = phase !== undefined;
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
  const myPos = useRef<Pos>({
    ...clampPos(WORLD_W / 2, WORLD_H / 2, isLobby),
    d: DIR_DOWN,
  });
  const [myDir, setMyDir] = useState<Dir>(DIR_DOWN);
  const [myWalking, setMyWalking] = useState(false);
  const [myRolling, setMyRolling] = useState(false);
  const [myDashing, setMyDashing] = useState(false);
  // Kto z innych właśnie się porusza (do animacji chodu) i timery wygaszania.
  const [walkers, setWalkers] = useState<Record<string, boolean>>({});
  const walkTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ballsRef = useRef<Ball[]>([]);
  const shardsRef = useRef<Shard[]>([]);
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
    /** Wybrany atak: 1 = wręcz (Fist swings, krótki zasięg), 2 = kula (domyślny, jak dotąd). */
    let attackMode: 1 | 2 = 2;
    /** Koniec cooldownu ataku wręcz (performance.now), żeby Space nie spamowało uderzeń. */
    let strikeCooldownUntil = 0;
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
    const ws = REALTIME_SERVER_URL ? new WebSocket(REALTIME_SERVER_URL) : null;
    // Ostatnia znana pozycja z serwera dla nas — czeka tu na najbliższą klatkę tick().
    let serverMe: { x: number; y: number; d: number } | null = null;
    if (ws) {
      ws.addEventListener("open", () => {
        const join: ClientMessage = {
          type: "join",
          id: netKey,
          roomSlug,
          userId: userIdRef.current,
          nick: metaRef.current.nick,
          color: colorRef.current,
        };
        ws.send(JSON.stringify(join));
      });
      ws.addEventListener("message", (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.type !== "state") return;
        for (const p of msg.players) {
          if (p.id === netKey) {
            serverMe = { x: p.x, y: p.y, d: p.d };
            continue;
          }
          // Mirrors the Supabase "pos" broadcast handler below (same posRef/setOthers/setWalkers
          // pattern) — posRef alone wouldn't trigger a re-render, `others` state has to change too.
          const prevPos = posRef.current[p.id];
          const nextPos = { ...clampPos(p.x, p.y, isLobby), d: asDir(p.d) };
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
      });
    }
    let lastInputSent = 0;

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
      const p = Math.min(1, (performance.now() - chargeStart) / CHARGE_MS);
      chargeStart = null;
      if (!activeRef.current) return;
      launch(ballsRef.current, x, y, dir, p, colorRef.current, keyRef.current || "me");
      emit("fire", { ...myPos.current, p });
      // Every real shot by a signed-in user bumps their all-time count (shown in
      // src/components/ProfileMenu.tsx), server-side via supabase/migrations/0012_balls_shot.sql.
      if (userIdRef.current)
        void getSupabase()
          ?.rpc("increment_balls_shot")
          .then(({ error }) => {
            if (error) console.error("increment_balls_shot", error);
          });
    };
    const cancelCharge = () => {
      if (chargeStart === null) return;
      chargeStart = null;
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
          ctx.font = "20px sans-serif";
          ctx.fillText("🔒", z.x + z.w / 2, z.y + z.h / 2 - 6);
        } else {
          ctx.font = "600 16px sans-serif";
          ctx.fillText(z.name, z.x + z.w / 2, z.y + z.h / 2 - 6);
        }
        // Pod numerem/kłódką: stojąc na wyjściu (kwadrat "lobby" na scenie samego pokoju) — zielony
        // "E to exit room"; stojąc na wejściu — zielony "E to enter room" (albo "Room is closed",
        // gdy trwa faza work i wejście jest zablokowane); w innym wypadku prawdziwa liczba osób
        // w pokoju, ale tylko gdy ktoś tam jest.
        const occupants = occupancyRef.current?.[z.slug];
        const isExitHere = roomSlug !== "lobby" && z.slug === "lobby";
        // Pokój zamknięty (trwa faza work): pokazujemy tylko kłódkę i czerwone odliczanie pod
        // kwadratem (patrz niżej, phaseState) — żadnych innych informacji (nagroda, liczba osób,
        // teksty przy wejściu w strefę).
        const workClosed = phaseState?.phase === "work";
        // Nagroda XP tego pokoju i długość faz: pod numerem/kłódką, zawsze widoczna (nie tylko
        // stojąc na kwadracie) — dla pomodoro to praca+przerwa w minutach i nagroda za całą sesję
        // pracy, dla stopwatch/timer stała stawka za ciągłą obecność (patrz STUDY_SECONDS_PER_XP
        // w src/lib/xp.ts).
        if ((z.kind ?? "nav") === "nav" && !isExitHere && !z.noReward && !workClosed) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = "600 10px sans-serif";
          ctx.fillText(z.phase ? `${z.phase.workMin}+${z.phase.breakMin} min` : "no timer", z.x + z.w / 2, z.y + z.h / 2 + 10);
          ctx.fillStyle = "#fbbf24";
          ctx.font = "700 10px sans-serif";
          ctx.fillText(
            z.phase
              ? `+${xpForMinutes(z.phase.workMin)} XP · +${coinsForMinutes(z.phase.workMin)} coins/session`
              : "+0.1 XP/5min · +0.1 coins/min while running",
            z.x + z.w / 2,
            z.y + z.h / 2 + 22,
          );
        }
        if (inZone(x, y, z) && (z.kind ?? "nav") === "nav" && !workClosed) {
          if (isExitHere) {
            ctx.fillStyle = "#22c55e";
            ctx.font = "700 12px sans-serif";
            ctx.fillText("E to exit room", z.x + z.w / 2, z.y + z.h / 2 + 38);
          } else if (authLocked) {
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.font = "700 12px sans-serif";
            ctx.fillText("Sign in required", z.x + z.w / 2, z.y + z.h / 2 + 38);
          } else {
            ctx.fillStyle = "#22c55e";
            ctx.font = "700 12px sans-serif";
            ctx.fillText("E to enter room", z.x + z.w / 2, z.y + z.h / 2 + 38);
          }
        } else if (occupants && !workClosed) {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.font = "500 12px sans-serif";
          ctx.fillText(`${occupants} player${occupants === 1 ? "" : "s"} inside`, z.x + z.w / 2, z.y + z.h / 2 + 38);
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
          ctx.font = "700 14px sans-serif";
          ctx.fillText(
            `${state.phase === "work" ? "WORK" : "STARTS IN"} · ${formatMs(state.remainingMs)}`,
            z.x + z.w / 2,
            z.y + z.h + 20,
          );
          const barW = z.w - 16;
          const barY = z.y + z.h + 32;
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
      for (const b of ballsRef.current) {
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
        ctx.roundRect(px, py, PERSON_W, PERSON_H, 8);
        ctx.fill();
        ctx.globalAlpha = f;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px + PERSON_W / 2, py + PERSON_H / 2, 14 + (1 - f) * 26, 0, Math.PI * 2);
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
    };

    const burst = (b: Ball, t: number) => {
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
      // Pozycja wczytana z bazy zastępuje losowy start.
      const spawn = spawnRef.current;
      if (spawn) {
        spawnRef.current = null;
        x = spawn.x;
        y = spawn.y;
        dir = spawn.d;
        setMyDir(spawn.d);
      }
      // Korekta z serwera ruchu (patrz WS wyżej) — pomijana w trakcie przewrotu/uniku, żeby ich
      // krótka, czysto lokalna animacja nie została ucięta w pół; zaraz po niej i tak wróci do
      // pozycji z serwera przy najbliższym rozgłoszeniu (patrz BROADCAST_MS w realtime-server/).
      if (serverMe && !rollingNow && !dashingNow) {
        x = serverMe.x;
        y = serverMe.y;
        const newDir = asDir(serverMe.d);
        if (newDir !== dir) {
          dir = newDir;
          setMyDir(newDir);
        }
        serverMe = null;
      }
      const on = activeRef.current;
      const dashing = on && t < dashUntil;
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
      const rolling = !dashing && on && t < rollUntil;
      if (rolling !== rollingNow) {
        rollingNow = rolling;
        setMyRolling(rolling);
      }
      const dx = dashing
        ? 0
        : rolling
          ? rollDx
          : on
            ? (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0)
            : 0;
      const dy = dashing
        ? 0
        : rolling
          ? rollDy
          : on
            ? (held.has("ArrowDown") ? 1 : 0) - (held.has("ArrowUp") ? 1 : 0)
            : 0;
      // Surowa intencja ruchu (bez przewrotu/uniku — serwer ich jeszcze nie zna, patrz
      // docs/stateful_server_plan.md) wysyłana do serwera ruchu. Niezależnie od `dirty`
      // (które dotyczy pozycji, nie intencji) — inaczej puszczenie strzałki nigdy by się nie
      // wysłało, gdyby akurat ostatnia klatka ruchu nie zmieniła pozycji.
      if (ws && ws.readyState === WebSocket.OPEN && t - lastInputSent >= SEND_EVERY) {
        const rawDx = on ? (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0) : 0;
        const rawDy = on ? (held.has("ArrowDown") ? 1 : 0) - (held.has("ArrowUp") ? 1 : 0) : 0;
        const input: ClientMessage = { type: "input", dx: rawDx as -1 | 0 | 1, dy: rawDy as -1 | 0 | 1 };
        ws.send(JSON.stringify(input));
        lastInputSent = t;
      }
      const moving = !rolling && !dashing && Boolean(dx || dy);
      if (moving !== walkingNow) {
        walkingNow = moving;
        setMyWalking(moving);
      }
      if (!rolling && !dashing && (dx || dy)) {
        const nd = DIR_OF[dy + 1][dx + 1];
        if (nd !== dir) {
          dir = nd;
          setMyDir(nd);
          dirty = true;
        }
      }
      const norm = !rolling && dx && dy ? Math.SQRT1_2 : 1;
      const speed = playerSpeed() * (rolling ? ROLL_SPEED_MULT : 1);
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
      draw(t);
      raf = requestAnimationFrame(tick);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current || document.documentElement.dataset.stale || isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey)
        return;
      if (e.code === "Digit1") {
        attackMode = 1;
        return;
      }
      if (e.code === "Digit2") {
        attackMode = 2;
        return;
      }
      if (e.code === "Space") {
        e.preventDefault(); // spacja nie przewija strony ani nie klika fokusowanego przycisku
        if (attackMode === 1) {
          if (!e.repeat) {
            const now = performance.now();
            if (now >= strikeCooldownUntil) {
              strikeCooldownUntil = now + STRIKE_COOLDOWN_MS;
              strike(ballsRef.current, x, y, dir, colorRef.current, keyRef.current || "me");
              emit("strike", { ...myPos.current });
              // Every real swing by a signed-in user bumps their all-time count (shown in
              // src/components/ProfileMenu.tsx), server-side via supabase/migrations/0023_fist_swings.sql.
              if (userIdRef.current)
                void getSupabase()
                  ?.rpc("increment_fist_swings")
                  .then(({ error }) => {
                    if (error) console.error("increment_fist_swings", error);
                  });
            }
          }
          return;
        }
        if (!e.repeat && chargeStart === null) {
          chargeStart = performance.now();
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
            const dashDistance = playerSpeed() * ROLL_SPEED_MULT * (ROLL_MS / 1000) * DASH_DISTANCE_MULT;
            const maxX = WORLD_W - PERSON_W;
            const maxY = WORLD_H - PERSON_H;
            dashTargetX = Math.max(0, Math.min(maxX, x + (ux / n) * dashDistance));
            dashTargetY = Math.max(TAG_H, Math.min(maxY, y + (uy / n) * dashDistance));
            dashTeleportAt = now + DASH_TELEPORT_AT_MS;
            dashUntil = now + DASH_MS;
            dashCooldownUntil = dashUntil + DASH_COOLDOWN_MS;
            dashTeleported = false;
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
      ws?.close();
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
        const px = clampPos(x, y, isLobby);
        const c = othersRef.current[k]?.color ?? "#ffffff";
        launch(ballsRef.current, px.x, px.y, asDir(d), clamp01(p), c, k);
      })
      .on("broadcast", { event: "strike" }, ({ payload }) => {
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
  const chatAll = useChat(roomSlug, { scope: "all", enabled: chatOpen && chatScope === "all" });
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
      "Use the arrow keys ← ↑ ↓ → to move around · press 1 for Fist swings (short-range, tap Space to hit) or 2 for the ball (hold Space to charge, release to shoot) · tap C to roll in the direction you're facing (faster than walking) · tap V to dash further away in a puff of cloud (longer cooldown)";
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
    {entryError && (
      <div
        role="alert"
        className="pointer-events-none fixed left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-red-600/90 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        {entryError}
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
        {Object.entries(others).map(([k, o]) => (
          <div
            key={k}
            className={`absolute left-0 top-0 opacity-70 ease-linear ${o.dash ? "" : "transition-transform duration-100"}`}
            style={{ transform: `translate(${o.x}px, ${o.y}px)` }}
          >
            {bubbles[k] && <ChatBubble text={bubbles[k].text} />}
            {rewards[k] && <RewardPopup coins={rewards[k].coins} xp={rewards[k].xp} id={rewards[k].id} />}
            <NameTag name={o.nick} xp={o.user ? o.xp : undefined} />
            <PixelPerson
              color={o.color}
              label={o.nick ?? NO_NAME}
              size={PERSON_W / 8}
              dir={o.d}
              walking={walkers[k] && !o.r && !o.dash}
              rolling={o.r}
              dashing={o.dash}
            />
          </div>
        ))}
        <div
          ref={personRef}
          className={`absolute left-0 top-0 opacity-70 will-change-transform ${superseded ? "invisible" : ""}`}
        >
          {bubbles.me && <ChatBubble text={bubbles.me.text} />}
          {rewards.me && <RewardPopup coins={rewards.me.coins} xp={rewards.me.xp} id={rewards.me.id} />}
          <NameTag name={nick} xp={session ? profile.xp : undefined} />
          <PixelPerson
            color={color}
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
              className="flex h-64 flex-col gap-1.5 overflow-y-auto rounded-xl bg-zinc-900/85 p-3 text-sm shadow-lg backdrop-blur"
            >
              {chatPreview.length === 0 ? (
                <p className="m-auto text-xs text-zinc-500">No messages yet.</p>
              ) : (
                chatPreview.map((m) => (
                  <p key={m.id} className="break-words text-zinc-200">
                    {chatScope === "all" && (
                      <span className="mr-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{roomLabel(m.room_slug)}</span>
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
