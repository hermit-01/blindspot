/*
 * Coverage rules, checked end to end against a running server.
 *
 *   npm run dev          # in another terminal
 *   node scripts/check-coverage-rules.mjs
 *
 * These exist because "covered" is the one claim the whole product rests on.
 * A place that asked for help must never be counted as a place that got it.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const DELIVERY = "Vellarimala - 200 food kits delivered this morning";
const DUPLICATE = "vellarimalla village, foodkits 200 given";
const NEED = "Thariode cut off, need water and tarpaulin";

async function reset() {
  const res = await fetch(`${BASE}/api/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true }),
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

async function report(raw) {
  const res = await fetch(`${BASE}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, agency: "District EOC" }),
  });
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
  return res.json();
}

async function state() {
  const res = await fetch(`${BASE}/api/state`);
  if (!res.ok) throw new Error(`state failed: ${res.status}`);
  return res.json();
}

const cell = (snap, name) => snap.ranked.find((c) => c.name === name);

let failures = 0;

async function check(name, fn) {
  await reset();
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

console.log("\ncoverage rules\n");

await check("a delivery report marks the cell covered", async () => {
  await report(DELIVERY);
  const c = cell(await state(), "Vellarimala");
  assertEqual(c.state, "served", "Vellarimala state");
});

await check("a report of unmet need does NOT mark the cell covered", async () => {
  await report(NEED);
  const c = cell(await state(), "Thariode");
  assertEqual(c.state, "reported", "Thariode state");
});

await check("reporting a need does not push the cell down the queue", async () => {
  const before = cell(await state(), "Thariode").score;
  await report(NEED);
  const after = cell(await state(), "Thariode").score;
  if (after < before - 1) {
    throw new Error(
      `asking for help lowered the unmet-need score: ${before} -> ${after}`,
    );
  }
});

await check("the same delivery reported twice is counted once", async () => {
  await report(DELIVERY);
  const afterFirst = (await state()).counts.unknown;
  await report(DUPLICATE);
  const afterDuplicate = (await state()).counts.unknown;
  assertEqual(afterDuplicate, afterFirst, "unknown count after duplicate");
  assertEqual(cell(await state(), "Vellarimala").reportCount, 1, "report count");
});

await reset();

console.log(
  failures === 0
    ? "\nall checks passed\n"
    : `\n${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
