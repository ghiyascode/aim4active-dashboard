// BCT rows against a column dimension the reader picks, measuring either volume
// or quality. Cells carry their value as well as a shade, so nothing depends on
// colour alone.

import { useState, useMemo } from "react";
import { ChartCard, useTooltip, fmt } from "../charts";
import { bctUserMatrix, bctCrossTab, gateLabel, SCORE_DIMS } from "../data";
import { rampColor } from "../palette";

const COLUMNS = [
  { key: "run", label: "Run", blurb: "Volume and quality per technique in each pipeline run." },
  { key: "gate", label: "Failed check", blurb: "Which messages failed which check. A message failing several appears under each." },
  { key: "prompt", label: "Prompt variant", blurb: "Which prompt template produced messages for each technique." },
  { key: "writer", label: "Model config", blurb: "Which model and sampling settings produced each technique." },
  { key: "participant", label: "Participant", blurb: "Messages delivered to each participant, by technique." },
];

// Mean of the judge dimensions a message was actually scored on.
function judgeMean(m) {
  if (!m.scores) return null;
  const vals = SCORE_DIMS.map((d) => m.scores[d.key]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Coverage differs a lot between these: judge scores exist only for delivered
// messages, readability for most, sentiment for all. Cells report the sample
// size behind them so a thin average is never mistaken for a solid one.
const MEASURES = [
  { key: "count", label: "Messages", format: (v) => fmt(v), blurb: "how many messages" },
  { key: "judge", label: "Judge score", format: (v) => v.toFixed(2), blurb: "mean judge score, 1-5", of: judgeMean },
  { key: "ease", label: "Reading ease", format: (v) => v.toFixed(1), blurb: "mean Flesch reading ease", of: (m) => m.readingEase },
  { key: "sentiment", label: "Sentiment", format: (v) => v.toFixed(2), blurb: "mean sentiment, -1 to 1", of: (m) => m.sentiment },
];

export default function Matrix({ data, filtered, set }) {
  const [column, setColumn] = useState("run");
  const [measure, setMeasure] = useState("count");
  const { show, hide, node } = useTooltip();

  const col = COLUMNS.find((c) => c.key === column);
  const meas = MEASURES.find((m) => m.key === measure);

  // Participant cells come from the send log rather than the message table, so
  // they only support counting.
  const countOnly = column === "participant";
  const activeMeasure = countOnly ? MEASURES[0] : meas;

  const targeted = useMemo(() => {
    const flagged = data.bcts.filter((b) => b.targeted);
    return flagged.length ? flagged : data.bcts.slice(0, 8);
  }, [data.bcts]);

  const runLabel = useMemo(() => {
    const byId = {};
    for (const r of data.runs) byId[r.id] = `${r.devCycle} / ${r.label}`;
    return byId;
  }, [data.runs]);

  const model = useMemo(() => {
    if (column === "participant") {
      const m = bctUserMatrix(filtered.sends, filtered.users, targeted);
      return {
        rows: m.rows.map((r) => ({
          bct: r.bct,
          cells: r.cells.map((c) => ({ key: c.user.uid, label: c.user.uid, value: c.count, count: c.count, scored: c.count })),
        })),
        cols: m.users.map((u) => ({ key: u.uid, label: u.uid })),
        max: m.max,
        onCell: (bct, cell) => set({ bctUri: bct.uri, uid: cell.key }),
      };
    }

    const columnsOf =
      column === "prompt" ? (m) => m.promptType
        : column === "writer" ? (m) => (m.writerId != null ? `w${m.writerId} · ${m.temperature}/${m.topP}` : null)
        : column === "gate" ? (m) => m.failedGates || []
        : (m) => (m.runKey ? runLabel[m.runKey] || m.runKey : null);

    const m = bctCrossTab(filtered.messages, targeted, columnsOf, activeMeasure.of ?? "count");
    return {
      rows: m.rows.map((r) => ({
        bct: r.bct,
        cells: r.cells.map((c) => ({ key: c.col, label: c.col, value: c.value, count: c.count, scored: c.scored })),
      })),
      cols: m.colKeys.map((c) => ({ key: c, label: column === "gate" ? gateLabel(c) : c })),
      max: m.max,
      onCell: (bct) => set({ bctUri: bct.uri }),
    };
  }, [column, filtered, targeted, activeMeasure, runLabel, set]);

  const tableTwin = (
    <table className="a4a-table">
      <thead>
        <tr>
          <th>BCT</th>
          {model.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {model.rows.map((r) => (
          <tr key={r.bct.uri}>
            <td>{r.bct.name}</td>
            {r.cells.map((c) => (
              <td key={c.key} className="num">
                {c.value == null ? "—" : activeMeasure.format(c.value)}
                {activeMeasure.key !== "count" && c.scored > 0 && (
                  <span style={{ color: "var(--ink-3)" }}> (n={c.scored})</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const anyCells = model.cols.length > 0 && model.rows.some((r) => r.cells.some((c) => c.count > 0));

  return (
    <>
      <div className="a4a-filters" style={{ position: "static", marginBottom: 14, gap: 14 }}>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Columns
          <select value={column} onChange={(e) => setColumn(e.target.value)}>
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>

        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Showing
          <select value={measure} onChange={(e) => setMeasure(e.target.value)} disabled={countOnly}>
            {MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>

        <span className="a4a-scope">{col.blurb}</span>
      </div>

      <ChartCard
        title={`BCT × ${col.label}`}
        subtitle={
          activeMeasure.key === "count"
            ? "Darker means more messages. Click a cell to filter the dashboard to it."
            : `Each cell is the ${activeMeasure.blurb} for that combination, with the number of messages behind it.`
        }
        source={column === "participant" && data.participantsAreMock ? "mock" : undefined}
        table={tableTwin}
      >
        {!anyCells ? (
          <div className="a4a-empty">Nothing to show for this combination in the current scope.</div>
        ) : (
          <div className="a4a-table-wrap">
            <table className="a4a-matrix">
              <thead>
                <tr>
                  <th />
                  {model.cols.map((c) => (
                    <th className="colhead" key={c.key} title={c.label}>
                      {c.label.length > 18 ? c.label.slice(0, 17) + "…" : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((r) => (
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
                          className={`a4a-cell ${c.value ? "" : "zero"}`}
                          style={{ background: rampColor(c.value == null ? 0 : c.value / model.max) }}
                          onClick={() => model.onCell(r.bct, c)}
                          onMouseMove={(e) =>
                            show(e, (
                              <>
                                <b>{r.bct.name}</b><br />
                                <span className="k">{c.label}</span><br />
                                {c.value == null ? (
                                  <>not scored</>
                                ) : (
                                  <>
                                    <span className="k">{activeMeasure.label.toLowerCase()}</span>{" "}
                                    {activeMeasure.format(c.value)}
                                  </>
                                )}
                                <br />
                                <span className="k">messages</span> {fmt(c.count)}
                                {activeMeasure.key !== "count" && (
                                  <>
                                    <br /><span className="k">of those, scored</span> {fmt(c.scored)}
                                  </>
                                )}
                              </>
                            ))
                          }
                          onMouseLeave={hide}
                        >
                          {c.value == null ? "" : activeMeasure.format(c.value)}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="a4a-legend">
          <span style={{ color: "var(--ink-3)" }}>low</span>
          {[0.15, 0.35, 0.55, 0.75, 1].map((t) => (
            <span key={t} style={{ width: 26, height: 12, borderRadius: 3, background: rampColor(t), display: "inline-block" }} />
          ))}
          <span style={{ color: "var(--ink-3)" }}>
            {activeMeasure.format(model.max)} max
          </span>
          {activeMeasure.key === "judge" && (
            <span style={{ color: "var(--ink-3)" }}>
              · only delivered messages are judged, so cells are thin
            </span>
          )}
          {activeMeasure.key === "ease" && (
            <span style={{ color: "var(--ink-3)" }}>
              · higher is easier to read
            </span>
          )}
        </div>
      </ChartCard>
      {node}
    </>
  );
}
