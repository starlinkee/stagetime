"use client";
import { useState } from "react";
import { RoomStage, type RoomZone } from "@/components/RoomStage";
import { RoomTimer } from "@/components/RoomTimer";
import type { PomodoroRoomConfig } from "@/lib/timer";
import type { PomodoroSessionState } from "@realtime-shared/types";

/**
 * STU-58: RoomTimer (the big Work/Break HUD) and RoomStage (the scene + WS connection) are
 * siblings, but the session state RoomTimer needs to render now only exists on RoomStage's own WS
 * connection — this just lifts it up via RoomStage's `onPomodoroState` callback instead of RoomTimer
 * opening a second connection of its own.
 */
export function PomodoroRoom({
  room,
  zones,
  spawnZoneSlug,
}: {
  room: PomodoroRoomConfig;
  zones: RoomZone[];
  spawnZoneSlug: string;
}) {
  const [session, setSession] = useState<PomodoroSessionState | null>(null);
  return (
    <>
      <RoomTimer room={room} session={session} />
      <RoomStage
        roomSlug={room.slug}
        zones={zones}
        spawnZoneSlug={spawnZoneSlug}
        phase={{ workMin: room.workMin, breakMin: room.breakMin }}
        onPomodoroState={setSession}
      />
    </>
  );
}
