"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RoomStage, type RoomZone } from "@/components/RoomStage";
import { EXIT_ZONE } from "@/lib/rooms";
import type { StopwatchSave } from "@/lib/useStopwatchSaves";
import { useStopwatchSaves } from "@/lib/useStopwatchSaves";

const ZONE_W = 200;
const ZONE_H = 150;
const ZONE_GAP = 60;
const ZONE_Y = 620;
const WORLD_W = 1600;

/** mm:ss dla czasu, który upływa (w odróżnieniu od formatMs liczącego w dół — tu bez zaokrąglania w górę). */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Pokój ze stoperem: każda osoba ma własny, prywatny licznik od zera, sterowany trzema
 * przyciskami na podłodze (Start/Pauza, Reset, Zapisz) — wchodzi się na nie i trzyma E przez 1 s.
 */
export function TimerRoom({ roomSlug }: { roomSlug: string }) {
  const [running, setRunning] = useState(false);
  // Suma ukończonych odcinków (ms) — nie licząc bieżącego, jeśli stoper działa.
  const [elapsedMs, setElapsedMs] = useState(0);
  // Kiedy zaczął się bieżący odcinek (Date.now()), albo null, gdy stoper stoi.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Zegar do wyliczania currentMs — NIE wolno czytać Date.now() w renderze (reguła
  // react-hooks/purity), więc trzymamy go w stanie i odświeżamy: (a) od razu przy każdej
  // zmianie startedAt/running (inaczej pierwszy render po Starcie liczyłby od starego,
  // sprzed-startu zegara — to właśnie powodowało "doskok" sekund po Pauzie), (b) co 250ms,
  // póki stoper działa.
  const [now, setNow] = useState(() => Date.now());
  const { saves, save, setNote, persistent } = useStopwatchSaves(roomSlug);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const currentMs = running && startedAt !== null ? elapsedMs + (now - startedAt) : elapsedMs;

  // Wszystkie akcje przyjmują `at` — chwilę NACIŚNIĘCIA E (RoomStage.onZoneAction), a nie
  // potwierdzenia po roomEnterMs() później. Inaczej np. pauza doliczałaby do wyniku cały czas
  // spędzony na trzymaniu przycisku (1s+), co wygląda jak nagły skok czasu po zatrzymaniu.
  const start = useCallback((at: number) => {
    setRunning(true);
    setStartedAt(at);
    setNow(Date.now());
  }, []);

  const pause = useCallback((at: number) => {
    setStartedAt((started) => {
      if (started === null) return started;
      // `at` bywa odrobinę wcześniejszy niż `started` (nacisk E tuż po Starcie) — nie cofamy czasu.
      setElapsedMs((ms) => ms + Math.max(0, at - started));
      return null;
    });
    setRunning(false);
  }, []);

  const toggle = useCallback((at: number) => (running ? pause(at) : start(at)), [running, start, pause]);

  const reset = useCallback((at: number) => {
    setElapsedMs(0);
    setStartedAt((started) => (started === null ? null : at));
    setNow(Date.now());
  }, []);

  const doSave = useCallback(
    (at: number) => {
      void save(running && startedAt !== null ? elapsedMs + Math.max(0, at - startedAt) : elapsedMs);
    },
    [save, running, startedAt, elapsedMs],
  );

  const zones = useMemo<RoomZone[]>(() => {
    const total = 3 * ZONE_W + 2 * ZONE_GAP;
    const startX = (WORLD_W - total) / 2;
    return [
      EXIT_ZONE,
      { slug: "toggle", name: running ? "Pause" : "Start", kind: "action", x: startX, y: ZONE_Y, w: ZONE_W, h: ZONE_H },
      {
        slug: "reset",
        name: "Reset",
        kind: "action",
        x: startX + ZONE_W + ZONE_GAP,
        y: ZONE_Y,
        w: ZONE_W,
        h: ZONE_H,
      },
      {
        slug: "save",
        name: "Save",
        kind: "action",
        x: startX + 2 * (ZONE_W + ZONE_GAP),
        y: ZONE_Y,
        w: ZONE_W,
        h: ZONE_H,
      },
    ];
  }, [running]);

  const onZoneAction = useCallback(
    (slug: string, at: number) => {
      if (slug === "toggle") toggle(at);
      else if (slug === "reset") reset(at);
      else if (slug === "save") doSave(at);
    },
    [toggle, reset, doSave],
  );

  return (
    <>
      <RoomStage
        roomSlug={roomSlug}
        zones={zones}
        spawnZoneSlug={EXIT_ZONE.slug}
        onZoneAction={onZoneAction}
        xpRunning={running}
      />
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <span className="font-mono text-6xl tabular-nums sm:text-7xl">{formatElapsed(currentMs)}</span>
        <p className="text-sm text-zinc-500">
          Walk onto a floor button and hold E for a second: Start/Pause, Reset, Save.
        </p>
        <SavedList saves={saves} persistent={persistent} setNote={setNote} />
      </div>
    </>
  );
}

function SavedList({
  saves,
  persistent,
  setNote,
}: {
  saves: StopwatchSave[];
  persistent: boolean;
  setNote: (id: string, note: string) => Promise<void>;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // "E to add note" na najechanym wierszu — otwiera inline edycję, chyba że już coś się edytuje
  // (np. trwa pisanie gdzie indziej — wtedy isTypingTarget w RoomStage i tak by to zablokował,
  // ale tu pilnujemy jednego edytowanego wiersza naraz).
  useEffect(() => {
    if (editingId !== null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "KeyE" || hoveredId === null) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))
        return;
      const current = saves.find((s) => s.id === hoveredId);
      if (!current) return;
      setEditingId(hoveredId);
      setDraft(current.note ?? "");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingId, hoveredId, saves]);

  function commit(id: string) {
    setEditingId(null);
    void setNote(id, draft);
  }

  return (
    <section className="flex w-full max-w-2xl flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-400">
        Your saved times{!persistent && " (this tab only — sign in to keep them)"}
      </h2>
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-zinc-800 p-4">
        {saves.length === 0 ? (
          <p className="m-auto text-sm text-zinc-600">No saved times yet.</p>
        ) : (
          saves.map((s) => (
            <div
              key={s.id}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId((h) => (h === s.id ? null : h))}
              className="flex flex-col gap-1 rounded-lg px-1 py-0.5 text-sm hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono tabular-nums text-zinc-200">{formatElapsed(s.elapsed_ms)}</span>
                {editingId !== s.id && hoveredId === s.id && (
                  <span className="text-xs text-zinc-500">E to {s.note ? "edit" : "add"} note</span>
                )}
                <span className="text-zinc-600 tabular-nums">
                  {new Date(s.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commit(s.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                  onBlur={() => commit(s.id)}
                  placeholder="Note…"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              ) : (
                s.note && <span className="text-xs text-zinc-500">{s.note}</span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
