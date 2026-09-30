// The flat table behind every other view: one row per message, sortable and
// exportable. Column presets pick which slice of the join is on screen.

import { useState, useMemo } from "react";
import { ChartCard, StatTile, fmt } from "../charts";
import { SCORE_DIMS } from "../data";


const PRESETS = {
  core: {
    label: "Core",
    cols: ["source", "status", "bctName", "text", "batchLabel", "cycle", "sentTo"],
  },
  generation: {
    label: "Generation config",
    cols: ["source", "bctName", "text", "batchLabel", "promptType", "model", "temperature", "topP", "freqPenalty", "presPenalty", "tokens"],
  },
  evaluation: {
    label: "Evaluation",
    cols: ["status", "bctName", "text", "critic", "reason", "fkGrade", "readingEase", "sentiment", "words", "chars", ...SCORE_DIMS.map((d) => `score_${d.key}`)],
  },
  delivery: {
    label: "Delivery (mock)",
    cols: ["bctName", "text", "sentTo", "sendCount", "delivered", "avgStepsSameDay"],
  },
};

const HEADERS = {
  source: "Source", status: "Verdict", bctName: "BCT", text: "Message", batchLabel: "From",
  cycle: "Cycle", sentTo: "Sent to", promptType: "Prompt", model: "Model", temperature: "Temp",
  topP: "top_p", freqPenalty: "freq", presPenalty: "pres", tokens: "Tokens", critic: "Killed by",
  reason: "Reason", fkGrade: "F-K grade", readingEase: "Reading ease",
  sentiment: "Sentiment", words: "Words", chars: "Chars",
  sendCount: "Sends", delivered: "Delivered", avgStepsSameDay: "Avg steps",
  ...Object.fromEntries(SCORE_DIMS.map((d) => [`score_${d.key}`, d.name])),
};

const NUMERIC = new Set([
  "cycle", "temperature", "topP", "freqPenalty", "presPenalty", "tokens", "fkGrade",
  "sentiment", "words", "chars", "readingEase", "sendCount", "delivered", "avgStepsSameDay",
  ...SCORE_DIMS.map((d) => `score_${d.key}`),
]);

const PAGE = 60;

export default function RawData({ filtered }) {
  const [preset, setPreset] = useState("core");
  const [sort, setSort] = useState({ col: null, dir: "asc" });
  const [page, setPage] = useState(0);

  const cols = PRESETS[preset].cols;

  /** Flatten every in-scope message into one denormalised row. */
  const rows = useMemo(() => {
    const { messages, sendsByMessageKey } = filtered;
    return messages.map((m) => {
      const routed = sendsByMessageKey[m.key] || [];
      const steps = routed.map((s) => s.stepsSameDay).filter((v) => v != null);
      const row = {
        _key: m.key,
        source: m.source === "db" ? "DB" : "agentic",
        status: m.status,
        bctName: m.bctName,
        bctUri: m.bctUri,
        text: m.text,
        batchLabel: m.batchLabel,
        cycle: m.cycle,
        sentTo: routed.length ? routed[0].uid : "",
        sendCount: routed.length,
        delivered: routed.filter((s) => s.deliveryStatus === "delivered").length,
        avgStepsSameDay: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null,
        promptType: m.promptType,
        model: m.model,
        temperature: m.temperature,
        topP: m.topP,
        freqPenalty: m.freqPenalty,
        presPenalty: m.presPenalty,
        tokens: m.tokens,
        critic: m.critic,
        reason: m.reason,
        fkGrade: m.fkGrade,
        readingEase: m.readingEase,
        sentiment: m.sentiment,
        words: m.words,
        chars: m.chars,
      };
      for (const d of SCORE_DIMS) row[`score_${d.key}`] = m.scores?.[d.key] ?? null;
      return row;
    });
  }, [filtered]);

  const sorted = useMemo(() => {
    if (!sort.col) return rows;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.col], bv = b[sort.col];
      if (av == null && bv == null) return 0;
      if (av == null || av === "") return 1;
      if (bv == null || bv === "") return -1;
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))) * mul;
    });
  }, [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const pageRows = sorted.slice(page * PAGE, page * PAGE + PAGE);

  const exportCsv = () => {
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => HEADERS[c] || c).join(","), ...sorted.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `aim4active-${preset}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // quick descriptive stats over whatever numeric columns are showing
  const stats = useMemo(() => {
    const out = [];
    for (const c of cols) {
      if (!NUMERIC.has(c)) continue;
      const vals = rows.map((r) => r[c]).filter((v) => typeof v === "number");
      if (vals.length < 2) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      out.push({
        col: c,
        label: HEADERS[c] || c,
        n: vals.length,
        mean: +mean.toFixed(2),
        min: Math.min(...vals),
        max: Math.max(...vals),
      });
    }
    return out;
  }, [cols, rows]);

  return (
    <>
      <dl className="a4a-tiles">
        <StatTile label="Rows in scope" value={fmt(rows.length)} hint="one row per message" />
        <StatTile label="Columns" value={fmt(cols.length)} hint={PRESETS[preset].label.toLowerCase()} />
        <StatTile label="From DB" value={fmt(rows.filter((r) => r.source === "DB").length)} />
        <StatTile label="From agentic runs" value={fmt(rows.filter((r) => r.source === "agentic").length)} />
      </dl>

      <ChartCard
        title="Flat message table"
        subtitle="Every filter above applies. Click a header to sort; export what you see."
        actions={
          <>
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} className="a4a-toggle" aria-pressed={preset === k} onClick={() => { setPreset(k); setPage(0); }}>
                {p.label}
              </button>
            ))}
            <button className="a4a-toggle" onClick={exportCsv}>Export CSV</button>
          </>
        }
      >
        {rows.length === 0 ? (
          <div className="a4a-empty">Nothing matches the current filters.</div>
        ) : (
          <>
            <div className="a4a-table-wrap" style={{ maxHeight: "62vh", overflowY: "auto" }}>
              <table className="a4a-table">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th
                        key={c}
                        className={`sortable ${NUMERIC.has(c) ? "num" : ""}`}
                        onClick={() => setSort((s) => ({ col: c, dir: s.col === c && s.dir === "asc" ? "desc" : "asc" }))}
                      >
                        {HEADERS[c] || c}{sort.col === c ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r._key}>
                      {cols.map((c) => (
                        <td key={c} className={NUMERIC.has(c) ? "num" : c === "text" || c === "reason" ? "msg" : undefined}>
                          {r[c] == null || r[c] === "" ? <span style={{ color: "var(--ink-3)" }}>—</span> : typeof r[c] === "number" ? r[c].toLocaleString() : r[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="a4a-pager">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span>Page {page + 1} of {pages.toLocaleString()}</span>
              <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
              <span style={{ marginLeft: "auto" }}>{fmt(sorted.length)} rows</span>
            </div>
          </>
        )}
      </ChartCard>

      {stats.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <ChartCard title="Descriptive statistics" subtitle="Over the numeric columns currently shown, across all rows in scope." source="real">
            <div className="a4a-table-wrap">
              <table className="a4a-table">
                <thead>
                  <tr><th>Column</th><th className="num">n</th><th className="num">Mean</th><th className="num">Min</th><th className="num">Max</th></tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.col}>
                      <td>{s.label}</td>
                      <td className="num">{fmt(s.n)}</td>
                      <td className="num">{s.mean.toLocaleString()}</td>
                      <td className="num">{s.min.toLocaleString()}</td>
                      <td className="num">{s.max.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      )}
    </>
  );
}
