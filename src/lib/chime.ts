"use client";
import { isSoundEnabled } from "@/lib/soundSettings";

/**
 * Session-end chime, attack "whoosh" and hit "thud" (STU-3/STU-24) — all synthesized with the Web
 * Audio API instead of audio files, since no sound assets exist in this repo yet. A single
 * lazily-created AudioContext is reused across calls; browsers start it "suspended" until a user
 * gesture, which by the time any of these fire (mid-session, mid-fight) has long since happened.
 * Every exported play* function checks isSoundEnabled() itself, so call sites don't need to.
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
  if (!isSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  tone(c, 880, now, 0.3); // A5
  tone(c, 1174.66, now + 0.15, 0.35); // D6
}

/** Quick descending sweep for a ball throw/melee swing — short enough not to overlap the next one
 * during rapid-fire, distinct enough from the low "thud" below to tell attack and hit apart. */
function sweep(c: AudioContext, fromFreq: number, toFreq: number, at: number, duration: number, gainPeak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(fromFreq, at);
  osc.frequency.exponentialRampToValueAtTime(toFreq, at + duration);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(gainPeak, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** Thrown ball / melee swing — this connection's own attack only (see the "fire" handler in
 * RoomStage.tsx), not a broadcast event, so it never plays once per attack for every player in
 * the room. */
export function playAttackSound() {
  if (!isSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  sweep(c, 700, 220, c.currentTime, 0.12, 0.15);
}

/** Landing or taking a hit (see the `hits` loop in RoomStage.tsx's "state" handler) — a short low
 * thud, deliberately duller than playAttackSound so the two don't get confused mid-fight. */
export function playHitSound() {
  if (!isSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.09);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}
