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
  const scoredCount = dbMessages.filter((m) => m.scores && Object.values(m.scores).some((v) => v != null)).length;

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

  // Folder-based runs carry fields the database ones do not; hide empty columns.
  const showBct = runs.some((r) => r.targetBctName || r.targetBct);
  const showDiversity = runs.some((r) => r.diversityPromptVersion);
  const showStop = runs.some((r) => r.stopReason);

  const run = openRun && runs.find((r) => r.id === openRun);

  return (
    <>
      <dl className="a4a-tiles">
        <StatTile label="Runs" value={fmt(runs.length)} hint={`${new Set(runs.map((r) => r.devCycle)).size} source${new Set(runs.map((r) => r.devCycle)).size === 1 ? "" : "s"}`} />
        <StatTile label="Generation cycles" value={fmt(totalCycles)} hint="candidates the loop produced" />
        <StatTile label="Accepted" value={fmt(totalAccepted)} tone="good" hint={`${((totalAccepted / (totalAccepted + totalRejected)) * 100).toFixed(1)}% overall`} />
        <StatTile label="Rejected" value={fmt(totalRejected)} tone="critical" hint="every one with a reason" />
        {runs.some((r) => r.stopReason) && (
          <StatTile label="Stopped on saturation" value={`${saturated}/${runs.length}`} hint="hit the rejection streak cap" tone={saturated > runs.length / 2 ? "warning" : undefined} />
        )}
        <StatTile label="Prompt variants" value={fmt(data.prompts.length)} hint="in the generation DB" />
        <StatTile label="Writer configs" value={fmt(data.writers.filter((w) => w.model).length)} hint="model + sampling combos" />
        <StatTile label="Judge models" value={fmt(new Set(dbMessages.flatMap((m) => m.scoreRows.map((r) => r.model))).size)} hint="scoring each message" />
      </dl>

      <div className="a4a-grid cols-2">
        <ChartCard
          title="Yield per run"
          subtitle="How many candidates each run produced, and how many survived review."
          table={<SimpleTable head={["Run", "Cycles", "Accepted", "Rejected", "Rate"]} rows={runs.map((r) => [`${r.devCycle}/${r.label}`, fmt(r.totalCycles), fmt(r.accepted), fmt(r.rejected), `${r.acceptanceRatePct}%`])} />}
        >
          <AcceptRejectBars data={runBars} />
        </ChartCard>

        <ChartCard
          title="Where candidates die"
          subtitle={`Summed across ${runs.length} run${runs.length === 1 ? "" : "s"}.`}
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
        >
          <div className="a4a-table-wrap">
            <table className="a4a-table">
              <thead>
                <tr>
                  <th>Source</th><th>Run</th>
                  {showBct && <th>Target BCT</th>}
                  <th>Generator</th>
                  {showDiversity && <th>Diversity</th>}
                  <th className="num">Cycles</th><th className="num">Rate</th>
                  {showStop && <th>Stopped because</th>}
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
                    {showBct && (
                      <td>
                        {r.targetBctName || r.targetBct || "—"}
                        {r.bctInferred && <span className="a4a-chip" style={{ marginLeft: 6 }}>inferred</span>}
                      </td>
                    )}
                    <td className="a4a-mono" style={{ fontSize: 11 }}>{r.generatorModel || "—"}</td>
                    {showDiversity && <td>{r.diversityPromptVersion || "—"}</td>}
                    <td className="num">{fmt(r.totalCycles)}</td>
                    <td className="num">{r.acceptanceRatePct == null ? "—" : `${r.acceptanceRatePct}%`}</td>
                    {showStop && <td style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{r.stopReason || "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>

      {run && <RunDetail run={run} data={data} set={set} onClose={() => setOpenRun(null)} />}

      <Quality messages={filtered.messages} bcts={data.bcts} />

      <h2 style={{ fontSize: 15, margin: "24px 0 4px", letterSpacing: "-0.01em" }}>Judge scores</h2>
      <p style={{ margin: "0 0 12px", color: "var(--ink-2)", fontSize: 13, maxWidth: "76ch" }}>
        Messages that were delivered get scored 1–5 on seven dimensions by the evaluator models.
        {" "}{fmt(scoredCount)} of {fmt(dbMessages.length)} messages in scope carry a score.
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

// Breakdown of messages by quality.
//
// Coverage is uneven and that matters more than the averages: judge scores and
// the Flesch-Kincaid grade only exist for delivered messages, reading ease for
// most, sentiment for all. Every figure is reported with the number of messages
// behind it rather than presented as if it described the whole population.
function Quality({ messages, bcts }) {
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const judgeMean = (m) => {
    const vals = SCORE_DIMS.map((d) => m.scores?.[d.key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const values = (ms, pick) => ms.map(pick).filter((v) => v != null);

  const judged = values(messages, judgeMean);
  const eased = values(messages, (m) => m.readingEase);
  const sentiments = values(messages, (m) => m.sentiment);

  // Reading ease has the widest coverage of the readability measures. Higher
  // is easier; the bands are the conventional Flesch ranges.
  const bands = [
    { label: "Very easy (90+)", test: (v) => v >= 90 },
    { label: "Easy (80-90)", test: (v) => v >= 80 && v < 90 },
    { label: "Fairly easy (70-80)", test: (v) => v >= 70 && v < 80 },
    { label: "Standard or harder (<70)", test: (v) => v < 70 },
  ].map((b) => ({ key: b.label, label: b.label, value: eased.filter(b.test).length }));

  const byBct = bcts
    .map((b) => {
      const mine = messages.filter((m) => m.bctUri === b.uri);
      const j = values(mine, judgeMean);
      const e = values(mine, (m) => m.readingEase);
      return {
        bct: b,
        total: mine.length,
        delivered: mine.filter((m) => m.status === "accepted").length,
        judge: mean(j), judgedN: j.length,
        ease: mean(e), easeN: e.length,
        sentiment: mean(values(mine, (m) => m.sentiment)),
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const pct = (n) => (messages.length ? Math.round((n / messages.length) * 100) : 0);
  const withN = (v, n, digits) => (v == null ? "—" : `${v.toFixed(digits)} (n=${n})`);

  return (
    <>
      <h2 style={{ fontSize: 15, margin: "24px 0 4px", letterSpacing: "-0.01em" }}>Message quality</h2>
      <p style={{ margin: "0 0 12px", color: "var(--ink-2)", fontSize: 13, maxWidth: "76ch" }}>
        Three signals with very different coverage. Judge scores exist only for messages that
        were delivered, so they describe the survivors rather than the whole population.
        Sentiment is computed for everything.
      </p>

      <dl className="a4a-tiles">
        <StatTile label="Messages in scope" value={fmt(messages.length)} />
        <StatTile
          label="Judge score"
          value={mean(judged) == null ? "—" : mean(judged).toFixed(2)}
          hint={`1-5 · ${fmt(judged.length)} messages (${pct(judged.length)}%)`}
        />
        <StatTile
          label="Reading ease"
          value={mean(eased) == null ? "—" : mean(eased).toFixed(1)}
          hint={`higher is easier · ${fmt(eased.length)} (${pct(eased.length)}%)`}
        />
        <StatTile
          label="Sentiment"
          value={mean(sentiments) == null ? "—" : mean(sentiments).toFixed(2)}
          hint={`-1 to 1 · ${fmt(sentiments.length)} (${pct(sentiments.length)}%)`}
        />
      </dl>

      <div className="a4a-grid cols-2">
        <ChartCard
          title="Quality by technique"
          subtitle="Every average carries the number of messages behind it, because coverage is uneven."
          table={
            <SimpleTable
              head={["BCT", "Messages", "Delivered", "Judge", "Reading ease", "Sentiment"]}
              rows={byBct.map((r) => [
                r.bct.name, fmt(r.total), fmt(r.delivered),
                withN(r.judge, r.judgedN, 2), withN(r.ease, r.easeN, 1),
                r.sentiment == null ? "—" : r.sentiment.toFixed(2),
              ])}
            />
          }
        >
          <div className="a4a-table-wrap">
            <table className="a4a-table">
              <thead>
                <tr>
                  <th>BCT</th>
                  <th className="num">Messages</th>
                  <th className="num">Delivered</th>
                  <th className="num">Judge score</th>
                  <th className="num">Reading ease</th>
                  <th className="num">Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {byBct.map((r) => (
                  <tr key={r.bct.uri}>
                    <td>
                      <span className="a4a-status">
                        <span className="a4a-dot" style={{ background: r.bct.color }} />
                        {r.bct.name}
                      </span>
                    </td>
                    <td className="num">{fmt(r.total)}</td>
                    <td className="num">
                      {fmt(r.delivered)}
                      <span style={{ color: "var(--ink-3)" }}>
                        {" "}({r.total ? Math.round((r.delivered / r.total) * 100) : 0}%)
                      </span>
                    </td>
                    <td className="num">
                      {r.judge == null ? <span style={{ color: "var(--ink-3)" }}>not judged</span> : (
                        <>{r.judge.toFixed(2)}<span style={{ color: "var(--ink-3)" }}> n={r.judgedN}</span></>
                      )}
                    </td>
                    <td className="num">
                      {r.ease == null ? "—" : (
                        <>{r.ease.toFixed(1)}<span style={{ color: "var(--ink-3)" }}> n={r.easeN}</span></>
                      )}
                    </td>
                    <td className="num">{r.sentiment == null ? "—" : r.sentiment.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard
          title="Reading level"
          subtitle={`Flesch reading ease, for the ${fmt(eased.length)} messages that have it.`}
          table={<SimpleTable head={["Band", "Messages"]} rows={bands.map((b) => [b.label, fmt(b.value)])} />}
        >
          {bands.some((b) => b.value > 0) ? (
            <HBars data={bands} />
          ) : (
            <div className="a4a-empty">No readability scores in scope.</div>
          )}
        </ChartCard>
      </div>
    </>
  );
}
