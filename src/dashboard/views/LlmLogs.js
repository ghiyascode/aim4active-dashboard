// Every call the pipeline made to a language model, from llm_logs.db: what it
// was asked, what it produced, how it reasoned, and what it cost in time.
//
// The log is loaded on first visit. Filters here are local to this view; the
// message filter bar does not apply, because most calls are not a message.

import { useMemo, useState } from "react";
import { ChartCard } from "../charts";
import { useLlmLogs, stageLabel, STAGES, outcome } from "../llmLogs";
import { StageTag, Outcome, CallBody, formatTime, formatMs } from "./LlmCall";

const PAGE = 50;

export default function LlmLogs({ data }) {
  const { status, logs, error } = useLlmLogs(data);
  const meta = data.llmLogsMeta;

  if (status === "none") {
    return (
      <div className="a4a-card">
        <div className="a4a-empty">
          <p><b>No LLM log in this snapshot.</b></p>
          <p style={{ marginTop: 8 }}>
            Put an <span className="a4a-mono">llm_logs_*.db</span> beside the project (or set{" "}
            <span className="a4a-mono">A4A_LLM_LOGS</span>) and run{" "}
            <span className="a4a-mono">npm run snapshot</span>.
          </p>
        </div>
      </div>
    );
  }
  if (status === "loading") {
    return <div className="a4a-card"><div className="a4a-empty">Loading {meta.calls.toLocaleString()} LLM calls…</div></div>;
  }
  if (status === "error") {
    return <div className="a4a-card"><div className="a4a-empty"><p><b>Couldn't load the LLM log</b></p><p style={{ marginTop: 8 }}>{error}</p></div></div>;
  }
  return <LogBrowser logs={logs} meta={meta} />;
}

function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

function LogBrowser({ logs, meta }) {
  const [stage, setStage] = useState("");
  const [model, setModel] = useState("");
  const [result, setResult] = useState("");
  const [q, setQ] = useState("");
  const [inPrompts, setInPrompts] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);

  // gen call id -> database message id, to say which message a call belongs to
  const msgByGen = useMemo(() => {
    const out = {};
    for (const [msgId, genId] of Object.entries(logs.messages)) out[genId] = msgId;
    return out;
  }, [logs]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.calls.filter((c) => {
      if (stage && c.stage !== stage) return false;
      if (model && c.model !== model) return false;
      if (result) {
        const o = outcome(c);
        if (result === "error" ? o !== "error" : result === "fail" ? o !== "fail" : o === "error") return false;
      }
      if (needle) {
        const hay = [c.output, c.reasoning, c.reason, c.error, inPrompts ? c.prompt : null].filter(Boolean).join("\n").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [logs, stage, model, result, q, inPrompts]);

  const stats = useMemo(() => {
    const byStage = {};
    for (const c of rows) {
      const s = (byStage[c.stage] ??= { n: 0, errors: 0, latency: [] });
      s.n++;
      if (c.error) s.errors++;
      s.latency.push(c.latencyMs);
    }
    return Object.entries(byStage)
      .map(([k, s]) => ({ stage: k, n: s.n, errors: s.errors, median: median(s.latency) }))
      .sort((a, b) => Object.keys(STAGES).indexOf(a.stage) - Object.keys(STAGES).indexOf(b.stage));
  }, [rows]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = rows.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const current = selected != null ? logs.calls.find((c) => c.id === selected) : null;
  const reset = (fn) => (v) => { fn(v); setPage(0); };

  return (
    <>
      <div className="a4a-filters">
        <input
          type="search"
          placeholder="Search outputs, reasoning and errors…"
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          aria-label="Search LLM calls"
        />
        <label>
          Stage
          <select value={stage} onChange={(e) => reset(setStage)(e.target.value)}>
            <option value="">All stages</option>
            {Object.keys(meta.byStage || {}).map((s) => (
              <option key={s} value={s}>{stageLabel(s)} ({meta.byStage[s].toLocaleString()})</option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select value={model} onChange={(e) => reset(setModel)(e.target.value)}>
            <option value="">All models</option>
            {logs.models.map((m) => <option key={m} value={m}>{m.replace(/^unsloth\//, "")}</option>)}
          </select>
        </label>
        <label>
          Result
          <select value={result} onChange={(e) => reset(setResult)(e.target.value)}>
            <option value="">Any</option>
            <option value="ok">Completed</option>
            <option value="fail">Failed a check</option>
            <option value="error">Errored</option>
          </select>
        </label>
        <label className="a4a-check">
          <input type="checkbox" checked={inPrompts} onChange={(e) => reset(setInPrompts)(e.target.checked)} />
          search prompts too
        </label>
        <span className="a4a-scope">
          {rows.length.toLocaleString()} of {logs.calls.length.toLocaleString()} calls · {meta.source}
        </span>
      </div>

      <div className="a4a-llm-stats">
        {stats.map((s) => (
          <div key={s.stage} className="a4a-llm-stat">
            <StageTag stage={s.stage} />
            <b>{s.n.toLocaleString()}</b>
            <span>median {formatMs(s.median)}{s.errors ? ` · ${s.errors} errored` : ""}</span>
          </div>
        ))}
      </div>

      <div className="a4a-grid" style={{ gridTemplateColumns: current ? "1.3fr 1fr" : "1fr", alignItems: "start" }}>
        <ChartCard
          title={`${rows.length.toLocaleString()} LLM calls`}
          subtitle={`${formatTime(meta.first)} to ${formatTime(meta.last)}. Click a call for its output, reasoning and prompt.`}
        >
          {rows.length === 0 ? (
            <div className="a4a-empty">No calls match.</div>
          ) : (
            <>
              <div className="a4a-table-wrap">
                <table className="a4a-table">
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      <th>Stage</th>
                      <th>Result</th>
                      <th>Output</th>
                      <th>Message</th>
                      <th className="num">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((c) => (
                      <tr
                        key={c.id}
                        className={`a4a-row-click ${selected === c.id ? "selected" : ""}`}
                        onClick={() => setSelected(selected === c.id ? null : c.id)}
                      >
                        <td className="a4a-mono" style={{ whiteSpace: "nowrap" }}>{c.at?.slice(5, 19).replace("T", " ")}</td>
                        <td><StageTag stage={c.stage} /></td>
                        <td><Outcome call={c} /></td>
                        <td className="msg a4a-llm-preview">{preview(c)}</td>
                        <td className="a4a-mono" style={{ color: "var(--ink-2)" }}>
                          {c.candidate != null && msgByGen[c.candidate] ? `#${msgByGen[c.candidate]}` : "—"}
                        </td>
                        <td className="num">{formatMs(c.latencyMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="a4a-pager">
                <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</button>
                <span>Page {safePage + 1} of {pages.toLocaleString()}</span>
                <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Next →</button>
              </div>
            </>
          )}
        </ChartCard>

        {current && (
          <section className="a4a-card a4a-detail">
            <header>
              <div>
                <h3>{stageLabel(current.stage)} call #{current.id}</h3>
                <p className="a4a-mono">{current.model} · {formatTime(current.at)}</p>
              </div>
              <div className="a4a-card-actions">
                <button className="a4a-toggle" onClick={() => setSelected(null)}>Close</button>
              </div>
            </header>
            {current.candidate != null && msgByGen[current.candidate] && (
              <p style={{ fontSize: 12, color: "var(--ink-2)", margin: "0 0 10px" }}>
                About database message <span className="a4a-mono">#{msgByGen[current.candidate]}</span>. Open it in
                Messages to see its full generation history.
              </p>
            )}
            <CallBody call={current} />
          </section>
        )}
      </div>
    </>
  );
}

function preview(c) {
  if (c.error) return <span style={{ color: "var(--critical)" }}>{c.error.split("\n")[0].slice(0, 160)}</span>;
  if (c.stage === "generate") return c.output || "—";
  return c.reason || (c.output || "").slice(0, 200) || "—";
}
