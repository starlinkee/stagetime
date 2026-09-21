import { test } from "node:test";
import assert from "node:assert/strict";
import { getTimerState } from "./timer.ts";

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 0, 1, h, m, s);
const r2005 = { workMin: 20, breakMin: 5 };
const r5515 = { workMin: 55, breakMin: 15 };

test("pełna godzina = start pracy", () => {
  const s = getTimerState(at(12, 0), r2005);
  assert.equal(s.phase, "work");
  assert.equal(s.remainingMs, 20 * 60_000);
});

test("po 20 min zaczyna się przerwa", () => {
  const s = getTimerState(at(12, 20), r2005);
  assert.equal(s.phase, "break");
  assert.equal(s.remainingMs, 5 * 60_000);
});

test("drugi cykl startuje po 25 min", () => {
  const s = getTimerState(at(12, 25), r2005);
  assert.equal(s.phase, "work");
  assert.equal(s.cycle, 2);
});

test("reszta godziny to przerwa do pełnej godziny", () => {
  const s = getTimerState(at(12, 55), r2005);
  assert.equal(s.phase, "break");
  assert.equal(s.remainingMs, 5 * 60_000);
});

test("pokój 55+15 biegnie od północy UTC", () => {
  assert.equal(getTimerState(at(0, 0), r5515).phase, "work");
  assert.equal(getTimerState(at(0, 55), r5515).phase, "break");
  const s = getTimerState(at(1, 10), r5515);
  assert.equal(s.phase, "work");
  assert.equal(s.cycle, 2);
});
