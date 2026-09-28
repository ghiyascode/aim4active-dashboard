// What the generation loop did: yield per run, which gate rejected most, the
// settings that differed between runs, and the judge score distributions.

import { useState } from "react";
import { ChartCard, StatTile, HBars, AcceptRejectBars, ScoreBars, fmt } from "../charts";
import { SimpleTable } from "./Overview";
import { gateLabel, orderGates, SCORE_DIMS, scoreDistribution } from "../data";
import { STATUS } from "../palette";

export default function Pipeline({ data, filtered, set }) {
  const [openRun, setOpenRun] = useState(null);
  const runs = data.runs;
  const dbMessages = filtered.messages.filter((m) => m.source === "db");

  const totalCycles = runs.reduce((a, r) => a + (r.totalCycles || 0), 0);
  const totalAccepted = runs.reduce((a, r) => a + (r.accepted || 0), 0);
  const totalRejected = runs.reduce((a, r) => a + (r.rejected || 0), 0);
  const saturated = runs.filter((r) => (r.stopReason || "").includes("saturation")).length;

  const runBars = runs.map((r) => ({
    key: r.id,
    label: `${r.devCycle.replace("dev_cycle_", "c")} / ${r.label}`,
    accepted: r.accepted || 0,
    rejected: r.rejected || 0,
  }));

  // Gate failures aggregated straight from the run summaries (authoritative).
  // Gate keys come from the summaries themselves: runs added `style`
  // partway through, and a hardcoded list would silently drop it.
  const gateKeys = orderGates(runs.flatMap((r) => Object.keys(r.rejectionsByCritic || {})));
  const gateTotals = gateKeys
    .map((k) => ({
      key: k,
      label: gateLabel(k),
      value: runs.reduce((a, r) => a + (r.rejectionsByCritic?.[k] || 0), 0),
    }))
    .sort((a, b) => b.value - a.value);

  const run = openRun && runs.find((r) => r.id === openRun);

  return (
    <>
      <dl className="a4a-tiles">
        <StatTile label="Agentic runs" value={fmt(runs.length)} hint={`${new Set(runs.map((r) => r.devCycle)).size} dev cycles`} />
        <StatTile label="Generation cycles" value={fmt(totalCycles)} hint="candidates the loop produced" />
        <StatTile label="Accepted" value={fmt(totalAccepted)} tone="good" hint={`${((totalAccepted / (totalAccepted + totalRejected)) * 100).toFixed(1)}% overall`} />
        <StatTile label="Rejected" value={fmt(totalRejected)} tone="critical" hint="every one with a reason" />
        <StatTile label="Stopped on saturation" value={`${saturated}/${runs.length}`} hint="hit the rejection streak cap" tone={saturated > runs.length / 2 ? "warning" : undefined} />
        <StatTile label="Prompt variants" value={fmt(data.prompts.length)} hint="in the generation DB" />
        <StatTile label="Writer configs" value={fmt(data.writers.filter((w) => w.model).length)} hint="model + sampling combos" />
        <StatTile label="Judge models" value={fmt(new Set(dbMessages.flatMap((m) => m.scoreRows.map((r) => r.model))).size)} hint="scoring each message" />
      </dl>

      <div className="a4a-grid cols-2">
        <ChartCard
          title="Yield per run"
          subtitle="Most runs saturate — the loop stops after a long rejection streak, not on reaching its target."
          source="real"
          table={<SimpleTable head={["Run", "Cycles", "Accepted", "Rejected", "Rate"]} rows={runs.map((r) => [`${r.devCycle}/${r.label}`, fmt(r.totalCycles), fmt(r.accepted), fmt(r.rejected), `${r.acceptanceRatePct}%`])} />}
        >
          <AcceptRejectBars data={runBars} />
        </ChartCard>

        <ChartCard
          title="Where candidates die"
          subtitle="Summed across all 16 runs, from each run's summary.json."
          source="real"
          table={<SimpleTable head={["Gate", "Rejections"]} rows={gateTotals.map((g) => [g.label, fmt(g.value)])} />}
        >
          <HBars data={gateTotals} />
          <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, marginBottom: 0 }}>
            One bar, one measure — a gate is a category, not a magnitude, so no value ramp here.
          </p>
        </ChartCard>
      </div>

      <div style={{ marginTop: 14 }}>
        <ChartCard
          title="Run configurations"
          subtitle="What actually changed between runs. Click a run to see its gate breakdown."
          source="real"
        >
          <div className="a4a-table-wrap">
            <table className="a4a-table">
              <thead>
                <tr>
                  <th>Dev cycle</th><th>Run</th><th>Target BCT</th>
                  <th>Generator</th><th>Diversity</th>
                  <th className="num">Cycles</th><th className="num">Rate</th><th>Stopped because</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={`a4a-row-click ${openRun === r.id ? "selected" : ""}`}
                    onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                  >
                    <td>{r.devCycle}</td>
                    <td><b>{r.label}</b></td>
                    <td>
                      {r.targetBctName || r.targetBct}
                      {r.bctInferred && <span className="a4a-chip" style={{ marginLeft: 6 }}>inferred</span>}
                    </td>
                    <td className="a4a-mono" style={{ fontSize: 11 }}>{r.generatorModel || "—"}</td>
                    <td>{r.diversityPromptVersion || "—"}</td>
                    <td className="num">{fmt(r.totalCycles)}</td>
                    <td className="num">{r.acceptanceRatePct}%</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{r.stopReason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>

      {run && <RunDetail run={run} data={data} set={set} onClose={() => setOpenRun(null)} />}

      <h2 style={{ fontSize: 15, margin: "24px 0 4px", letterSpacing: "-0.01em" }}>Judge scores</h2>
      <p style={{ margin: "0 0 12px", color: "var(--ink-2)", fontSize: 13, maxWidth: "76ch" }}>
        The other evaluation track: every message in the generation DB is scored 1–5 on seven
        dimensions by up to three evaluator models. {fmt(dbMessages.length)} messages in scope.
      </p>
      <div className="a4a-grid cols-3">
        {SCORE_DIMS.map((d) => {
          const buckets = scoreDistribution(dbMessages, d.key);
          const n = buckets.reduce((a, b) => a + b.count, 0);
          const mean = n ? buckets.reduce((a, b, i) => a + b.count * (i + 1), 0) / n : null;
          return (
            <ChartCard
              key={d.key}
              title={d.name}
              subtitle={mean ? `mean ${mean.toFixed(2)} · n=${fmt(n)}` : "no scores in scope"}
              source="real"
              table={<SimpleTable head={["Score", "Messages"]} rows={buckets.map((b) => [b.label, fmt(b.count)])} />}
            >
              {n ? <ScoreBars buckets={buckets} /> : <div className="a4a-empty">No scored messages in scope.</div>}
            </ChartCard>
          );
        })}
      </div>
    </>
  );
}

function RunDetail({ run, data, set, onClose }) {
  const gates = orderGates([
    ...Object.keys(run.rejectionsByCritic || {}),
    ...Object.keys(run.failureGates || {}),
  ])
    .map((k) => ({
      key: k,
      label: gateLabel(k),
      rejections: run.rejectionsByCritic?.[k] || 0,
      gateFailures: run.failureGates?.[k] || 0,
    }))
    .sort((a, b) => b.rejections - a.rejections);

  return (
    <div style={{ marginTop: 14 }}>
      <div className="a4a-grid cols-2">
        <ChartCard
          title={`${run.devCycle} / ${run.label}`}
          subtitle={run.path}
          source="real"
          actions={
            <>
              <button className="a4a-toggle" onClick={() => set({ runId: run.id, batchKey: "" })}>Show its messages</button>
              <button className="a4a-toggle" onClick={onClose}>Close</button>
            </>
          }
        >
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", margin: 0, fontSize: 12.5 }}>
            <dt style={{ color: "var(--ink-3)" }}>Target BCT</dt><dd style={{ margin: 0 }}>{run.targetBctName || run.targetBct}</dd>
            <dt style={{ color: "var(--ink-3)" }}>Generator</dt><dd style={{ margin: 0 }} className="a4a-mono">{run.generatorModel || "—"}</dd>
            <dt style={{ color: "var(--ink-3)" }}>Critic</dt><dd style={{ margin: 0 }} className="a4a-mono">{run.criticModel || "—"}</dd>
            <dt style={{ color: "var(--ink-3)" }}>Diversity prompt</dt><dd style={{ margin: 0 }}>{run.diversityPromptVersion || "—"}</dd>
            <dt style={{ color: "var(--ink-3)" }}>Cycles</dt><dd style={{ margin: 0 }}>{fmt(run.totalCycles)}</dd>
            <dt style={{ color: "var(--ink-3)" }}>Accepted</dt>
            <dd style={{ margin: 0 }}>
              <span style={{ color: STATUS.good, fontWeight: 600 }}>{fmt(run.accepted)}</span> ({run.acceptanceRatePct}%)
            </dd>
            <dt style={{ color: "var(--ink-3)" }}>Stop reason</dt><dd style={{ margin: 0 }}>{run.stopReason || "—"}</dd>
            {run.maxRejectionStreak != null && (
              <>
                <dt style={{ color: "var(--ink-3)" }}>Streak cap</dt><dd style={{ margin: 0 }}>{run.maxRejectionStreak}</dd>
              </>
            )}
            {run.agentModes && (
              <>
                <dt style={{ color: "var(--ink-3)" }}>Agent modes</dt>
                <dd style={{ margin: 0 }}>
                  {Object.entries(run.agentModes).map(([k, v]) => (
                    <span className="a4a-chip" key={k} style={{ marginRight: 5 }}>{k}: {v}</span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </ChartCard>

        <ChartCard
          title="Gate breakdown for this run"
          subtitle="“Rejections” is the gate credited with the kill; “failures” counts every gate that failed, including secondary ones."
          source="real"
          table={<SimpleTable head={["Gate", "Rejections", "Total failures"]} rows={gates.map((g) => [g.label, fmt(g.rejections), fmt(g.gateFailures)])} />}
        >
          {gates.some((g) => g.rejections) ? (
            <HBars
              data={gates.map((g) => ({ key: g.key, label: g.label, value: g.rejections }))}
              tipContent={(d) => {
                const g = gates.find((x) => x.key === d.key);
                return (
                  <>
                    <b>{d.label}</b><br />
                    <span className="k">credited rejections</span> {fmt(g.rejections)}<br />
                    <span className="k">total gate failures</span> {fmt(g.gateFailures)}
                  </>
                );
              }}
            />
          ) : (
            <div className="a4a-empty">This run's summary records no per-gate rejections.</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
