// Flattens the pipeline's output into the single JSON file the dashboard loads.
//
//   npm run snapshot          reads the default database
//   A4A_DB=<path> npm run snapshot   reads another one
//
// Reads the message database, the agentic run folders (summary.json plus the
// accepted/rejected JSONL), the BCT catalogue and the weather CSV. Writes only
// public/admin/data/snapshot.json; the database is opened read-only and no
// input is modified.
//
// Two database generations are supported and detected at open time. Nothing
// here is fabricated: the mock participants are built in the browser instead.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(__dirname, "..");
// Written under public/admin/ so the server rule that protects the dashboard
// route protects the data with it.
const OUT = path.join(UI, "public", "admin", "data", "snapshot.json");

// Every input is optional and overridable, so this runs both inside the full
// pipeline repo and on its own with just a database:
//
//   A4A_DB        the database to read
//   A4A_AGENTIC   directory of agentic run folders
//   A4A_PROCESSED directory holding selected_bcts.csv and weather_daily.csv
//   A4A_ROOT      where to look for all of the above when not set individually
//
// Anything missing is skipped with a warning rather than failing the build.
const ROOT = process.env.A4A_ROOT || UI;
const DATA = path.join(ROOT, "msg_gen", "data");
const AGENTIC = process.env.A4A_AGENTIC || path.join(ROOT, "msg_gen", "agentic");
// selected_bcts.csv ships with the repo as reference data (ontology names, no
// participant content). A pipeline checkout can override with its own copy.
const REFERENCE = path.join(UI, "reference");
const PROCESSED = process.env.A4A_PROCESSED || path.join(DATA, "processed");

// Look in PROCESSED first, then fall back to the bundled reference copy.
function inputFile(name) {
  for (const dir of [PROCESSED, REFERENCE]) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Databases dropped beside the project are gitignored and are how exports
// arrive, so prefer the newest of those before the checked-in legacy file.
function defaultDb() {
  const candidates = [];
  for (const dir of [ROOT, UI]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".db")) candidates.push(path.join(dir, f));
    }
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || path.join(DATA, "messages_v4.db");
}

const DB_FILE = process.env.A4A_DB || defaultDb();

const round = (n, p = 3) => (n == null ? null : +Number(n).toFixed(p));
const warn = (m) => console.warn(`  ! ${m}`);

// Minimal CSV parser. Handles quoted fields containing commas.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map((h) => h.replace(/^﻿/, "").trim());
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function readBctCatalog() {
  const f = inputFile("selected_bcts.csv");
  if (!f) { warn("no selected_bcts.csv; BCT names fall back to the database"); return []; }
  return parseCsv(fs.readFileSync(f, "utf8")).map((r) => ({
    uri: r.uri,
    name: r.bct.replace(/\s*BCT$/, ""),
    fullName: r.bct,
    level: r.level,
    definition: r.definition,
    altTerms: r.alt_terms || null,
    corpusCount: Number(r.count) || 0,
  }));
}

function readWeather() {
  // Only the mock participant layer uses this; real weather comes from the
  // database, so its absence is not worth warning about.
  const f = inputFile("weather_daily.csv");
  if (!f) return [];
  return parseCsv(fs.readFileSync(f, "utf8"))
    .map((r) => ({
      date: r.Time,
      tempF: round(Number(r.Temperature_Mean), 1),
      precipIn: round(Number(r.Precipitation_Sum), 3),
    }))
    .filter((r) => r.date && Number.isFinite(r.tempF));
}

// The CURRENT schema (the e2e rewrite, data/schema.sql).
// Differences that matter to the dashboard:
//   USERS(UID, ...)            real participants, keyed by UID. No names.
//   MESSAGE_INPUTS.UID         one UID per MSG_ID: a message goes to ONE user
//   DELIVERED_MESSAGES         the send log, one row per message
//   REJECTED_MESSAGES          rejections, joined to METRIC for the gate name
//   RUNS + MESSAGES.RUN_ID     a run contains batches
//   PERSONALIZATION_*          real per-user steps and per-zipcode weather
//   LLM_WRITERS(MODEL_ID)      LLM_SCORES joins on MODEL_ID, not a model string
// Output is normalised to the same shape the legacy reader produces, so the
// dashboard consumes either without knowing which it got.
function readCurrentSchema(q, tables) {
  const has = (t) => tables.has(t);
  const safe = (sql, fallback = []) => {
    try { return q(sql); } catch (e) { warn(`${String(e.message).slice(0, 90)}`); return fallback; }
  };

  const writers = safe(`
    SELECT w.WRITER_ID id, w.WRITER_TYPE type, w.CREATED_AT createdAt,
           l.MODEL model, l.TEMPERATURE temperature, l.TOP_P topP,
           l.FREQ_PENAL freqPenalty, l.PRES_PENAL presPenalty,
           l.MAX_TOKENS maxTokens, l.REASONING_EFFORT reasoningEffort,
           h.WRITER_NAME humanName, h.SOURCE humanRole
    FROM WRITERS w
    LEFT JOIN LLM_WRITERS l ON l.MODEL_ID = w.WRITER_ID
    LEFT JOIN HUMAN_WRITERS h ON h.WRITER_ID = w.WRITER_ID
    ORDER BY w.WRITER_ID`);

  const prompts = safe(`SELECT PROMPT_ID id, PROMPT_TYPE type, NULL createdAt FROM PROMPTS ORDER BY PROMPT_ID`);

  // A message can fail several metrics, so rejections are collected separately.
  // Joining them into the message query would duplicate the message per gate.
  const rejectionsByMsg = {};
  for (const r of safe(`
    SELECT r.MSG_ID msgId, mt.METRIC_NAME gate, r.REASON reason
    FROM REJECTED_MESSAGES r
    LEFT JOIN METRIC_VERSION mv ON mv.VERSION_ID = r.VERSION_ID
    LEFT JOIN METRIC mt ON mt.METRIC_ID = mv.METRIC_ID
    ORDER BY r.REJECTED_ID`)) {
    (rejectionsByMsg[r.msgId] ??= []).push({ gate: r.gate, reason: (r.reason || "").slice(0, 400) });
  }

  // BCT_SPECS carries the URI a message was generated against.
  const messages = safe(`
    SELECT m.MSG_ID id, m.MESSAGE text, i.PROMPT_ID promptId, m.WRITER_ID writerId,
           m.CREATED_AT createdAt, m.PSEUDO_TIME pseudoTime, m.TOKEN_COUNT tokens,
           m.LATENCY_MS latencyMs, m.COST_USD costUsd,
           m.BATCH_ID batchId, m.RUN_ID runId,
           s.uri bctUri, i.UID uid,
           b.SENTIMENT sentiment, b.WORD_COUNT words, b.CHAR_COUNT chars,
           b.FLESCH_KINCAID_GRADE fkGrade, b.FLESCH_READING_EASE readingEase,
           d.MSG_ID deliveredId, d.TIMESTAMP deliveredAt, d.SCORE deliveredScore,
           d.REASON deliveredReason
    FROM MESSAGES m
    LEFT JOIN MESSAGE_INPUTS i ON i.MSG_ID = m.MSG_ID
    LEFT JOIN BCT_SPECS s ON s.SPEC_ID = i.BCT_VERSION_ID
    LEFT JOIN BASIC_SCORES b ON b.MSG_ID = m.MSG_ID
    LEFT JOIN DELIVERED_MESSAGES d ON d.MSG_ID = m.MSG_ID
    ORDER BY m.MSG_ID`).map((m) => {
      const rejections = rejectionsByMsg[m.id] || [];
      const uid = m.uid && m.uid !== "N/A" ? m.uid : null;
      return {
        ...m,
        uid,
        sentiment: round(m.sentiment, 4),
        fkGrade: round(m.fkGrade, 2),
        readingEase: round(m.readingEase, 2),
        status: m.deliveredId != null ? "accepted" : rejections.length ? "rejected" : "generated",
        failedGates: rejections.map((r) => r.gate).filter(Boolean),
        rejectedBy: rejections[0]?.gate ?? null,
        rejectedReason: rejections[0]?.reason ?? null,
        rejections,
      };
    });

  const llmScores = safe(`
    SELECT s.MSG_ID msgId, COALESCE(l.MODEL, 'model ' || s.MODEL_ID) model,
           s.BCT_FIDELITY bctFidelity, s."NATURAL" naturalness, s.UNDERSTANDABLE understandable,
           s.CLARITY clarity, s.PROMOTE_PA promotePa, s.ACCEPTABLE acceptable, s.AI ai,
           s.BCT_CONF bctConf, s.NATURAL_CONF naturalConf, s.UNDERSTAND_CONF understandConf,
           s.CLARITY_CONF clarityConf, s.PROMOTE_CONF promoteConf,
           s.ACCEPTABLE_CONF acceptableConf, s.AI_CONF aiConf
    FROM LLM_SCORES s
    LEFT JOIN LLM_WRITERS l ON l.MODEL_ID = s.MODEL_ID`);

  const bctNames = Object.fromEntries(
    safe(`SELECT URI uri, NAME name, LEVEL level, NULL definition FROM BCTS`).map((b) => [b.uri, b])
  );

  const runs = safe(`
    SELECT r.RUN_ID id, r.START_TIME startTime, r.ARCH_TYPE archType,
           v.GIT_BRANCH gitBranch, v.GIT_HASH gitHash
    FROM RUNS r LEFT JOIN ARCH_VERSIONS v ON v.VERSION_ID = r.ARCH_VERSION
    ORDER BY r.RUN_ID`);

  // Real participants. This schema stores no names by design.
  let users = has("USERS")
    ? safe(`SELECT UID uid, PHONE_NUMBER phone, AGE age, GENDER gender, RACE race,
                   WEIGHT_CATEGORY weightCategory, ETHNITICITY ethnicity FROM USERS ORDER BY UID`)
    : [];

  // A run can reference participants without USERS having been written. Fall
  // back to the UIDs the data actually mentions so they are not lost.
  if (!users.length) {
    const seen = safe(`
      SELECT DISTINCT UID uid FROM MESSAGE_INPUTS WHERE UID IS NOT NULL AND UID <> 'N/A'
      UNION SELECT DISTINCT UID FROM PERSONALIZATION_DAILY_ACTIVITY
      ORDER BY uid`);
    if (seen.length) {
      warn(`USERS is empty; inferred ${seen.length} participant(s) from message and activity rows`);
      users = seen.map((u) => ({ uid: u.uid, inferred: true }));
    }
  }

  const dailyActivity = has("PERSONALIZATION_DAILY_ACTIVITY")
    ? safe(`SELECT UID uid, TIMESTAMP ts, TOTAL_STEPS steps, CALORIES calories,
                   RESTING_HEART_RATE restingHr, TOTAL_HOURS_ASLEEP hoursAsleep,
                   VERY_ACTIVE_MINUTES veryActiveMin, SEDENTARY_MINUTES sedentaryMin
            FROM PERSONALIZATION_DAILY_ACTIVITY ORDER BY UID, TIMESTAMP`)
    : [];

  const dailyWeather = has("PERSONALIZATION_DAILY_WEATHER")
    ? safe(`SELECT ZIPCODE zip, TIMESTAMP ts, TEMPERATURE_2M_MEAN tempMean,
                   TEMPERATURE_2M_MAX tempMax, TEMPERATURE_2M_MIN tempMin,
                   PRECIPITATION_SUM precipSum, PRECIPITATION_HOURS precipHours
            FROM PERSONALIZATION_DAILY_WEATHER ORDER BY ZIPCODE, TIMESTAMP`)
    : [];

  return {
    file: path.basename(DB_FILE),
    schema: "current",
    writers, prompts, messages, llmScores, bctNames,
    runs, users, dailyActivity, dailyWeather,
  };
}

// The LEGACY generation database (msg_gen/data/messages*.db)
function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    warn(`missing ${DB_FILE} — snapshot will have no DB section`);
    return null;
  }
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const q = (sql) => db.prepare(sql).all();

  // Which generation of the schema is this? The e2e rewrite renamed LLM_WRITER
  // -> LLM_WRITERS and added USERS / RUNS / DELIVERED_MESSAGES.
  const tables = new Set(q(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name));
  if (tables.has("DELIVERED_MESSAGES") || tables.has("LLM_WRITERS")) {
    console.log("  schema: current (e2e) — USERS / RUNS / DELIVERED_MESSAGES");
    const out = readCurrentSchema(q, tables);
    db.close();
    return out;
  }
  console.log("  schema: legacy (msg_gen/data/messages*.db)");

  /**
   * The three databases in msg_gen/data/ do not share a schema. v4 added
   * MESSAGES.BATCH_ID, LLM_WRITER.PRES_PENAL, LLM_SCORES.AI and the *_CONF
   * columns. So every column is resolved against the database actually being
   * read, and anything absent is selected as NULL rather than erroring.
   */
  const columnsOf = (table) => {
    try {
      return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
    } catch {
      return new Set();
    }
  };
  /** `TABLE.COL alias` when the column exists, else `fallback alias`. */
  const pick = (cols, prefix, column, alias, fallback = "NULL") =>
    cols.has(column) ? `${prefix}."${column}" ${alias}` : `${fallback} ${alias}`;

  const mCols = columnsOf("MESSAGES");
  const wCols = columnsOf("LLM_WRITER");
  const sCols = columnsOf("LLM_SCORES");
  const missing = [
    !mCols.has("BATCH_ID") && "MESSAGES.BATCH_ID",
    !wCols.has("PRES_PENAL") && "LLM_WRITER.PRES_PENAL",
    !sCols.has("AI") && "LLM_SCORES.AI",
  ].filter(Boolean);
  if (missing.length) warn(`older schema — absent, will read as empty: ${missing.join(", ")}`);

  const writers = q(`
    SELECT w.WRITER_ID id, w.WRITER_TYPE type, w.CREATED_AT createdAt,
           l.MODEL model, l.TEMPERATURE temperature, l.TOP_P topP,
           ${pick(wCols, "l", "FREQ_PENAL", "freqPenalty")},
           ${pick(wCols, "l", "PRES_PENAL", "presPenalty")},
           h.WRITER_NAME humanName, h.WRITER_ROLE humanRole
    FROM WRITERS w
    LEFT JOIN LLM_WRITER l ON l.WRITER_ID = w.WRITER_ID
    LEFT JOIN HUMAN_WRITER h ON h.WRITER_ID = w.WRITER_ID
    ORDER BY w.WRITER_ID`);

  const prompts = q(`SELECT PROMPT_ID id, PROMPT_TYPE type, CREATED_AT createdAt FROM PROMPTS ORDER BY PROMPT_ID`);

  const messages = q(`
    SELECT m.MSG_ID id, m.MESSAGE text, m.PROMPT_ID promptId, m.WRITER_ID writerId,
           m.CREATED_AT createdAt, m.TOKEN_COUNT tokens, m.LATENCY_MS latencyMs,
           m.COST_USD costUsd, ${pick(mCols, "m", "BATCH_ID", "batchId", "0")},
           i.BCT bctUri, i.SEQ seq, i.FITBIT_PID fitbitPid,
           i.FITBIT fitbit, i.WEATHER weather, i.DEMOGRAPHIC demographic,
           b.SENTIMENT sentiment, b.WORD_COUNT words, b.CHAR_COUNT chars,
           b.FLESCH_KINCAID_GRADE fkGrade, b.FLESCH_READING_EASE readingEase
    FROM MESSAGES m
    LEFT JOIN MESSAGE_INPUTS i ON i.MSG_ID = m.MSG_ID
    LEFT JOIN BASIC_SCORES b ON b.MSG_ID = m.MSG_ID
    ORDER BY m.MSG_ID`).map((m) => ({
      ...m,
      sentiment: round(m.sentiment, 4),
      fkGrade: round(m.fkGrade, 2),
      readingEase: round(m.readingEase, 2),
      // schema reserves these for the user/context join; currently unpopulated
      fitbitPid: m.fitbitPid || null,
      fitbit: m.fitbit || null,
      weather: m.weather || null,
      demographic: m.demographic || null,
    }));

  const llmScores = q(`
    SELECT MSG_ID msgId, MODEL model,
           ${pick(sCols, "LLM_SCORES", "BCT_FIDELITY", "bctFidelity")},
           ${pick(sCols, "LLM_SCORES", "NATURAL", "naturalness")},
           ${pick(sCols, "LLM_SCORES", "UNDERSTANDABLE", "understandable")},
           ${pick(sCols, "LLM_SCORES", "CLARITY", "clarity")},
           ${pick(sCols, "LLM_SCORES", "PROMOTE_PA", "promotePa")},
           ${pick(sCols, "LLM_SCORES", "ACCEPTABLE", "acceptable")},
           ${pick(sCols, "LLM_SCORES", "AI", "ai")},
           ${pick(sCols, "LLM_SCORES", "BCT_CONF", "bctConf")},
           ${pick(sCols, "LLM_SCORES", "NATURAL_CONF", "naturalConf")},
           ${pick(sCols, "LLM_SCORES", "UNDERSTAND_CONF", "understandConf")},
           ${pick(sCols, "LLM_SCORES", "CLARITY_CONF", "clarityConf")},
           ${pick(sCols, "LLM_SCORES", "PROMOTE_CONF", "promoteConf")},
           ${pick(sCols, "LLM_SCORES", "ACCEPTABLE_CONF", "acceptableConf")},
           ${pick(sCols, "LLM_SCORES", "AI_CONF", "aiConf")}
    FROM LLM_SCORES`);

  const bctNames = Object.fromEntries(
    q(`SELECT BCT_URI uri, BCT_NAME name, LEVEL level, DEFINITION definition FROM BCTS`).map((b) => [b.uri, b])
  );

  db.close();
  return { file: path.basename(DB_FILE), schema: "legacy", writers, prompts, messages, llmScores, bctNames };
}

// Agentic runs
function findRuns(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 3) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(dir, entry.name);
    if (fs.existsSync(path.join(p, "summary.json"))) out.push(p);
    else out.push(...findRuns(p, depth + 1));
  }
  return out;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed trailing line */ }
  }
  return out;
}

function readAgentic() {
  const dirs = findRuns(AGENTIC);
  const runs = [];
  const candidates = [];

  for (const dir of dirs) {
    const rel = path.relative(AGENTIC, dir);
    const id = rel.split(path.sep).join("__");
    let summary;
    try { summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")); }
    catch { warn(`unreadable summary in ${rel}`); continue; }

    const parts = rel.split(path.sep);
    const devCycle = parts.length > 1 ? parts[0] : "(top level)";
    const label = parts[parts.length - 1];

    // target_bct is absent on two older runs, so fall back to the folder name.
    const targetBct =
      summary.target_bct ||
      (/action_planning|^ap/.test(label) ? "action_planning"
        : /self_monitoring|^sm/.test(label) ? "self_monitoring"
        : /goal_setting|^gs|cosine/.test(label) ? "goal_setting"
        : "unknown");

    runs.push({
      id,
      label,
      devCycle,
      path: path.join("msg_gen", "agentic", rel),
      targetBct,
      targetBctName: summary.target_bct_name || null,
      bctInferred: !summary.target_bct,
      generatorModel: summary.generator_model || null,
      criticModel: summary.critic_model || null,
      diversityPromptVersion: summary.diversity_prompt_version || null,
      agentModes: summary.agent_modes || null,
      totalCycles: summary.total_cycles ?? null,
      accepted: summary.accepted ?? null,
      rejected: summary.rejected ?? null,
      acceptanceRatePct: summary.acceptance_rate_pct ?? null,
      stopReason: summary.stop_reason || null,
      maxRejectionStreak: summary.max_rejection_streak ?? null,
      rejectionsByCritic: summary.rejections_by_critic || {},
      failureGates: summary.failure_gates || {},
    });

    for (const r of readJsonl(path.join(dir, "accepted.jsonl"))) {
      candidates.push({
        id: `${id}#a${r.idx}`,
        runId: id,
        bct: targetBct,
        status: "accepted",
        idx: r.idx,
        cycle: r.cycle,
        text: r.message,
        coreIdea: r.core_idea || null,
        critic: null,
        reason: null,
        failedGates: [],
        // keep each gate's verdict, drop the bulky nested detail blobs
        gates: Object.fromEntries(
          Object.entries(r.evaluations || {}).map(([g, e]) => [
            g, { mode: e.mode, passed: e.passed, reason: (e.reason || "").slice(0, 400) },
          ])
        ),
      });
    }

    for (const r of readJsonl(path.join(dir, "rejected.jsonl"))) {
      const failedGates = r.failed_gates || (r.critic ? [r.critic] : []);
      candidates.push({
        id: `${id}#r${r.idx}`,
        runId: id,
        bct: targetBct,
        status: "rejected",
        idx: r.idx,
        cycle: r.cycle,
        text: r.message,
        coreIdea: r.core_idea || null,
        critic: r.critic || null,
        reason: (r.reason || "").slice(0, 400),
        failedGates,
        systemError: !!r.system_error,
        gates: Object.fromEntries(
          Object.entries(r.feedback || {}).map(([g, e]) => [
            g, { mode: e.kind || "critic", passed: false, reason: (e.reason || "").slice(0, 400) },
          ])
        ),
      });
    }
  }

  runs.sort((a, b) => (a.devCycle + a.label).localeCompare(b.devCycle + b.label));
  return { runs, candidates };
}

// Build
console.log("Building dashboard snapshot (read-only)…");
const db = readDb();
const agentic = readAgentic();
const bctCatalog = readBctCatalog();
const weather = readWeather();

const snapshot = {
  generatedAt: new Date().toISOString(),
  sources: {
    db: db ? path.basename(DB_FILE) : null,
    agenticRuns: agentic.runs.length,
    bctCatalog: inputFile("selected_bcts.csv") ? path.relative(ROOT, inputFile("selected_bcts.csv")) : null,
    weather: inputFile("weather_daily.csv") ? path.relative(ROOT, inputFile("weather_daily.csv")) : null,
  },
  bctCatalog,
  weather,
  db,
  agentic,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot));

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`
  DB file             ${snapshot.sources.db || "(none)"}
  messages            ${db?.messages.length ?? 0}
  llm score rows      ${db?.llmScores.length ?? 0}
  prompt variants     ${db?.prompts.length ?? 0}
  writer configs      ${db?.writers.length ?? 0}
  agentic runs        ${agentic.runs.length}
  agentic candidates  ${agentic.candidates.length}
  bct catalog         ${bctCatalog.length}
  weather days        ${weather.length}

  -> ${path.relative(ROOT, OUT)}  (${mb} MB)
`);
