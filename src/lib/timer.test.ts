import { test } from "node:test";
import assert from "node:assert/strict";
import { EPOCH_MS, getTimerState } from "./timer.ts";

const MIN = 60_000;
const at = (min: number) => EPOCH_MS + min * MIN;
const r2005 = { workMin: 20, breakMin: 5 };
const r5515 = { workMin: 55, breakMin: 15 };

test("start punktu odniesienia = początek pracy", () => {
  const s = getTimerState(at(0), r2005);
  assert.equal(s.phase, "work");
  assert.equal(s.remainingMs, 20 * MIN);
});

test("20+5: przerwa po 20 min, następny cykl po 25 min", () => {
  assert.equal(getTimerState(at(20), r2005).phase, "break");
  assert.equal(getTimerState(at(20), r2005).remainingMs, 5 * MIN);
  const s = getTimerState(at(25), r2005);
  assert.equal(s.phase, "work");
  assert.equal(s.cycle, 2);
});

test("55+15: cykle po 70 min bez resetów o pełnej godzinie", () => {
  assert.equal(getTimerState(at(55), r5515).phase, "break");
  assert.equal(getTimerState(at(70), r5515).phase, "work");
  assert.equal(getTimerState(at(70), r5515).cycle, 2);
  assert.equal(getTimerState(at(140), r5515).phase, "work");
  assert.equal(getTimerState(at(140), r5515).remainingMs, 55 * MIN);
});

test("cykl 55+15 jest ciągły przez północ UTC (brak ucięcia)", () => {
  const midnight = 24 * 60 * 30; // 30 dób od EPOCH_MS
  const a = getTimerState(at(midnight - 1), r5515);
  const b = getTimerState(at(midnight), r5515);
  const cycleMin = 70;
  const posA = (midnight - 1) % cycleMin;
  assert.equal(b.phase, midnight % cycleMin < 55 ? "work" : "break");
  assert.equal(a.phase, posA < 55 ? "work" : "break");
});
