#!/usr/bin/env node
// Builds the patch notes the apps bundle (#99) from docs/patchNotes/<app>/<platform>/<version>.json.
//
//   node scripts/patchNotes.cjs                      validate and write the generated files
//   node scripts/patchNotes.cjs --check              fail if a generated file is out of date
//   node scripts/patchNotes.cjs --require desktop:win
//                                                    also fail if the app's current version has no notes
//                                                    (release builds)
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "docs", "patchNotes");
const APPS = {
  desktop: { platforms: ["win", "mac"], out: "apps/desktop/src/generated/patchNotes.json", pkg: "apps/desktop/package.json" },
  mobile: { platforms: ["android", "ios"], out: "apps/mobile/src/generated/patchNotes.json", pkg: "apps/mobile/package.json" },
};
// The apps show at most this many official versions; older files stay in docs only.
// Beta notes are kept only for the newest official line and later (the beta's x.y.z at
// least the newest official x.y.z, whose notes may still be a draft): an official
// release's notes include its betas, and official builds never show beta notes.
const MAX_VERSIONS = 12;
const KINDS = ["new", "improved", "fixed"];
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function fail(message) {
  throw Error(message);
}

function compareVersions(a, b) {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i];
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  return x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0;
}

const isBeta = (version) => version.includes("-");

const text = (value, where) => {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\r\n]/.test(value))
    fail(`${where}: expected one line of text`);
  return value;
};

// Strict shape so a typo fails the build instead of showing a broken window.
function validate(raw, file) {
  const version = path.basename(file, ".json");
  if (!VERSION.test(version)) fail(`${file}: file name must be the version (x.y.z)`);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${file}: expected an object`);
  const allowed = new Set(["version", "date", "summary", "sections"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) fail(`${file}: unknown field ${key}`);
  if (raw.version !== version) fail(`${file}: version must match the file name`);
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) fail(`${file}: date must be YYYY-MM-DD`);
  text(raw.summary, `${file} summary`);
  if (!Array.isArray(raw.sections) || !raw.sections.length) fail(`${file}: sections must not be empty`);
  const seen = new Set();
  const sections = raw.sections.map((section, i) => {
    const where = `${file} sections[${i}]`;
    if (!section || typeof section !== "object") fail(`${where}: expected an object`);
    for (const key of Object.keys(section)) if (key !== "kind" && key !== "items") fail(`${where}: unknown field ${key}`);
    if (!KINDS.includes(section.kind)) fail(`${where}: kind must be one of ${KINDS.join(", ")}`);
    if (seen.has(section.kind)) fail(`${where}: ${section.kind} appears twice`);
    seen.add(section.kind);
    if (!Array.isArray(section.items) || !section.items.length) fail(`${where}: items must not be empty`);
    const items = section.items.map((item, j) => {
      const at = `${where}.items[${j}]`;
      if (!item || typeof item !== "object") fail(`${at}: expected an object`);
      for (const key of Object.keys(item)) if (key !== "title" && key !== "detail") fail(`${at}: unknown field ${key}`);
      const out = { title: text(item.title, `${at}.title`) };
      if (item.detail !== undefined) {
        if (!Array.isArray(item.detail) || !item.detail.length) fail(`${at}.detail: expected a list of lines`);
        out.detail = item.detail.map((line, k) => text(line, `${at}.detail[${k}]`));
      }
      return out;
    });
    return { kind: section.kind, items };
  });
  // Fixed display order: new features, improvements, fixes.
  sections.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  return { version, date: raw.date, summary: raw.summary, sections };
}

function readPlatform(app, platform) {
  return readDir(path.join(SOURCE, app, platform));
}

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const notes = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        fail(`${path.relative(ROOT, file)}: ${error.message}`);
      }
      return validate(raw, path.relative(ROOT, file).replace(/\\/g, "/"));
    });
  notes.sort((a, b) => compareVersions(b.version, a.version));
  const official = notes.filter((note) => !isBeta(note.version)).slice(0, MAX_VERSIONS);
  const betas = notes
    .filter((note) => isBeta(note.version) && (!official.length || compareVersions(note.version.split("-")[0], official[0].version) >= 0))
    .slice(0, MAX_VERSIONS);
  return [...betas, ...official].sort((a, b) => compareVersions(b.version, a.version));
}

function build() {
  const outputs = {};
  for (const [app, config] of Object.entries(APPS)) {
    const value = {};
    for (const platform of config.platforms) value[platform] = readPlatform(app, platform);
    outputs[config.out] = JSON.stringify(value, null, 2) + "\n";
  }
  return outputs;
}

function main(argv) {
  const check = argv.includes("--check");
  const required = argv.flatMap((arg, i) => (arg === "--require" ? [argv[i + 1]] : []));
  const outputs = build();
  for (const target of required) {
    const [app, platform] = String(target).split(":");
    const config = APPS[app];
    if (!config || !config.platforms.includes(platform)) fail(`unknown target ${target}`);
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, config.pkg), "utf8"));
    const notes = JSON.parse(outputs[config.out])[platform];
    if (!notes.some((note) => note.version === version))
      fail(`missing patch notes: docs/patchNotes/${app}/${platform}/${version}.json (write them before a release build)`);
  }
  const stale = [];
  for (const [out, content] of Object.entries(outputs)) {
    const file = path.join(ROOT, out);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === content) continue;
    if (check) stale.push(out);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  if (stale.length) fail(`patch notes out of date (run node scripts/patchNotes.cjs): ${stale.join(", ")}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
module.exports = { validate, compareVersions, build, main, readDir, MAX_VERSIONS };
