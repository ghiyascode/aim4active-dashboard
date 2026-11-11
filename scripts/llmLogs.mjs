// Reads the pipeline's LLM call log (llm_logs_*.db, table llm_calls) into the
// shape the dashboard's "LLM logs" view and message history use.
//
// The log has no message id column. Calls are linked to messages by text:
//
//   generate    its output IS a candidate message. Matched to MESSAGES.MESSAGE
//               exactly (whitespace-normalised) to find the database message.
//   safety, alignment, feedback, diversity
//               critic calls embed the candidate in their prompt. Linked to the
//               most recent generated candidate (within 30 minutes) whose text
//               appears in the prompt. The pool of earlier accepted messages in
//               a diversity prompt is older, so "most recent" picks the
//               candidate under review rather than the pool.
//   judge       "Question: ... Message: <text>". Linked by exact text.
//
// A call that matches nothing is still kept, so the logs view shows every call.
//
// Timestamps in the log are UTC (they run five hours ahead of MESSAGES.CREATED_AT,
// which is US Central), so they are emitted with a Z.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const STAGES = [
  ["generate", /^You are generating motivational/],
  ["safety", /^You are a safety classifier/],
  ["alignment", /^You are a strict alignment classifier/],
  ["feedback", /^You provide revision feedback/],
  ["diversity", /^You are a semantic diversity classifier/],
  ["judge", /^Question:/],
];

const LINK_WINDOW_MS = 30 * 60 * 1000;

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

const tryJson = (s) => {
  if (!s) return null;
  try {
    const v = JSON.parse(s.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

// "2026-09-09 07:23:12.038492" -> "2026-09-09T07:23:12.038Z"
const toIso = (s) => (s ? `${s.replace(" ", "T").slice(0, 23)}Z` : null);

/** Newest llm_logs*.db in the given directories, or null. */
export function findLlmLogsDb(dirs) {
  const found = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/^llm_logs.*\.db$/.test(f)) found.push(path.join(dir, f));
    }
  }
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || null;
}

export const isLlmLogsDb = (file) => /^llm_logs.*\.db$/.test(path.basename(file));

function stageOf(prompt) {
  for (const [name, re] of STAGES) if (re.test(prompt)) return name;
  return "other";
}

// One short verdict per call, so the list can show outcomes without opening it.
function summarise(stage, output) {
  const j = tryJson(output);
  switch (stage) {
    case "safety":
    case "alignment":
      return { verdict: j?.verdict ?? null, reason: j?.reason ?? null };
    case "diversity":
      return {
        verdict: j?.novelty_score != null ? `novelty ${j.novelty_score}/5` : null,
        reason: j?.reason ?? null,
        coreIdea: j?.candidate_core_idea ?? null,
      };
    case "feedback":
      return {
        verdict: j?.failed_gate ? `${j.failed_gate} → ${j.suggested_action || "revise"}` : null,
        reason: j?.feedback ?? null,
        guidance: j?.revision_guidance ?? null,
      };
    case "judge": {
      const answer = /answer:\s*([0-9.]+)/i.exec(output || "");
      const justification = /justification:\s*([\s\S]*?)(?:\n\s*answer:|$)/i.exec(output || "");
      return {
        verdict: answer ? `${answer[1]} / 5` : null,
        reason: justification ? justification[1].trim() : null,
      };
    }
    default:
      return {};
  }
}

/**
 * @param file        path to the llm_logs database
 * @param dbMessages  [{ id, text }] from the message database, to link to
 */
export function readLlmLogs(file, dbMessages = []) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare(`
    SELECT id, created_at, git_branch, git_hash, function_name, model, prompt, system,
           reasoning_effort, chat_kwargs_json, response_json, error, latency_ms
    FROM llm_calls
    ORDER BY created_at, id`).all();
  db.close();

  const calls = rows.map((r) => {
    const resp = tryJson(r.response_json);
    const choice = resp?.choices?.[0];
    const msg = choice?.message || {};
    const kwargs = tryJson(r.chat_kwargs_json) || {};
    const stage = stageOf(r.prompt || "");
    const output = msg.content ?? null;
    const bct = stage === "generate" ? (/\(BCT\):\s*([^\n.]+)/.exec(r.prompt) || [])[1] || null : null;

    return {
      id: r.id,
      at: toIso(r.created_at),
      stage,
      model: r.model,
      fn: r.function_name,
      branch: r.git_branch,
      commit: (r.git_hash || "").slice(0, 8),
      effort: r.reasoning_effort || null,
      temperature: kwargs.temperature ?? null,
      maxTokens: kwargs.max_tokens ?? null,
      latencyMs: r.latency_ms ?? null,
      tokensIn: resp?.usage?.prompt_tokens ?? null,
      tokensOut: resp?.usage?.completion_tokens ?? null,
      finish: choice?.finish_reason ?? null,
      error: r.error ? r.error.slice(0, 1200) : null,
      bct,
      ...summarise(stage, output),
      output,
      reasoning: msg.reasoning ?? msg.reasoning_content ?? null,
      system: r.system || null,
      prompt: r.prompt,
      candidate: null, // id of the generate call whose candidate this call is about
    };
  });

  // ---- link calls to candidates --------------------------------------------
  const gens = calls.filter((c) => c.stage === "generate" && c.output);
  const genTime = gens.map((g) => Date.parse(g.at));
  const genText = gens.map((g) => norm(g.output));
  const genByText = {};
  gens.forEach((g, i) => {
    g.candidate = g.id;
    (genByText[genText[i]] ??= []).push(g);
  });

  let latest = -1; // index of the newest generate call at or before the current call
  for (const c of calls) {
    const t = Date.parse(c.at);
    while (latest + 1 < gens.length && genTime[latest + 1] <= t) latest++;
    if (c.stage === "generate") continue;

    if (c.stage === "judge") {
      const text = norm((/\nMessage:\s*([\s\S]*)$/.exec(c.prompt) || [])[1]);
      const match = genByText[text];
      if (match) c.candidate = match[match.length - 1].id;
      continue;
    }

    const prompt = norm(c.prompt);
    for (let i = latest; i >= 0 && t - genTime[i] <= LINK_WINDOW_MS; i--) {
      if (genText[i] && prompt.includes(genText[i])) {
        c.candidate = gens[i].id;
        break;
      }
    }
  }

  // ---- link database messages to their generate call -----------------------
  const used = new Set();
  const messages = {};
  for (const m of [...dbMessages].sort((a, b) => a.id - b.id)) {
    const g = (genByText[norm(m.text)] || []).find((x) => !used.has(x.id));
    if (g) {
      used.add(g.id);
      messages[m.id] = g.id;
    }
  }

  const byStage = {};
  for (const c of calls) byStage[c.stage] = (byStage[c.stage] || 0) + 1;

  const meta = {
    file: "llm_logs.json",
    source: path.basename(file),
    calls: calls.length,
    errors: calls.filter((c) => c.error).length,
    linkedCalls: calls.filter((c) => c.candidate != null).length,
    linkedMessages: Object.keys(messages).length,
    first: calls[0]?.at ?? null,
    last: calls[calls.length - 1]?.at ?? null,
    byStage,
  };

  return { meta, logs: { generatedAt: new Date().toISOString(), ...meta, calls, messages } };
}
