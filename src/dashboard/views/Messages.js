// Searchable table of every message, with a detail panel showing the gate-by-gate
// verdict, the generation settings and the participant it went to.

import { useState, useMemo } from "react";
import { ChartCard } from "../charts";
import { gateLabel, SCORE_DIMS } from "../data";
import { STATUS } from "../palette";

const PAGE = 40;

export default function Messages({ data, filtered, filters, set }) {
  const { messages, sendsByMessageKey } = filtered;
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ col: "default", dir: "asc" });

  const sorted = useMemo(() => {
    const rows = [...messages];
    const { col, dir } = sort;
    if (col !== "default") {
      const mul = dir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * mul;
      });
    }
    return rows;
  }, [messages, sort]);

  const pageRows = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(sorted.length / PAGE);
  const current = selected && messages.find((m) => m.key === selected);

  const th = (col, label, extra) => (
    <th
      className={`sortable ${extra || ""}`}
      onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }))}
    >
      {label}{sort.col === col ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="a4a-grid" style={{ gridTemplateColumns: current ? "1.55fr 1fr" : "1fr", alignItems: "start" }}>
      <ChartCard
        title={`${messages.length.toLocaleString()} messages in scope`}
        subtitle="Click any row for its full evaluation history. Search and filters apply from the bar above."
        source="real"
        actions={
          filters.q ? (
            <span className="a4a-chip">
              matching “{filters.q}”
            </span>
          ) : null
        }
      >
        {messages.length === 0 ? (
          <div className="a4a-empty">Nothing matches the current filters.</div>
        ) : (
          <>
            <div className="a4a-table-wrap">
              <table className="a4a-table">
                <thead>
                  <tr>
                    {th("status", "Verdict")}
                    {th("bctName", "BCT")}
                    {th("text", "Message")}
                    {th("batchLabel", "From")}
                    {th("cycle", "Cycle", "num")}
                    <th className="num">Sent to</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((m) => {
                    const routed = sendsByMessageKey[m.key] || [];
                    return (
                      <tr
                        key={m.key}
                        className={`a4a-row-click ${selected === m.key ? "selected" : ""}`}
                        onClick={() => setSelected(m.key === selected ? null : m.key)}
                      >
                        <td><Verdict m={m} /></td>
                        <td>
                          <span className="a4a-status">
                            <span className="a4a-dot" style={{ background: m.color }} />
                            {m.bctName}
                          </span>
                        </td>
                        <td className="msg">{m.text}</td>
                        <td style={{ color: "var(--ink-2)", fontSize: 11.5 }}>{m.batchLabel}</td>
                        <td className="num">{m.cycle ?? "—"}</td>
                        {/* A message is generated for, and sent to, exactly one
                            participant — so this is a single UID, never a count. */}
                        <td className="num a4a-mono">
                          {routed.length ? routed[0].uid : <span style={{ color: "var(--ink-3)" }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="a4a-pager">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span>Page {page + 1} of {pages.toLocaleString()}</span>
              <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
              <span style={{ marginLeft: "auto" }}>
                showing {(page * PAGE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE, sorted.length).toLocaleString()}
              </span>
            </div>
          </>
        )}
      </ChartCard>

      {current && <Detail m={current} routed={sendsByMessageKey[current.key] || []} data={data} set={set} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Verdict({ m }) {
  if (m.status === "accepted") return <span className="a4a-status"><span className="a4a-dot" style={{ background: STATUS.good }} /><b>Accepted</b></span>;
  if (m.status === "rejected") return <span className="a4a-status"><span className="a4a-dot" style={{ background: STATUS.critical }} /><b>Rejected</b></span>;
  return <span className="a4a-status"><span className="a4a-dot" style={{ background: "var(--ink-3)" }} />Scored</span>;
}

function Detail({ m, routed, data, set, onClose }) {
  return (
    <section className="a4a-card a4a-detail">
      <header>
        <div>
          <h3>Message detail</h3>
          <p className="a4a-mono">{m.rawId}</p>
        </div>
        <div className="a4a-card-actions">
          <button className="a4a-toggle" onClick={onClose}>Close</button>
        </div>
      </header>

      <p className="a4a-quote" style={{ borderLeftColor: m.color }}>{m.text}</p>

      <dl>
        <dt>Verdict</dt><dd><Verdict m={m} /></dd>
        <dt>BCT</dt>
        <dd>
          <span className="a4a-status"><span className="a4a-dot" style={{ background: m.color }} />{m.bctName}</span>
          {m.bctUri && <div className="a4a-mono" style={{ color: "var(--ink-3)" }}>{m.bctUri}</div>}
        </dd>
        <dt>From</dt>
        <dd>
          {m.batchLabel}{" "}
          <button className="a4a-toggle" onClick={() => set(m.source === "db" ? { batchKey: m.batchKey, runId: "" } : { runId: m.batchKey, batchKey: "" })}>show all</button>
        </dd>
        <dt>Source</dt><dd>{m.source === "db" ? "Generation DB" : "Agentic run"}</dd>
        {m.cycle != null && <><dt>Iteration</dt><dd>cycle {m.cycle} · index {m.idx}</dd></>}
        {m.coreIdea && <><dt>Core idea</dt><dd>{m.coreIdea}</dd></>}
        {m.model && <><dt>Generator</dt><dd className="a4a-mono">{m.model}</dd></>}
        {m.promptType && <><dt>Prompt</dt><dd className="a4a-mono">{m.promptType}</dd></>}
        {m.temperature != null && (
          <>
            <dt>Sampling</dt>
            <dd className="a4a-mono">
              temp {m.temperature} · top_p {m.topP} · freq {m.freqPenalty} · pres {m.presPenalty}
            </dd>
          </>
        )}
        {m.createdAt && <><dt>Generated</dt><dd>{m.createdAt}</dd></>}
      </dl>

      {/* ---- what didn't pass, gate by gate ---- */}
      {m.gates && Object.keys(m.gates).length > 0 && (
        <>
          <h4 style={{ fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)" }}>
            Critic gates
          </h4>
          <div style={{ marginBottom: 16 }}>
            {Object.entries(m.gates).map(([g, e]) => (
              <div className="a4a-gate" key={g}>
                <span className="a4a-gate-name">
                  <span
                    className="a4a-dot"
                    style={{
                      background: e.passed === true ? STATUS.good : e.passed === false ? STATUS.critical : "var(--ink-3)",
                      marginRight: 6,
                      display: "inline-block",
                    }}
                  />
                  {gateLabel(g)}
                </span>
                <span className="a4a-gate-reason">
                  {e.passed === true ? "passed" : e.passed === false ? (e.reason || "failed") : "not evaluated"}
                  {e.mode && e.mode !== "metric" && e.mode !== "critic" && (
                    <span style={{ color: "var(--ink-3)" }}> · {e.mode}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {m.reason && m.status === "rejected" && (
        <>
          <h4 style={{ fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)" }}>
            Rejected by {gateLabel(m.critic)}
          </h4>
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "0 0 16px" }}>{m.reason}</p>
        </>
      )}

      {/* ---- judge scores (DB messages) ---- */}
      {m.scores && Object.values(m.scores).some((v) => v != null) && (
        <>
          <h4 style={{ fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)" }}>
            LLM judge scores (mean of {new Set(m.scoreRows.map((r) => r.model)).size} evaluators)
          </h4>
          <table className="a4a-table" style={{ marginBottom: 16 }}>
            <tbody>
              {SCORE_DIMS.map((d) => (
                <tr key={d.key}>
                  <td>{d.name}</td>
                  <td className="num">{m.scores[d.key] ?? "—"}<span style={{ color: "var(--ink-3)" }}> / 5</span></td>
                </tr>
              ))}
              <tr>
                <td>Readability (F-K grade)</td>
                <td className="num">{m.fkGrade ?? "—"}</td>
              </tr>
              <tr>
                <td>Sentiment</td>
                <td className="num">{m.sentiment ?? "—"}</td>
              </tr>
              <tr>
                <td>Length</td>
                <td className="num">{m.words ?? "—"} words · {m.tokens ?? "—"} tok</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* ---- which participant it went to ---- */}
      <h4 style={{ fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)" }}>
        Delivered to <span className="a4a-source-mock">(mock)</span>
      </h4>
      {/* One message goes to exactly one participant, so this is a single
          record — not a list. routed[0] is the only possible entry. */}
      {routed.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: 0 }}>
          Not sent to a participant. In production this comes from
          <span className="a4a-mono"> DELIVERED_MESSAGES</span>.
        </p>
      ) : (
        <dl>
          <dt>Participant</dt>
          <dd>
            <button className="a4a-toggle a4a-mono" onClick={() => set({ uid: routed[0].uid })}>
              {routed[0].uid}
            </button>
          </dd>
          <dt>Sent</dt>
          <dd className="a4a-mono">{routed[0].sentAt}</dd>
          <dt>Steps that day</dt>
          <dd>{routed[0].stepsSameDay?.toLocaleString() ?? "—"}</dd>
          <dt>Status</dt>
          <dd>
            <span className="a4a-status">
              <span className="a4a-dot" style={{
                background: routed[0].deliveryStatus === "delivered" ? STATUS.good
                  : routed[0].deliveryStatus === "failed" ? STATUS.critical : STATUS.warning,
              }} />
              {routed[0].deliveryStatus}
            </span>
          </dd>
        </dl>
      )}
    </section>
  );
}
