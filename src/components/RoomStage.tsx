"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { PixelPerson } from "@/components/PixelPerson";
import { getSupabase } from "@/lib/supabase";
import { safeColor, useMyProfile } from "@/lib/useProfile";
import { useSession } from "@/lib/useSession";

/** Prędkość w px na sekundę. */
const SPEED = 220;
const PERSON_W = 32;
const PERSON_H = 48;
/** Miejsce nad postacią na podpis — postać nie wchodzi wyżej, żeby podpis się nie ucinał. */
const TAG_H = 18;
const NO_NAME = "[no-name]";
/** Najczęściej co ile ms wysyłamy własną pozycję. */
const SEND_EVERY = 60;

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** Wygląd osoby, rozgłaszany przez Presence. */
type Meta = { at: number; color: string; nick: string | null };
/** Pozycja jako ułamek sceny (0–1), żeby różne rozmiary okien pokazywały to samo miejsce. */
type Pos = { x: number; y: number };
type Others = Record<string, Meta & Pos>;

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
 */
export function RoomStage({ roomSlug }: { roomSlug: string }) {
  const { ready, session } = useSession();
  const profile = useMyProfile();
  const color = session ? profile.color : "#ffffff";
  const nick = session ? profile.nickname : null;

  const stageRef = useRef<HTMLDivElement>(null);
  const personRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [others, setOthers] = useState<Others>({});
  // Klucz tej karty w kanale; pozycje innych trzymamy osobno od Presence.
  const keyRef = useRef("");
  const posRef = useRef<Record<string, Pos>>({});
  const metaRef = useRef<Meta>({ at: 0, color, nick });
  const myPos = useRef<Pos>({ x: 0.5, y: 0.5 });

  // Ruch własnej postaci i wysyłanie pozycji.
  useEffect(() => {
    const stage = stageRef.current;
    const person = personRef.current;
    if (!stage || !person) return;

    const held = new Set<string>();
    let x = (stage.clientWidth - PERSON_W) / 2;
    let y = (stage.clientHeight - PERSON_H + TAG_H) / 2;
    let last = performance.now();
    let lastSent = 0;
    let dirty = false;
    let raf = 0;

    const send = () => {
      channelRef.current?.send({
        type: "broadcast",
        event: "pos",
        payload: { k: keyRef.current, ...myPos.current },
      });
    };

    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const dx = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
      const dy = (held.has("ArrowDown") ? 1 : 0) - (held.has("ArrowUp") ? 1 : 0);
      const norm = dx && dy ? Math.SQRT1_2 : 1;
      const maxX = Math.max(1, stage.clientWidth - PERSON_W);
      const maxY = Math.max(1, stage.clientHeight - PERSON_H);
      const nx = Math.max(0, Math.min(maxX, x + dx * SPEED * dt * norm));
      const ny = Math.max(TAG_H, Math.min(maxY, y + dy * SPEED * dt * norm));
      if (nx !== x || ny !== y) dirty = true;
      x = nx;
      y = ny;
      person.style.transform = `translate(${x}px, ${y}px)`;
      myPos.current = { x: x / maxX, y: (y - TAG_H) / Math.max(1, maxY - TAG_H) };
      // Ostatnią pozycję po zatrzymaniu też wysyłamy (dirty zostaje do skutecznego wysłania).
      if (dirty && t - lastSent >= SEND_EVERY) {
        send();
        lastSent = t;
        dirty = false;
      }
      raf = requestAnimationFrame(tick);
    };

    // Pisanie na czacie nie może ruszać postacią.
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

    const onKeyDown = (e: KeyboardEvent) => {
      if (!ARROWS.has(e.key) || typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault(); // strzałki nie przewijają strony
      held.add(e.key);
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key);
    const onBlur = () => held.clear();

    raf = requestAnimationFrame(tick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Kanał pokoju: Presence mówi, kto jest i jak wygląda, Broadcast niesie pozycje.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !ready) return;
    const key = crypto.randomUUID();
    keyRef.current = key;
    const channel = sb.channel(`world:${roomSlug}`, { config: { presence: { key } } });
    channelRef.current = channel;

    const sendPos = () =>
      channel.send({ type: "broadcast", event: "pos", payload: { k: key, ...myPos.current } });

    channel
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const { k, x, y } = payload as { k: string; x: number; y: number };
        if (k === key || !Number.isFinite(x) || !Number.isFinite(y)) return;
        posRef.current[k] = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
        setOthers((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], ...posRef.current[k] } } : prev));
      })
      .on("presence", { event: "sync" }, () => {
        const next: Others = {};
        for (const [k, metas] of Object.entries(channel.presenceState<Meta>())) {
          if (k === key) continue;
          const latest = metas.reduce<Meta | null>((b, m) => (b && b.at >= m.at ? b : m), null);
          if (!latest) continue;
          next[k] = {
            ...latest,
            color: safeColor(latest.color),
            ...(posRef.current[k] ?? { x: 0.5, y: 0.5 }),
          };
        }
        for (const k of Object.keys(posRef.current)) if (!next[k]) delete posRef.current[k];
        setOthers(next);
      })
      // Nowa osoba nie zna naszej pozycji, dopóki się nie ruszymy — podajemy ją od razu.
      .on("presence", { event: "join" }, ({ key: joined }) => {
        if (joined !== key) sendPos();
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        await channel.track({ ...metaRef.current, at: Date.now() });
        sendPos();
      });

    return () => {
      channelRef.current = null;
      posRef.current = {};
      setOthers({});
      sb.removeChannel(channel);
    };
  }, [roomSlug, ready]);

  // Zmiana koloru / nicku (np. po zalogowaniu) — odświeżamy wpis w Presence.
  useEffect(() => {
    metaRef.current = { at: Date.now(), color, nick };
    const channel = channelRef.current;
    if (channel?.state === "joined") void channel.track(metaRef.current);
  }, [color, nick]);

  // Pozycje innych liczymy z rozmiaru okna; przejście CSS wygładza rzadkie aktualizacje.
  const w = typeof window === "undefined" ? 0 : window.innerWidth - PERSON_W;
  const h = typeof window === "undefined" ? 0 : window.innerHeight - PERSON_H - TAG_H;

  // Warstwa na cały ekran, pod treścią strony: postacie są „za” tekstem i czatem, lekko przygaszone.
  return (
    <div ref={stageRef} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {Object.entries(others).map(([k, o]) => (
        <div
          key={k}
          className="absolute left-0 top-0 opacity-70 transition-transform duration-100 ease-linear"
          style={{ transform: `translate(${o.x * w}px, ${TAG_H + o.y * h}px)` }}
        >
          <NameTag name={o.nick} />
          <PixelPerson color={o.color} label={o.nick ?? NO_NAME} size={PERSON_W / 8} />
        </div>
      ))}
      <div ref={personRef} className="absolute left-0 top-0 opacity-70 will-change-transform">
        <NameTag name={nick} />
        <PixelPerson color={color} label={nick ?? NO_NAME} size={PERSON_W / 8} />
      </div>
    </div>
  );
}
