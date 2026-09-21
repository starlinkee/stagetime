"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { DIR_DOWN, type Dir, PixelPerson } from "@/components/PixelPerson";
import { getSupabase } from "@/lib/supabase";
import { safeColor, useMyProfile } from "@/lib/useProfile";
import { useSession } from "@/lib/useSession";

/** Stały świat gry (jednostki): każdy widzi tę samą planszę, okno tylko ją skaluje. */
const WORLD_W = 1600;
const WORLD_H = 900;
/** Prędkość w jednostkach świata na sekundę. */
const SPEED = 220;
const PERSON_W = 32;
const PERSON_H = 48;
/** Miejsce nad postacią na podpis — postać nie wchodzi wyżej, żeby podpis się nie ucinał. */
const TAG_H = 18;
/** Minimalny odstęp losowego miejsca startu w pokoju od krawędzi ekranu. */
const SPAWN_MARGIN = 80;
const NO_NAME = "[no-name]";
/** Najczęściej co ile ms wysyłamy własną pozycję. */
const SEND_EVERY = 60;

/** Hint o strzałkach: tyle ms w pełni widoczny, potem tyle ms zanikania. */
const HINT_MS = 5000;
const HINT_FADE_MS = 1000;

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
const ORB_R_MIN = 5;
const ORB_R_MAX = 30;
/** Prędkość lotu kuli w px na sekundę. */
const BALL_SPEED = 520;

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  owner: string;
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
  /** Id zalogowanego użytkownika (null bez konta) — jedno konto to jedna postać. */
  user?: string | null;
  x?: number;
  y?: number;
  d?: unknown;
};
/** Pozycja lewego górnego rogu postaci w jednostkach świata, plus kierunek. */
type Pos = { x: number; y: number; d: Dir };
type Others = Record<string, Meta & Pos>;

const orbRadius = (p: number) => ORB_R_MIN + (ORB_R_MAX - ORB_R_MIN) * p;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const asDir = (d: unknown): Dir =>
  Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 7 ? (d as Dir) : DIR_DOWN;

/** Ogranicza pozycję (np. z sieci) do planszy. */
const clampPos = (x: number, y: number) => ({
  x: Math.min(WORLD_W - PERSON_W, Math.max(0, x)),
  y: Math.min(WORLD_H - PERSON_H, Math.max(TAG_H, y)),
});

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

/** Podpis nad postacią: nick zalogowanej osoby albo [no-name]. */
function NameTag({ name }: { name: string | null }) {
  return (
    <span
      className="absolute bottom-full left-1/2 mb-0.5 max-w-40 -translate-x-1/2 truncate whitespace-nowrap text-xs leading-4 text-zinc-700 dark:text-zinc-200"
      style={{ height: TAG_H - 2 }}
    >
      {name?.trim() || NO_NAME}
    </span>
  );
}

/**
 * Cały ekran jest sceną: własną postacią (biała bez konta, w kolorze profilu po zalogowaniu)
 * chodzi się strzałkami, a postaci wszystkich osób z pokoju są widoczne dla każdego.
 * Przytrzymana spacja ładuje nad postacią kulę (do 3 s), puszczona wystrzeliwuje ją w stronę,
 * w którą patrzy postać.
 */
export function RoomStage({ roomSlug }: { roomSlug: string }) {
  const { ready, session } = useSession();
  const profile = useMyProfile();
  const color = session ? profile.color : "#ffffff";
  const nick = session ? profile.nickname : null;
  const userId = session?.user.id ?? null;

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const personRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [others, setOthers] = useState<Others>({});
  // Klucz tej karty w kanale; pozycje innych trzymamy osobno od Presence.
  const keyRef = useRef("");
  const posRef = useRef<Record<string, Pos>>({});
  const metaRef = useRef<Meta>({ at: 0, color, nick, user: userId });
  const myPos = useRef<Pos>({
    ...clampPos(WORLD_W / 2, WORLD_H / 2),
    d: DIR_DOWN,
  });
  const [myDir, setMyDir] = useState<Dir>(DIR_DOWN);
  const [myWalking, setMyWalking] = useState(false);
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

  // Ruch własnej postaci, kule i wysyłanie pozycji.
  useEffect(() => {
    const stage = stageRef.current;
    const world = worldRef.current;
    const person = personRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!stage || !world || !person || !canvas || !ctx) return;

    // Dopasowanie planszy do okna: jedna skala, plansza wyśrodkowana (pasy po bokach).
    const resize = () => {
      const scale = Math.min(stage.clientWidth / WORLD_W, stage.clientHeight / WORLD_H);
      const ox = (stage.clientWidth - WORLD_W * scale) / 2;
      const oy = (stage.clientHeight - WORLD_H * scale) / 2;
      world.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(WORLD_W * scale * dpr);
      canvas.height = Math.round(WORLD_H * scale * dpr);
      ctx.setTransform(canvas.width / WORLD_W, 0, 0, canvas.height / WORLD_H, 0, 0);
    };
    resize();

    const held = new Set<string>();
    // Losowe miejsce z marginesem od krawędzi. Na malutkim ekranie margines
    // maleje (max ¼ wolnego miejsca), a gdy miejsca brak — postać ląduje na środku.
    const freeW = WORLD_W - PERSON_W;
    const freeH = WORLD_H - PERSON_H - TAG_H;
    const mx = Math.min(SPAWN_MARGIN, freeW / 4);
    const my = Math.min(SPAWN_MARGIN, freeH / 4);
    let x = mx + Math.random() * (freeW - 2 * mx);
    let y = TAG_H + my + Math.random() * (freeH - 2 * my);
    // Spawn znany od razu, żeby pierwsze wysłanie / Presence nie niosło pozycji ze środka.
    myPos.current = { ...clampPos(x, y), d: DIR_DOWN };
    let last = performance.now();
    let lastSent = 0;
    let dirty = false;
    let raf = 0;
    let dir: Dir = DIR_DOWN;
    let walkingNow = false;
    /** Początek ładowania własnej kuli (performance.now) albo null. */
    let chargeStart: number | null = null;

    const emit = (event: string, payload: object = {}) => {
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
      launch(ballsRef.current, x, y, dir, p, colorRef.current, keyRef.current || "me");
      emit("fire", { ...myPos.current, p });
    };
    const cancelCharge = () => {
      if (chargeStart === null) return;
      chargeStart = null;
      emit("charge", { on: false });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, WORLD_W, WORLD_H);
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
      for (const b of ballsRef.current) drawOrb(ctx, b.x, b.y, b.r, b.color, 0.6);
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
      const dx = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
      const dy = (held.has("ArrowDown") ? 1 : 0) - (held.has("ArrowUp") ? 1 : 0);
      const moving = Boolean(dx || dy);
      if (moving !== walkingNow) {
        walkingNow = moving;
        setMyWalking(moving);
      }
      if (dx || dy) {
        const nd = DIR_OF[dy + 1][dx + 1];
        if (nd !== dir) {
          dir = nd;
          setMyDir(nd);
          dirty = true;
        }
      }
      const norm = dx && dy ? Math.SQRT1_2 : 1;
      const maxX = WORLD_W - PERSON_W;
      const maxY = WORLD_H - PERSON_H;
      const nx = Math.max(0, Math.min(maxX, x + dx * SPEED * dt * norm));
      const ny = Math.max(TAG_H, Math.min(maxY, y + dy * SPEED * dt * norm));
      if (nx !== x || ny !== y) dirty = true;
      x = nx;
      y = ny;
      // Własna postać drży po trafieniu.
      const hitAge = t - (hitRef.current.me ?? -Infinity);
      const shake = hitAge < HIT_MS ? Math.sin(hitAge / 18) * 5 * (1 - hitAge / HIT_MS) : 0;
      person.style.transform = `translate(${x + shake}px, ${y}px)`;
      myPos.current = { x, y, d: dir };
      // Ostatnią pozycję po zatrzymaniu też wysyłamy (dirty zostaje do skutecznego wysłania).
      if (dirty && t - lastSent >= SEND_EVERY) {
        send();
        lastSent = t;
        dirty = false;
      }
      // Kule w locie (własne i cudze) znikają po opuszczeniu sceny.
      ballsRef.current = ballsRef.current.filter((b) => {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
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
        return b.x > -b.r && b.x < WORLD_W + b.r && b.y > -b.r && b.y < WORLD_H + b.r;
      });
      draw(t);
      raf = requestAnimationFrame(tick);
    };

    // Pisanie na czacie nie może ruszać postacią.
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "Space") {
        e.preventDefault(); // spacja nie przewija strony ani nie klika fokusowanego przycisku
        if (!e.repeat && chargeStart === null) {
          chargeStart = performance.now();
          emit("charge", { on: true });
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
      held.delete(e.key);
    };
    const onBlur = () => {
      held.clear();
      cancelCharge();
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
    };
  }, [roomSlug]);

  // Kanał pokoju: Presence mówi, kto jest i jak wygląda, Broadcast niesie pozycje i kule.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !ready) return;
    const key = crypto.randomUUID();
    keyRef.current = key;
    const channel = sb.channel(`world2:${roomSlug}`, {
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
        const { k, x, y, d } = payload as {
          k: string;
          x: number;
          y: number;
          d: unknown;
        };
        if (k === key || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const prev = posRef.current[k];
        posRef.current[k] = { ...clampPos(x, y), d: asDir(d) };
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
        const px = clampPos(x, y);
        const c = othersRef.current[k]?.color ?? "#ffffff";
        launch(ballsRef.current, px.x, px.y, asDir(d), clamp01(p), c, k);
      })
      .on("presence", { event: "sync" }, () => {
        const next: Others = {};
        // Jedno konto = jedna postać: kolejne karty tego samego użytkownika pomijamy
        // (zostaje najświeżej dołączona), a inne karty własnego konta w ogóle nie są „innymi”.
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
            posRef.current[k] = { ...clampPos(latest.x!, latest.y!), d: asDir(latest.d) };
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
  }, [roomSlug, ready]);

  // Pętla rysowania korzysta z aktualnej listy osób i własnego koloru bez przebudowy efektu.
  useEffect(() => {
    othersRef.current = others;
  }, [others]);

  // Zmiana koloru / nicku (np. po zalogowaniu) — odświeżamy wpis w Presence.
  useEffect(() => {
    colorRef.current = color;
    userIdRef.current = userId;
    metaRef.current = { at: Date.now(), color, nick, user: userId };
    const channel = channelRef.current;
    if (channel?.state === "joined") void channel.track({ ...metaRef.current, ...myPos.current });
  }, [color, nick, userId]);

  // Hint dla wszystkich (też bez konta): widoczny HINT_MS, potem HINT_FADE_MS zanikania.
  const [hint, setHint] = useState<"show" | "fade" | "done">("show");
  useEffect(() => {
    const fade = setTimeout(() => setHint("fade"), HINT_MS);
    const done = setTimeout(() => setHint("done"), HINT_MS + HINT_FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);

  // Warstwa na cały ekran, pod treścią strony: postacie są „za” tekstem i czatem, lekko przygaszone.
  return (
    <>
    {hint !== "done" && (
      <div
        role="status"
        className={`pointer-events-none fixed left-1/2 top-6 z-10 -translate-x-1/2 rounded-full transition-opacity duration-1000 ${hint === "fade" ? "opacity-0" : "opacity-100"} bg-zinc-900/80 px-4 py-2 text-sm text-zinc-100 shadow-lg dark:bg-zinc-100/90 dark:text-zinc-900`}
      >
        Use the arrow keys ← ↑ ↓ → to move around · hold Space to charge, release to shoot
      </div>
    )}
    <div ref={stageRef} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left outline outline-1 outline-zinc-400/30"
        style={{ width: WORLD_W, height: WORLD_H }}
      >
        {Object.entries(others).map(([k, o]) => (
          <div
            key={k}
            className="absolute left-0 top-0 opacity-70 transition-transform duration-100 ease-linear"
            style={{ transform: `translate(${o.x}px, ${o.y}px)` }}
          >
            <NameTag name={o.nick} />
            <PixelPerson color={o.color} label={o.nick ?? NO_NAME} size={PERSON_W / 8} dir={o.d} walking={walkers[k]} />
          </div>
        ))}
        <div ref={personRef} className="absolute left-0 top-0 opacity-70 will-change-transform">
          <NameTag name={nick} />
          <PixelPerson color={color} label={nick ?? NO_NAME} size={PERSON_W / 8} dir={myDir} walking={myWalking} />
        </div>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
    </>
  );
}
