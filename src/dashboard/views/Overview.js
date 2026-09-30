// Aggregate counts across every message source, plus the participant rollup.

import { StatTile, ChartCard, HBars, AcceptRejectBars, LineChart, fmt } from "../charts";
import { summarize, gateFailures, bctCounts, countsByDate } from "../data";

export default function Overview({ data, filtered, set, setView }) {
  const { messages, sends, users } = filtered;
  const s = summarize(messages, sends, users);

  const byBct = bctCounts(messages);
  const gates = gateFailures(messages);
  const sendSeries = countsByDate(sends, data.dates);

  const runRows = data.runs
    .filter((r) => messages.some((m) => m.runKey === r.id))
    .map((r) => ({ key: r.id, label: `${r.devCycle} / ${r.label}`, accepted: r.accepted || 0, rejected: r.rejected || 0 }))
    .filter((r) => r.accepted + r.rejected > 0)
    .sort((a, b) => b.accepted + b.rejected - (a.accepted + a.rejected));

  return (
    <>
      <div className="a4a-note">
        {data.participantsAreMock ? (
          <>
            <b>Participants are fabricated.</b> Message content, BCT tags, batches, verdicts,
            judge scores and weather all come from the pipeline's own output, but this snapshot
            records no participant activity, so the people and the send log are stand-ins.
            Fabricated panels are tagged <b>mock</b>; everything untagged is real.
          </>
        ) : (
          <>
            <b>All data on this page is real.</b> Messages, verdicts, judge scores, participants,
            their Fitbit activity and the weather all come from the snapshot. Participant days are
            measured on the run's simulated clock, which is why they predate the run itself.
          </>
        )}
      </div>

      <dl className="a4a-tiles">
        <StatTile label="Messages generated" value={fmt(s.total)} hint={`${fmt(s.db)} in DB · ${fmt(s.agentic)} agentic`} />
        <StatTile label="Accepted" value={fmt(s.accepted)} hint="agentic runs only" tone="good" />
        <StatTile label="Rejected" value={fmt(s.rejected)} hint="with a written reason" tone="critical" />
        <StatTile label="Acceptance rate" value={s.acceptanceRate == null ? "—" : `${s.acceptanceRate}%`} hint="across filtered runs" />
        <StatTile label="BCTs used" value={fmt(s.bctsUsed)} hint={`${data.bctCatalog.length} targeted by the study`} />
        <StatTile label="Messages sent" value={fmt(s.sends)} hint={`${fmt(s.uniqueSent)} unique${data.participantsAreMock ? " · mock" : ""}`} />
        <StatTile label="Participants reached" value={`${s.usersReached}/${data.users.length}`} hint={`${s.failedSends} failed deliveries${data.participantsAreMock ? " · mock" : ""}`} />
      </dl>

      <div className="a4a-grid cols-2">
        <ChartCard
          title="Messages by behaviour change technique"
          subtitle="Both sources combined. Colour identifies the BCT everywhere in this dashboard."
          source="real"
          table={<SimpleTable head={["BCT", "Messages"]} rows={byBct.map((b) => [b.label, fmt(b.value)])} />}
        >
          <HBars
            data={byBct.slice(0, 10)}
            tipContent={(d) => (
              <>
                <b>{d.label}</b><br />{fmt(d.value)} messages
                <br /><span className="k">click to filter</span>
              </>
            )}
          />
          <div className="a4a-legend">
            {byBct.slice(0, 6).map((b) => (
              <span key={b.key}>
                <span className="a4a-dot" style={{ background: b.color }} />
                {b.label}
              </span>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Where candidates die"
          subtitle="Rejections attributed to each critic gate, across the filtered agentic runs."
          source="real"
          table={<SimpleTable head={["Gate", "Rejections"]} rows={gates.map((g) => [g.label, fmt(g.value)])} />}
        >
          {gates.some((g) => g.value > 0) ? (
            <HBars data={gates} />
          ) : (
            <div className="a4a-empty">No adjudicated candidates in scope. Clear the batch filter or pick an agentic run.</div>
          )}
        </ChartCard>

        <ChartCard
          title="Accepted vs rejected by run"
          subtitle="Each agentic run's yield. Saturation stops most runs before the target count."
          source="real"
          table={<SimpleTable head={["Run", "Accepted", "Rejected", "Rate"]} rows={runRows.map((r) => [r.label, fmt(r.accepted), fmt(r.rejected), `${((r.accepted / (r.accepted + r.rejected)) * 100).toFixed(1)}%`])} />}
        >
          {runRows.length ? <AcceptRejectBars data={runRows} /> : <div className="a4a-empty">No agentic runs in scope.</div>}
        </ChartCard>

        <ChartCard
          title="Messages sent per day"
          subtitle={`Across the ${data.dates.length}-day study window (${data.dates[0]} → ${data.dates[data.dates.length - 1]}).`}
          source={data.participantsAreMock ? "mock" : undefined}
          table={<SimpleTable head={["Date", "Sends"]} rows={sendSeries.map((p) => [p.x, fmt(p.y)])} />}
        >
          <LineChart
            series={[{ key: "sends", label: "Messages sent", color: "#2a78d6", points: sendSeries }]}
            yLabel="sends"
          />
        </ChartCard>
      </div>

      <div style={{ marginTop: 18 }}>
        <button className="a4a-reset" onClick={() => setView("messages")}>
          Open the message explorer →
        </button>
      </div>
    </>
  );
}

export function SimpleTable({ head, rows }) {
  return (
    <table className="a4a-table">
      <thead>
        <tr>{head.map((h, i) => <th key={h} className={i ? "num" : undefined}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : undefined}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
