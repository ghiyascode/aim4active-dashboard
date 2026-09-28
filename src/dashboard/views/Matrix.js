// BCT rows against a column dimension the reader picks: participant, prompt
// variant, writer config or run. Cells carry their count as well as a shade, so
// the value never depends on colour alone.

import { useState, useMemo } from "react";
import { ChartCard, useTooltip, fmt } from "../charts";
import { bctUserMatrix, bctByColumn } from "../data";
import { rampColor } from "../palette";

const MODES = [
  { key: "participant", label: "BCT × participant", source: null, blurb: "Messages routed to each participant, by technique." },
  { key: "prompt", label: "BCT × prompt variant", source: "real", blurb: "Which prompt template produced messages for each technique." },
  { key: "writer", label: "BCT × writer config", source: "real", blurb: "Which model + sampling configuration produced each technique." },
  { key: "run", label: "BCT × agentic run", source: "real", blurb: "Candidate volume per technique in each pipeline run." },
];

export default function Matrix({ data, filtered, set }) {
  const [mode, setMode] = useState("participant");
  const { show, hide, node } = useTooltip();
  const active = MODES.find((m) => m.key === mode);

  // Rows are the BCTs the study targets. Without the catalogue nothing is
  // marked targeted, so fall back to the most-used ones rather than drawing an
  // empty grid.
  const targeted = useMemo(() => {
    const flagged = data.bcts.filter((b) => b.targeted);
    return flagged.length ? flagged : data.bcts.slice(0, 8);
  }, [data.bcts]);

  const model = useMemo(() => {
    if (mode === "participant") {
      const m = bctUserMatrix(filtered.sends, filtered.users, targeted);
      return {
        rows: m.rows.map((r) => ({
          bct: r.bct,
          cells: r.cells.map((c) => ({ key: c.user.uid, label: c.user.uid, short: c.user.uid, count: c.count, meta: c.user })),
        })),
        cols: m.users.map((u) => ({ key: u.uid, label: u.uid })),
        max: m.max,
        onCell: (bct, col) => set({ bctUri: bct.uri, uid: col.key }),
      };
    }
    const columnOf =
      mode === "prompt" ? (m) => m.promptType
        : mode === "writer" ? (m) => (m.writerId != null ? `w${m.writerId} · ${m.temperature}/${m.topP}` : null)
        : (m) => (m.source === "agentic" ? m.batchLabel : null);

    const m = bctByColumn(filtered.messages, columnOf, targeted);
    return {
      rows: m.rows.map((r) => ({
        bct: r.bct,
        cells: r.cells.map((c) => ({ key: c.col, label: c.col, short: c.col, count: c.count })),
      })),
      cols: m.colKeys.map((c) => ({ key: c, label: c })),
      max: m.max,
      onCell: (bct) => set({ bctUri: bct.uri }),
    };
  }, [mode, filtered, targeted, set]);

  const tableTwin = (
    <table className="a4a-table">
      <thead>
        <tr>
          <th>BCT</th>
          {model.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((r) => (
          <tr key={r.bct.uri}>
            <td>{r.bct.name}</td>
            {r.cells.map((c) => <td key={c.key} className="num">{fmt(c.count)}</td>)}
            <td className="num"><b>{fmt(r.cells.reduce((a, c) => a + c.count, 0))}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="a4a-filters" style={{ position: "static", marginBottom: 14 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            className="a4a-toggle"
            aria-pressed={mode === m.key}
            onClick={() => setMode(m.key)}
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            {m.label}
          </button>
        ))}
        <span className="a4a-scope">{active.blurb}</span>
      </div>

      <ChartCard
        title={active.label}
        subtitle="Darker means more messages. Click a cell to filter the whole dashboard to it."
        source={active.key === "participant" && data.participantsAreMock ? "mock" : active.source}
        table={tableTwin}
      >
        {model.cols.length === 0 ? (
          <div className="a4a-empty">No columns in scope for this cut.</div>
        ) : (
          <div className="a4a-table-wrap">
            <table className="a4a-matrix">
              <thead>
                <tr>
                  <th />
                  {model.cols.map((c) => (
                    <th className="colhead" key={c.key} title={c.label}>
                      {c.label.length > 16 ? c.label.slice(0, 15) + "…" : c.label}
                    </th>
                  ))}
                  <th className="rowhead" style={{ writingMode: "initial" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {model.rows.map((r) => {
                  const total = r.cells.reduce((a, c) => a + c.count, 0);
                  return (
                    <tr key={r.bct.uri}>
                      <th className="rowhead">
                        <span className="a4a-status">
                          <span className="a4a-dot" style={{ background: r.bct.color }} />
                          {r.bct.name}
                        </span>
                      </th>
                      {r.cells.map((c) => (
                        <td key={c.key}>
                          <button
                            className={`a4a-cell ${c.count ? "" : "zero"}`}
                            style={{ background: rampColor(c.count / model.max) }}
                            onClick={() => model.onCell(r.bct, c)}
                            onMouseMove={(e) =>
                              show(e, (
                                <>
                                  <b>{r.bct.name}</b><br />
                                  <span className="k">{c.label}</span><br />
                                  {fmt(c.count)} message{c.count === 1 ? "" : "s"}
                                  <br /><span className="k">click to filter</span>
                                </>
                              ))
                            }
                            onMouseLeave={hide}
                          >
                            {c.count || ""}
                          </button>
                        </td>
                      ))}
                      <td style={{ paddingLeft: 8, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="a4a-legend">
          <span style={{ color: "var(--ink-3)" }}>0</span>
          {[0.15, 0.35, 0.55, 0.75, 1].map((t) => (
            <span key={t} style={{ width: 26, height: 12, borderRadius: 3, background: rampColor(t), display: "inline-block" }} />
          ))}
          <span style={{ color: "var(--ink-3)" }}>{fmt(model.max)} max</span>
        </div>
      </ChartCard>
      {node}
    </>
  );
}
