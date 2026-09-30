// Loads the snapshot, flattens both message sources into one table, and
// attaches the mock participant layer.
//
// The two sources carry different evidence and are not interchangeable:
//
//   db       messages from the generation database. Tagged with a BCT, prompt
//            and writer config, and scored 1-5 by LLM judges. No accept or
//            reject verdict; these were never adjudicated.
//
//   agentic  candidates from the run folders. Accepted or rejected by the
//            critic gates with a written reason. Never judge-scored.
//
// They are merged on the fields they share and keep the fields they do not, so
// one search box covers both.

import { useEffect, useState, useMemo } from "react";
import { BCT_KEY_TO_URI, bctColor } from "./palette";
import { buildParticipantLayer } from "./participants";

export const SNAPSHOT_URL = `${process.env.PUBLIC_URL || ""}/admin/data/snapshot.json`;

// Display names only. Which gates exist is always read from the data, because
// runs have added them over time: `style` appears in the later runs and a fixed
// list silently dropped it. Anything not listed here falls back to its raw key.
const GATE_LABELS = {
  text_cleanliness: "Text cleanliness",
  readability: "Readability",
  sentiment: "Sentiment",
  style: "Style",
  cosine: "Cosine",
  safety: "Safety",
  alignment: "Alignment",
  diversity: "Diversity",
};

// Known gates sort in pipeline order; unrecognised ones sort after, by name.
const GATE_ORDER = Object.keys(GATE_LABELS);

export function gateLabel(key) {
  return GATE_LABELS[key] || String(key).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function orderGates(keys) {
  return [...new Set(keys)].sort((a, b) => {
    const ai = GATE_ORDER.indexOf(a), bi = GATE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// The 1-5 dimensions the LLM judges score each message on. Names are the
// LLM_SCORES column names with underscores removed, not reworded.
export const SCORE_DIMS = [
  { key: "bctFidelity", name: "BCT fidelity" },
  { key: "naturalness", name: "Natural" },
  { key: "understandable", name: "Understandable" },
  { key: "clarity", name: "Clarity" },
  { key: "promotePa", name: "Promote PA" },
  { key: "acceptable", name: "Acceptable" },
  { key: "ai", name: "AI" },
];

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRange(first, last) {
  const [fy, fm, fd] = first.split("-").map(Number);
  const [ly, lm, ld] = last.split("-").map(Number);
  if (first === last) return `${fd} ${MONTHS[fm - 1]} ${fy}`;
  if (fm === lm && fy === ly) return `${fd}–${ld} ${MONTHS[fm - 1]} ${fy}`;
  return `${fd} ${MONTHS[fm - 1]} – ${ld} ${MONTHS[lm - 1]} ${ly}`;
}

// A bare BATCH_ID means nothing to a reader, so each batch is labelled with the
// dates it ran over. Returns { label(id), count(id) } for the batch list.
function batchLabeller(messages) {
  const spans = {};
  for (const m of messages) {
    const span = (spans[m.batchId] ??= { count: 0, first: null, last: null });
    span.count++;
    const day = (m.createdAt || "").slice(0, 10);
    if (!day) continue;
    if (!span.first || day < span.first) span.first = day;
    if (!span.last || day > span.last) span.last = day;
  }
  return {
    count: (id) => spans[id]?.count ?? 0,
    label: (id) => {
      const span = spans[id];
      return span?.first ? `Batch ${id} · ${formatRange(span.first, span.last)}` : `Batch ${id}`;
    },
  };
}

// The current schema records runs in the database; older output recorded them
// as folders on disk. Both are summarised the same way so the Pipeline view can
// read either without caring which it got.
function runsFromDb(snap, dbMessages) {
  const tally = {};
  for (const m of dbMessages) {
    if (m.runId == null) continue;
    const run = (tally[m.runId] ??= { total: 0, accepted: 0, rejected: 0, gates: {}, models: new Set() });
    run.total++;
    if (m.status === "accepted") run.accepted++;
    else if (m.status === "rejected") run.rejected++;
    for (const gate of m.failedGates || []) run.gates[gate] = (run.gates[gate] || 0) + 1;
    if (m.model) run.models.add(m.model);
  }

  const meta = {};
  for (const r of snap.db?.runs || []) meta[r.id] = r;

  return Object.entries(tally).map(([id, run]) => {
    const info = meta[id] || meta[Number(id)] || {};
    const judged = run.accepted + run.rejected;
    return {
      id: `run-${id}`,
      label: info.startTime ? `Run ${id} · ${info.startTime.slice(0, 10)}` : `Run ${id}`,
      devCycle: info.gitBranch || info.archType || "database",
      totalCycles: run.total,
      accepted: run.accepted,
      rejected: run.rejected,
      acceptanceRatePct: judged ? +((run.accepted / judged) * 100).toFixed(1) : null,
      rejectionsByCritic: run.gates,
      failureGates: run.gates,
      generatorModel: [...run.models][0] || null,
      gitHash: info.gitHash || null,
      startTime: info.startTime || null,
      // present on folder-based runs only
      criticModel: null, diversityPromptVersion: null, stopReason: null,
      targetBct: null, targetBctName: null, agentModes: null, path: null,
    };
  });
}

function normalize(snap) {
  const bctCatalog = snap.bctCatalog || [];
  const bctNames = snap.db?.bctNames || {};

  const bctLabel = (uri) => {
    if (!uri) return "untagged";
    const c = bctCatalog.find((b) => b.uri === uri);
    if (c) return c.name;
    if (bctNames[uri]) return bctNames[uri].name.replace(/\s*BCT$/, "");
    return uri;
  };

  const promptById = Object.fromEntries((snap.db?.prompts || []).map((p) => [p.id, p]));
  const writerById = Object.fromEntries((snap.db?.writers || []).map((w) => [w.id, w]));

  const batches = batchLabeller(snap.db?.messages || []);

  // Judge scores, collapsed to a mean per message but kept per model for the
  // detail panel.
  const scoresByMsg = {};
  for (const s of snap.db?.llmScores || []) (scoresByMsg[s.msgId] = scoresByMsg[s.msgId] || []).push(s);

  const dbMessages = (snap.db?.messages || []).map((m) => {
    const rows = scoresByMsg[m.id] || [];
    const meanScores = {};
    for (const d of SCORE_DIMS) {
      const vals = rows.map((r) => r[d.key]).filter((v) => v != null);
      meanScores[d.key] = vals.length ? +avg(vals).toFixed(2) : null;
    }
    const w = writerById[m.writerId];
    return {
      key: `db:${m.id}`,
      source: "db",
      rawId: m.id,
      text: m.text,
      bctUri: m.bctUri,
      bctName: bctLabel(m.bctUri),
      color: bctColor(m.bctUri),
      batchKey: `batch-${m.batchId}`,
      batchLabel: batches.label(m.batchId),
      // The current schema records a verdict; the legacy one never did, so
      // those messages stay "generated" (never adjudicated).
      status: m.status || "generated",
      createdAt: m.createdAt,
      pseudoTime: m.pseudoTime ?? null,
      deliveredAt: m.deliveredAt ?? null,
      date: (m.createdAt || "").slice(0, 10),
      // db-specific
      promptId: m.promptId,
      promptType: promptById[m.promptId]?.type || String(m.promptId),
      writerId: m.writerId,
      model: w?.model || null,
      temperature: w?.temperature ?? null,
      topP: w?.topP ?? null,
      freqPenalty: w?.freqPenalty ?? null,
      presPenalty: w?.presPenalty ?? null,
      tokens: m.tokens,
      sentiment: m.sentiment,
      words: m.words,
      chars: m.chars,
      fkGrade: m.fkGrade,
      readingEase: m.readingEase,
      scores: meanScores,
      scoreRows: rows,
      uid: m.uid ?? null,
      runId: m.runId ?? null,
      runKey: m.runId != null ? `run-${m.runId}` : null,
      critic: m.rejectedBy ?? null,
      reason: m.rejectedReason ?? null,
      failedGates: m.failedGates ?? [],
      // One entry per failed metric, so the detail panel can list them all.
      gates: m.rejections?.length
        ? Object.fromEntries(m.rejections.map((r) => [r.gate, { passed: false, reason: r.reason }]))
        : null,
      // absent on this source
      cycle: null,
    };
  });

  const runById = Object.fromEntries((snap.agentic?.runs || []).map((r) => [r.id, r]));
  const dbRuns = runsFromDb(snap, dbMessages);

  const agenticMessages = (snap.agentic?.candidates || []).map((c) => {
    const uri = BCT_KEY_TO_URI[c.bct] || null;
    const run = runById[c.runId];
    return {
      key: `ag:${c.id}`,
      source: "agentic",
      rawId: c.id,
      text: c.text,
      bctUri: uri,
      bctName: bctLabel(uri) || c.bct,
      color: bctColor(uri),
      batchKey: c.runId,
      batchLabel: run ? `${run.devCycle} / ${run.label}` : c.runId,
      status: c.status,
      createdAt: null,
      date: null,
      // agentic-specific
      runId: c.runId,
      runKey: c.runId,
      cycle: c.cycle,
      idx: c.idx,
      coreIdea: c.coreIdea,
      critic: c.critic,
      reason: c.reason,
      failedGates: c.failedGates || [],
      gates: c.gates || {},
      model: run?.generatorModel || null,
      criticModel: run?.criticModel || null,
      // absent on this source
      promptId: null, promptType: null, writerId: null, temperature: null, topP: null,
      tokens: null, sentiment: null, words: null, chars: null, fkGrade: null,
      readingEase: null, scores: null, scoreRows: [],
    };
  });

  const messages = [...dbMessages, ...agenticMessages];

  // Database batches and agentic runs are listed together but filtered separately.
  const dbBatchIds = [...new Set((snap.db?.messages || []).map((m) => m.batchId))].sort((a, b) => a - b);
  const batchList = [
    ...dbBatchIds.map((b) => ({
      key: `batch-${b}`,
      label: batches.label(b),
      source: "db",
      count: batches.count(b),
    })),
    ...[...dbRuns, ...(snap.agentic?.runs || [])].map((r) => ({
      key: r.id,
      label: `${r.devCycle} / ${r.label}`,
      source: "agentic",
      count: r.totalCycles ?? (r.accepted || 0) + (r.rejected || 0),
      run: r,
    })),
  ];

  // Every BCT that appears on a message, most-used first.
  const bctCounts = {};
  for (const m of messages) if (m.bctUri) bctCounts[m.bctUri] = (bctCounts[m.bctUri] || 0) + 1;
  const bcts = Object.entries(bctCounts)
    .map(([uri, count]) => ({
      uri,
      name: bctLabel(uri),
      count,
      color: bctColor(uri),
      targeted: bctCatalog.some((b) => b.uri === uri),
      definition: bctCatalog.find((b) => b.uri === uri)?.definition || bctNames[uri]?.definition || null,
    }))
    .sort((a, b) => b.count - a.count);

  // Real participants when the snapshot supports them, mock otherwise.
  const acceptedForMock = agenticMessages
    .filter((m) => m.status === "accepted")
    .map((m) => ({ id: m.key, text: m.text, bct: m.bctName, bctUri: m.bctUri, runId: m.runId }));
  const delivered = dbMessages.filter((m) => m.status === "accepted" && m.uid);
  const participants = buildParticipantLayer(snap, delivered, acceptedForMock);

  return {
    snapshot: snap,
    messages,
    batches: batchList,
    bcts,
    bctCatalog,
    runs: [...dbRuns, ...(snap.agentic?.runs || [])],
    prompts: snap.db?.prompts || [],
    writers: snap.db?.writers || [],
    weather: snap.weather || [],
    participantsAreMock: participants.isMock,
    ...participants, // users, sends, dates, weatherByDate
  };
}

// Loader hook
export function useDashboardData() {
  const [state, setState] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    let live = true;
    fetch(SNAPSHOT_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`snapshot returned ${r.status}`);
        return r.json();
      })
      .then((snap) => live && setState({ status: "ready", data: normalize(snap), error: null }))
      .catch((e) => live && setState({ status: "error", data: null, error: e.message }));
    return () => { live = false; };
  }, []);

  return state;
}

// One filter predicate, shared by every view.
// batchKey scopes to a BATCH_ID in the database, runId to a folder under
// msg_gen/agentic/. They are separate filters because a message belongs to one
// or the other and never both; the UI keeps them mutually exclusive.
export const EMPTY_FILTERS = {
  q: "",
  bctUri: "",
  batchKey: "",
  runId: "",
  source: "",
  status: "",
  uid: "",
  zip: "",
};

export function filterMessages(messages, f, sendsByMessageKey) {
  const q = f.q.trim().toLowerCase();
  return messages.filter((m) => {
    if (f.source && m.source !== f.source) return false;
    if (f.bctUri && m.bctUri !== f.bctUri) return false;
    if (f.batchKey && m.batchKey !== f.batchKey) return false;
    if (f.runId && m.runKey !== f.runId) return false;
    if (f.status && m.status !== f.status) return false;
    // participant scoping: only messages actually routed to that participant
    if ((f.uid || f.zip) && sendsByMessageKey) {
      const routed = sendsByMessageKey[m.key];
      if (!routed) return false;
      if (f.uid && !routed.some((s) => s.uid === f.uid)) return false;
      if (f.zip && !routed.some((s) => s.zip === f.zip)) return false;
    }
    if (q) {
      const hay = `${m.text} ${m.reason || ""} ${m.coreIdea || ""} ${m.bctName} ${m.promptType || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function filterSends(sends, f) {
  const q = f.q.trim().toLowerCase();
  return sends.filter((s) => {
    if (f.uid && s.uid !== f.uid) return false;
    if (f.zip && s.zip !== f.zip) return false;
    if (f.bctUri && s.bctUri !== f.bctUri) return false;
    if (f.runId && s.runId !== f.runId) return false;
    // sends only ever come from agentic runs, so a DB-batch filter excludes all
    if (f.batchKey) return false;
    if (q && !`${s.messageText} ${s.uid}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Hook that applies the shared filters and memoises the result. */
export function useFiltered(data, filters) {
  return useMemo(() => {
    if (!data) return null;
    const sendsByMessageKey = {};
    for (const s of data.sends) (sendsByMessageKey[s.messageId] = sendsByMessageKey[s.messageId] || []).push(s);

    const messages = filterMessages(data.messages, filters, sendsByMessageKey);
    const sends = filterSends(data.sends, filters);
    const users = data.users.filter(
      (u) => (!filters.uid || u.uid === filters.uid) && (!filters.zip || u.zip === filters.zip)
    );
    return { messages, sends, users, sendsByMessageKey };
  }, [data, filters]);
}

// Aggregations
export function summarize(messages, sends, users) {
  const agentic = messages.filter((m) => m.source === "agentic");
  const accepted = agentic.filter((m) => m.status === "accepted").length;
  const rejected = agentic.filter((m) => m.status === "rejected").length;
  return {
    total: messages.length,
    db: messages.length - agentic.length,
    agentic: agentic.length,
    accepted,
    rejected,
    acceptanceRate: agentic.length ? +((accepted / agentic.length) * 100).toFixed(1) : null,
    bctsUsed: new Set(messages.map((m) => m.bctUri).filter(Boolean)).size,
    batches: new Set(messages.map((m) => m.batchKey)).size,
    sends: sends.length,
    delivered: sends.filter((s) => s.deliveryStatus === "delivered").length,
    failedSends: sends.filter((s) => s.deliveryStatus === "failed").length,
    usersReached: new Set(sends.map((s) => s.uid)).size,
    usersTotal: users.length,
    uniqueSent: new Set(sends.map((s) => s.messageId)).size,
  };
}

// Rejections per gate. Keys come from the messages, so a gate added in a
// later run is never dropped.
export function gateFailures(messages) {
  const counts = {};
  for (const m of messages) for (const g of m.failedGates || []) counts[g] = (counts[g] || 0) + 1;
  return orderGates(Object.keys(counts))
    .map((k) => ({ key: k, label: gateLabel(k), value: counts[k] }))
    .sort((a, b) => b.value - a.value);
}

/** Message counts per BCT. */
export function bctCounts(messages) {
  const counts = {};
  for (const m of messages) {
    const k = m.bctUri || "untagged";
    counts[k] = counts[k] || { key: k, label: m.bctName, value: 0, color: m.color };
    counts[k].value++;
  }
  return Object.values(counts).sort((a, b) => b.value - a.value);
}

/** BCT x participant matrix of send counts. */
export function bctUserMatrix(sends, users, bcts) {
  const cells = {};
  for (const s of sends) cells[`${s.bctUri}|${s.uid}`] = (cells[`${s.bctUri}|${s.uid}`] || 0) + 1;
  const rows = bcts.map((b) => {
    const cs = users.map((u) => ({ user: u, count: cells[`${b.uri}|${u.uid}`] || 0 }));
    return { bct: b, cells: cs, total: cs.reduce((a, c) => a + c.count, 0) };
  });
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.count)));
  return { rows, users, max };
}

/** Generic matrix: BCT rows x an arbitrary DB column (prompt variant / model). */
export function bctByColumn(messages, columnOf, bcts) {
  const colKeys = [...new Set(messages.map(columnOf).filter(Boolean))].sort();
  const cells = {};
  for (const m of messages) {
    const c = columnOf(m);
    if (!c || !m.bctUri) continue;
    cells[`${m.bctUri}|${c}`] = (cells[`${m.bctUri}|${c}`] || 0) + 1;
  }
  const rows = bcts.map((b) => ({
    bct: b,
    cells: colKeys.map((c) => ({ col: c, count: cells[`${b.uri}|${c}`] || 0 })),
  }));
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.count)));
  return { rows, colKeys, max };
}

/** Daily counts, for the volume-over-time line. */
export function countsByDate(items, dates, dateOf = (x) => x.date) {
  const counts = Object.fromEntries(dates.map((d) => [d, 0]));
  for (const it of items) {
    const d = dateOf(it);
    if (counts[d] !== undefined) counts[d]++;
  }
  return dates.map((date) => ({ x: date, y: counts[date] }));
}

/** Distribution of a 1-5 judge score across messages. */
export function scoreDistribution(messages, dimKey) {
  const buckets = [1, 2, 3, 4, 5].map((v) => ({ label: String(v), count: 0 }));
  for (const m of messages) {
    const v = m.scores?.[dimKey];
    if (v == null) continue;
    const b = Math.min(5, Math.max(1, Math.round(v)));
    buckets[b - 1].count++;
  }
  return buckets;
}
