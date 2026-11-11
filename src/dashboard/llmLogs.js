// The LLM call log: loading, indexing, and per-message generation history.
//
// The log is a separate file (llm_logs.json, built from llm_logs_*.db by
// scripts/llmLogs.mjs). It is several MB, so it is fetched once, on first use,
// and shared by the LLM logs view and the message detail panel.
//
// Where no log covers a message (the agentic run folders predate logging),
// history is built from the run files instead and every call entry is flagged
// mock. Attempt texts and gate verdicts in that case are still real; only the
// call records around them are placeholders.

import { useEffect, useState } from "react";
import { isEncrypted, openPart } from "./decrypt";

export const LLM_LOGS_URL = `${process.env.PUBLIC_URL || ""}/admin/data/llm_logs.json`;

export const STAGES = {
  generate: { label: "Generate", hint: "Drafts a candidate message" },
  safety: { label: "Safety", hint: "Hard safety gate" },
  alignment: { label: "Alignment", hint: "Does it deliver the target BCT, and only that" },
  feedback: { label: "Feedback", hint: "Explains a metric failure and how to revise" },
  diversity: { label: "Diversity", hint: "Is the idea new against the accepted pool" },
  judge: { label: "Judge", hint: "Scores a finished message 1–5 on one question" },
  style: { label: "Style", hint: "Style critic" },
  other: { label: "Other", hint: "Unrecognised prompt" },
};
export const stageLabel = (s) => STAGES[s]?.label || s;

// Gates that are LLM calls. The rest (readability, sentiment, cosine, text
// cleanliness) are computed metrics, which the pipeline follows with a feedback
// call when they fail.
const LLM_GATES = new Set(["safety", "alignment", "diversity", "style"]);

/** "pass" | "fail" | null, for colouring a call's outcome. */
export function outcome(call) {
  if (call.error) return "error";
  const v = String(call.verdict || "").toLowerCase();
  if (v === "pass") return "pass";
  if (v === "fail") return "fail";
  if (call.stage === "feedback" && call.verdict) return "fail";
  return null;
}

function index(raw) {
  if (!raw || !Array.isArray(raw.calls)) throw new Error("The LLM log file is not in the expected format.");
  const byCandidate = {};
  for (const c of raw.calls) {
    if (c.candidate == null) continue;
    (byCandidate[c.candidate] ??= []).push(c);
  }
  for (const list of Object.values(byCandidate)) list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  return {
    calls: raw.calls,
    messages: raw.messages || {},
    byCandidate,
    models: [...new Set(raw.calls.map((c) => c.model))].sort(),
    source: raw.source,
  };
}

/**
 * Returns a memoised loader. Resolves to null when the snapshot was built
 * without a log.
 */
export function makeLlmLogLoader(meta, rawDataKey) {
  let pending = null;
  return () => {
    if (!meta) return Promise.resolve(null);
    pending ??= fetch(LLM_LOGS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`llm_logs.json returned ${r.status}`);
        return r.json();
      })
      .then(async (payload) => {
        if (!isEncrypted(payload)) return index(payload);
        if (!rawDataKey) throw new Error("The LLM log is encrypted but this session has no key. Sign out and in again.");
        try {
          return index(await openPart(payload, rawDataKey));
        } catch (e) {
          if (e.name === "OperationError") {
            throw new Error("llm_logs.json does not match this snapshot. Copy both files from the same build.");
          }
          throw e;
        }
      })
      .catch((e) => {
        pending = null; // allow a retry
        throw e;
      });
    return pending;
  };
}

/** { status: "none" | "loading" | "ready" | "error", logs, error } */
export function useLlmLogs(data) {
  const available = Boolean(data?.llmLogsMeta && data.loadLlmLogs);
  const [state, setState] = useState({ status: available ? "loading" : "none", logs: null, error: null });

  useEffect(() => {
    if (!available) return undefined;
    let live = true;
    data.loadLlmLogs()
      .then((logs) => live && setState({ status: logs ? "ready" : "none", logs, error: null }))
      .catch((e) => live && setState({ status: "error", logs: null, error: e.message }));
    return () => { live = false; };
  }, [available, data]);

  return state;
}

// ---- generation history ------------------------------------------------------

function mockCalls(msg) {
  const calls = [{
    id: `mock:${msg.key}:generate`,
    mock: true,
    stage: "generate",
    model: msg.model || "not recorded",
    output: msg.text,
    reasoning: null,
  }];
  for (const [gate, e] of Object.entries(msg.gates || {})) {
    const verdict = e.passed === true ? "pass" : e.passed === false ? "fail" : null;
    if (LLM_GATES.has(gate)) {
      calls.push({
        id: `mock:${msg.key}:${gate}`,
        mock: true,
        stage: gate,
        model: msg.criticModel || "not recorded",
        verdict,
        reason: e.reason || null,
        output: JSON.stringify({ verdict, reason: e.reason || "" }, null, 2),
      });
    } else if (e.passed === false) {
      // A failed metric is followed by a feedback call in the pipeline.
      calls.push({
        id: `mock:${msg.key}:feedback:${gate}`,
        mock: true,
        stage: "feedback",
        model: msg.criticModel || "not recorded",
        verdict: `${gate} → revise`,
        reason: e.reason || null,
        output: JSON.stringify({ failed_gate: gate, feedback: e.reason || "" }, null, 2),
      });
    }
  }
  return calls;
}

// The attempts that led to a message. A database batch is one streak of
// attempts ending in a delivered message, so it is shown whole. An agentic run
// is one long sequence, so it is cut to the streak containing the message:
// after the previous accepted candidate, up to and including this one.
function attemptsFor(m, messages) {
  if (m.source === "db") {
    return messages
      .filter((x) => x.source === "db" && x.batchKey === m.batchKey)
      .sort((a, b) => a.rawId - b.rawId);
  }
  const run = messages
    .filter((x) => x.source === "agentic" && x.runId === m.runId && x.cycle != null)
    .sort((a, b) => a.cycle - b.cycle || (a.idx ?? 0) - (b.idx ?? 0));
  const at = run.findIndex((x) => x.key === m.key);
  if (at === -1) return [m];
  let start = at;
  while (start > 0 && run[start - 1].status !== "accepted") start--;
  return run.slice(start, at + 1);
}

/**
 * History for one message: the attempts in its streak, each with its LLM calls.
 * Each attempt says whether its calls are real (from the log) or mock.
 */
export function buildHistory(m, messages, logs) {
  return attemptsFor(m, messages).map((msg) => {
    const genId = msg.source === "db" && logs ? logs.messages[msg.rawId] : undefined;
    const calls = genId != null ? logs.byCandidate[genId] || [] : null;
    return {
      msg,
      current: msg.key === m.key,
      mock: !calls,
      calls: calls || mockCalls(msg),
    };
  });
}
