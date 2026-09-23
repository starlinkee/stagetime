"use client";

/**
 * Two-note chime played when a pomodoro work session ends (STU-24) — synthesized with the Web
 * Audio API instead of an audio file, since no sound asset exists in this repo yet. A single
 * lazily-created AudioContext is reused across calls; browsers start it "suspended" until a user
 * gesture, which by the time this fires (deep into a study session) has long since happened.
 */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(c: AudioContext, freq: number, at: number, duration: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

export function playSessionEndChime() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  tone(c, 880, now, 0.3); // A5
  tone(c, 1174.66, now + 0.15, 0.35); // D6
}
