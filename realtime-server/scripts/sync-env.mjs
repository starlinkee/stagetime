// Keeps realtime-server/.env in sync with the Next.js app's root .env.local, so you only ever
// edit a shared value in one place. Runs automatically before `npm run dev` (see package.json's
// "predev"). No values are hardcoded here: if realtime-server/.env doesn't exist yet, it's seeded
// verbatim from realtime-server/.env.example (that file's own values are the only defaults, e.g.
// PERSISTENCE_API_URL). Then, for every key that ends up in .env, if the root .env.local also
// defines that same key, the root's value wins and overwrites the local one — so a value only
// stays as its .env.example default when the root doesn't define that key at all.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.join(here, "..", "..", ".env.local");
const localEnvPath = path.join(here, "..", ".env");
const exampleEnvPath = path.join(here, "..", ".env.example");

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function serializeEnv(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
}

if (!existsSync(localEnvPath) && existsSync(exampleEnvPath)) {
  copyFileSync(exampleEnvPath, localEnvPath);
  console.log(`sync-env: seeded ${localEnvPath} from ${exampleEnvPath}`);
}

if (!existsSync(rootEnvPath)) {
  console.warn(`sync-env: ${rootEnvPath} not found, skipping overlay — run \`copy .env.example .env\` at the repo root first`);
  process.exit(0);
}

const rootVars = parseEnv(readFileSync(rootEnvPath, "utf8"));
const localVars = existsSync(localEnvPath) ? parseEnv(readFileSync(localEnvPath, "utf8")) : {};

let changed = false;
for (const key of Object.keys(localVars)) {
  const rootValue = rootVars[key];
  if (rootValue && rootValue !== localVars[key]) {
    localVars[key] = rootValue;
    changed = true;
  }
}

if (changed) {
  writeFileSync(localEnvPath, serializeEnv(localVars));
  console.log(`sync-env: updated ${localEnvPath} from ${rootEnvPath}`);
} else {
  console.log("sync-env: already up to date");
}
