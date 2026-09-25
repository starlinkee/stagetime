import { test } from "node:test";
import assert from "node:assert/strict";
import { getSessionTimerState } from "./timer.ts";

const MIN = 60_000;
const START = 1_000_000; // arbitrary epoch ms, standing in for a real `startedAt`
const r2005 = { workMin: 20, breakMin: 5 };
const r5515 = { workMin: 55, breakMin: 15 };

test("waiting: full work length, nothing counting down yet", () => {
  const s = getSessionTimerState(START, { state: "waiting", startedAt: null }, r2005);
  assert.equal(s.phase, "waiting");
  assert.equal(s.remainingMs, 20 * MIN);
  assert.equal(s.phaseMs, 20 * MIN);
});

test("work: counts down from the moment it started", () => {
  const session = { state: "work" as const, startedAt: START };
  assert.equal(getSessionTimerState(START, session, r2005).remainingMs, 20 * MIN);
  const s = getSessionTimerState(START + 5 * MIN, session, r2005);
  assert.equal(s.phase, "work");
  assert.equal(s.remainingMs, 15 * MIN);
});

test("break: remaining spans the rest of work + break, relative to the same startedAt", () => {
  const session = { state: "break" as const, startedAt: START };
  const s = getSessionTimerState(START + 20 * MIN, session, r2005);
  assert.equal(s.phase, "break");
  assert.equal(s.remainingMs, 5 * MIN);
  assert.equal(getSessionTimerState(START + 25 * MIN, session, r2005).remainingMs, 0);
});

test("55+15: same instance-relative math for a longer cycle", () => {
  const session = { state: "break" as const, startedAt: START };
  assert.equal(getSessionTimerState(START + 55 * MIN, session, r5515).phase, "break");
  assert.equal(getSessionTimerState(START + 55 * MIN, session, r5515).remainingMs, 15 * MIN);
  assert.equal(getSessionTimerState(START + 70 * MIN, session, r5515).remainingMs, 0);
});
