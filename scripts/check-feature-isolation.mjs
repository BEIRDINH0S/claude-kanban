#!/usr/bin/env node
// @ts-check
/**
 * Feature isolation guard. Two levels of boundary:
 *
 * 1. **Top-level features** — every directory directly under `src/features/`
 *    is a feature. Features must NOT import each other. The bridge always
 *    lives in `app/AppShell.tsx` (or, inside a feature, in its orchestrator)
 *    via slots / callbacks on the public component.
 *
 * 2. **Sub-features** — a directory under `src/features/<F>/<S>/` that has
 *    its own `index.ts` is a sub-feature. Sub-features within the same
 *    parent feature must NOT import each other either; the parent feature's
 *    orchestrator (e.g. `ZoomView` for `features/session/`) is the bridge.
 *    Sub-features CAN import root-level files of their parent feature
 *    (the feature's shared lib — e.g. `features/session/format.ts`).
 *
 * Layer rules across the whole codebase:
 *
 *   features/A   → may import   features/A/**, lib/, types/, ipc/, stores/
 *   features/A/X → may import   features/A/X/**, features/A/<root files>,
 *                              lib/, types/, ipc/, stores/
 *   features/A/X → MUST NOT     import features/A/Y (sibling sub-feature)
 *   features/A   → MUST NOT     import features/B
 *   stores/      → MUST NOT     import features/
 *   lib/, types/ → MUST NOT     import features/ or stores/
 *   ipc/         → MUST NOT     import features/ or stores/
 *   app/         → may import   everything (orchestrator)
 *
 * If you're tempted to break a rule, the right move is almost always:
 *   - expose the inner thing as a slot or a callback on the public component
 *   - lift the wiring into `app/AppShell.tsx` (top-level) or the feature's
 *     own orchestrator (sub-feature level)
 *   - move shared pure code to `lib/` / `types/`, or to the feature root
 *     when it's session-internal but used by several sub-features
 *
 * Run:  npm run check:isolation
 * Wired into `npm run build` so a regression breaks CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const SRC = join(REPO, "src");

/** @param {string} dir */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** @param {string} src */
function* imports(src) {
  const re = /from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) yield m[1];
}

/**
 * Discover sub-features per top-level feature. A sub-feature is a direct
 * subdirectory of `features/<feature>/` that contains an `index.ts`. Anything
 * else (loose root files, directories without an index) is treated as part
 * of the feature's "shared root".
 *
 * Returns: Map<feature, Set<subFeature>>.
 */
function discoverSubFeatures() {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  const featuresDir = join(SRC, "features");
  if (!existsSync(featuresDir)) return out;
  for (const feat of readdirSync(featuresDir)) {
    const featPath = join(featuresDir, feat);
    if (!statSync(featPath).isDirectory()) continue;
    const subs = new Set();
    for (const sub of readdirSync(featPath)) {
      const subPath = join(featPath, sub);
      if (!statSync(subPath).isDirectory()) continue;
      const indexTs = join(subPath, "index.ts");
      const indexTsx = join(subPath, "index.tsx");
      if (existsSync(indexTs) || existsSync(indexTsx)) {
        subs.add(sub);
      }
    }
    out.set(feat, subs);
  }
  return out;
}

const SUB_FEATURES = discoverSubFeatures();

/** Resolve "../foo/bar" against the importer's directory and strip the
 *  leading repo prefix so paths look like "src/features/kanban/state.ts". */
function resolveImport(importerFile, spec) {
  if (!spec.startsWith(".")) return null; // package import — out of scope
  const dir = dirname(importerFile);
  const joined = join(dir, spec);
  return relative(REPO, joined);
}

/**
 * Classify a path inside `src/` into one of our layers. Sub-features are
 * detected here too — `subFeature` is null when the file is at the feature
 * root (i.e. one of its shared utilities).
 *
 * @returns {null | {layer: string, feature?: string, subFeature?: string|null}}
 */
function classify(path) {
  if (path.startsWith("src/features/")) {
    const parts = path.split("/");
    const feat = parts[2];
    const subCandidate = parts[3]; // may be a sub-feature dir or a file
    const featSubs = SUB_FEATURES.get(feat) ?? new Set();
    const subFeature =
      subCandidate && featSubs.has(subCandidate) ? subCandidate : null;
    return { layer: "feature", feature: feat, subFeature };
  }
  if (path.startsWith("src/stores/")) return { layer: "stores" };
  if (path.startsWith("src/lib/")) return { layer: "lib" };
  if (path.startsWith("src/types/")) return { layer: "types" };
  if (path.startsWith("src/ipc/")) return { layer: "ipc" };
  if (path.startsWith("src/app/")) return { layer: "app" };
  // App-level "everything" files (App.tsx, main.tsx, styles/) — treat as app.
  if (path.startsWith("src/")) return { layer: "app" };
  return null;
}

/**
 * Returns a violation reason string, or null when the import is allowed.
 * @param {{layer:string,feature?:string,subFeature?:string|null}} from
 * @param {{layer:string,feature?:string,subFeature?:string|null}} to
 */
function violation(from, to) {
  // 1. lib / types must stay pure (no feature, no store dependency).
  if (from.layer === "lib" || from.layer === "types") {
    if (to.layer === "feature" || to.layer === "stores") {
      return `${from.layer} must not depend on ${to.layer}`;
    }
  }
  // 2. ipc must stay pure (no feature, no store dependency).
  if (from.layer === "ipc") {
    if (to.layer === "feature" || to.layer === "stores") {
      return `ipc must not depend on ${to.layer}`;
    }
  }
  // 3. stores must not import features. Store-to-store is fine (infra).
  if (from.layer === "stores") {
    if (to.layer === "feature") {
      return `stores must not import features (cross-store coupling is fine; cross-feature is the rule we're protecting)`;
    }
  }
  // 4. features must not import another top-level feature.
  if (from.layer === "feature" && to.layer === "feature") {
    if (from.feature !== to.feature) {
      return `features/${from.feature} must not import features/${to.feature}. ` +
        `Lift the wiring into app/AppShell.tsx, or expose a slot / callback ` +
        `on the public component of features/${to.feature}.`;
    }
    // 5. Within the same feature, sub-features must not import each other.
    //    A file at the feature root (subFeature === null) can be imported
    //    by any sub-feature — that's the feature's shared lib.
    if (
      from.subFeature &&
      to.subFeature &&
      from.subFeature !== to.subFeature
    ) {
      return `features/${from.feature}/${from.subFeature} must not import ` +
        `features/${from.feature}/${to.subFeature}. Lift the wiring into the ` +
        `feature's orchestrator (e.g. ZoomView), or expose a slot on ` +
        `${to.subFeature}'s public component.`;
    }
  }
  return null;
}

/** Resolve a relative import to a normalised "src/..." path, regardless of
 *  whether the spec includes the `index` suffix or a trailing slash. */
function normaliseTarget(target) {
  return target.replace(/\\/g, "/");
}

const files = walk(SRC);
let bad = 0;
for (const f of files) {
  const rel = relative(REPO, f);
  const fromCls = classify(rel);
  if (!fromCls) continue;
  const src = readFileSync(f, "utf8");
  for (const spec of imports(src)) {
    const target = resolveImport(f, spec);
    if (!target) continue;
    const norm = normaliseTarget(target);
    const toCls = classify(norm);
    if (!toCls) continue;
    const why = violation(fromCls, toCls);
    if (why) {
      console.error(`✘ ${rel}  →  ${spec}\n    ${why}`);
      bad++;
    }
  }
}

if (bad > 0) {
  console.error(`\n${bad} feature-isolation violation(s) found.`);
  process.exit(1);
}
console.log("✓ feature-isolation OK (" + files.length + " files scanned)");
