// Per-participant activity against the days a message arrived, grouped by zip.
// Runs on real participants when the snapshot has them, on the mock layer when
// it does not; the page says which.

import { useState } from "react";
import { ChartCard, StatTile, LineChart, Sparkline, fmt } from "../charts";
import { SimpleTable } from "./Overview";
import { zipRollup, userTimeline } from "../participants";
import { STATUS } from "../palette";

export default function Participants({ data, filtered, filters, set }) {
  const tag = data.participantsAreMock ? "mock" : undefined;
  const [openId, setOpenId] = useState(null);
  const users = filtered.users;
  const sends = filtered.sends;

  const zips = zipRollup(users, sends, data.weatherByDate, data.dates);
  const allSteps = users.flatMap((u) => Object.values(u.steps));
  const avgSteps = allSteps.length ? Math.round(allSteps.reduce((a, b) => a + b, 0) / allSteps.length) : 0;
  const open = openId ? users.find((u) => u.uid === openId) : null;

  return (
    <>
      <div className="a4a-note">
        {tag ? (
          <>
            <b>Participants and steps are fabricated.</b> This snapshot records no participant
            activity, so these people are stand-ins. The weather series, the study window and every
            message body shown are real. Supply a database with
            <span className="a4a-mono"> PERSONALIZATION_DAILY_ACTIVITY</span> rows and this page
            switches to real participants on its own.
          </>
        ) : (
          <>
            <b>Real participants.</b> Activity, weather and delivery all come from the snapshot.
            Days are measured on the run's simulated clock
            (<span className="a4a-mono">PSEUDO_TIME</span>), which is the clock the Fitbit series
            was recorded against, so they predate the run itself.
          </>
        )}
      </div>

      <dl className="a4a-tiles">
        <StatTile label="Participants" value={fmt(users.length)} hint={`${users.filter((u) => u.fitbitLinked).length} with a linked Fitbit`} />
        <StatTile label="Fitbit issues" value={fmt(users.filter((u) => u.tokenStatus !== "valid").length)} hint="unlinked or expiring token" tone={users.some((u) => u.tokenStatus !== "valid") ? "warning" : "good"} />
        <StatTile label="Messages sent" value={fmt(sends.length)} hint={`${fmt(sends.filter((s) => s.deliveryStatus === "failed").length)} failed`} />
        <StatTile label="Avg daily steps" value={fmt(avgSteps)} hint={`across ${fmt(data.dates.length)} days`} />
      </dl>

      <div className="a4a-grid cols-2">
        <ChartCard
          title="Participants"
          subtitle="Click a row to open that participant's day-by-day timeline."
          source={tag}
          table={
            <SimpleTable
              head={["Participant", "Zip", "Messages", "Avg steps"]}
              rows={users.map((u) => {
                const st = Object.values(u.steps);
                return [
                  u.uid, u.zip,
                  fmt(sends.filter((s) => s.uid === u.uid).length),
                  st.length ? fmt(Math.round(st.reduce((a, b) => a + b, 0) / st.length)) : "—",
                ];
              })}
            />
          }
        >
          <div className="a4a-table-wrap">
            <table className="a4a-table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Zip</th>
                  <th>Fitbit</th>
                  <th>Steps ({data.dates.length}d)</th>
                  <th className="num">Avg</th>
                  <th className="num">Msgs</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const series = data.dates.map((d) => u.steps[d] ?? null);
                  const vals = series.filter((v) => v != null);
                  const mine = sends.filter((s) => s.uid === u.uid);
                  return (
                    <tr
                      key={u.uid}
                      className={`a4a-row-click ${openId === u.uid ? "selected" : ""}`}
                      onClick={() => setOpenId(openId === u.uid ? null : u.uid)}
                    >
                      <td>
                        <b className="a4a-mono">{u.uid}</b>
                        {(u.age != null || u.gender) && (
                          <div style={{ color: "var(--ink-3)", fontSize: 11 }}>
                            {[u.age != null ? `age ${u.age}` : null, u.gender].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td>{u.zip ?? "—"}{u.area && <div style={{ color: "var(--ink-3)", fontSize: 11 }}>{u.area}</div>}</td>
                      <td>
                        <span className="a4a-status">
                          <span className="a4a-dot" style={{
                            background: u.tokenStatus === "valid" ? STATUS.good : u.tokenStatus === "expiring" ? STATUS.warning : STATUS.critical,
                          }} />
                          {u.tokenStatus}
                        </span>
                      </td>
                      <td><Sparkline values={series} /></td>
                      <td className="num">{vals.length ? fmt(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)) : "—"}</td>
                      <td className="num">{fmt(mine.length)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard
          title="Zip code groups"
          subtitle="Participants in the same zip share one weather series."
          source={tag}
          table={
            <SimpleTable
              head={["Zip", "Participants", "Sends", "Avg steps", "Avg °F", "Rain days"]}
              rows={zips.map((z) => [z.zip, fmt(z.userCount), fmt(z.sendCount), fmt(z.avgSteps), z.avgTempF, fmt(z.rainDays)])}
            />
          }
        >
          <div className="a4a-table-wrap">
            <table className="a4a-table">
              <thead>
                <tr>
                  <th>Zip</th>
                  <th className="num">People</th>
                  <th className="num">Sends</th>
                  <th className="num">Avg steps</th>
                  <th className="num">Avg °F</th>
                  <th className="num">Rain days</th>
                </tr>
              </thead>
              <tbody>
                {zips.map((z) => (
                  <tr key={z.zip} className="a4a-row-click" onClick={() => set({ zip: filters.zip === z.zip ? "" : z.zip })}>
                    <td><b>{z.zip ?? "—"}</b>{z.area && <div style={{ color: "var(--ink-3)", fontSize: 11 }}>{z.area}</div>}</td>
                    <td className="num">{fmt(z.userCount)}</td>
                    <td className="num">{fmt(z.sendCount)}</td>
                    <td className="num">{fmt(z.avgSteps)}</td>
                    <td className="num">{z.avgTempF}</td>
                    <td className="num">{fmt(z.rainDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, marginBottom: 0 }}>
            Weather is keyed by zip, but the participant record carries no zip, so a single zip in
            the data is attributed to everyone. Splitting cohorts by location needs that column.
          </p>
        </ChartCard>
      </div>

      {open && <Timeline user={open} data={data} sends={sends} tag={tag} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Timeline({ user, data, sends, tag, onClose }) {
  const rows = userTimeline(user, sends, data.dates, data.weatherByDate);
  const mine = sends.filter((s) => s.uid === user.uid);

  const stepPoints = rows.map((r) => ({ x: r.date, y: r.steps }));
  const tempPoints = rows.map((r) => ({ x: r.date, y: r.weather?.tempF ?? null }));
  const events = rows.filter((r) => r.sends.length).map((r) => ({ x: r.date, count: r.sends.length, label: "messages" }));

  const stepsOnMsgDays = rows.filter((r) => r.sends.length && r.steps != null).map((r) => r.steps);
  const stepsOffDays = rows.filter((r) => !r.sends.length && r.steps != null).map((r) => r.steps);
  const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="a4a-grid cols-2">
        <ChartCard
          title={`${user.uid} — steps and message days`}
          subtitle="Ticks under the axis mark days a message was received. One measure per chart — never two y-scales."
          source={tag}
          actions={<button className="a4a-toggle" onClick={onClose}>Close</button>}
          table={
            <SimpleTable
              head={["Date", "Steps", "°F", "Messages"]}
              rows={rows.map((r) => [r.date, r.steps == null ? "—" : fmt(r.steps), r.weather?.tempF ?? "—", r.sends.length || ""])}
            />
          }
        >
          <LineChart
            series={[{ key: "steps", label: "Steps", color: "#2a78d6", points: stepPoints }]}
            events={events}
            yLabel="steps"
          />
          <div className="a4a-legend">
            <span><span className="a4a-dot" style={{ background: "#2a78d6" }} /> Daily steps</span>
            <span><span style={{ width: 3, height: 12, background: "var(--ink-3)", display: "inline-block", borderRadius: 2 }} /> Message received</span>
          </div>
          <dl className="a4a-tiles" style={{ marginTop: 14, marginBottom: 0 }}>
            <StatTile label="Message days" value={fmt(mean(stepsOnMsgDays))} hint={`${stepsOnMsgDays.length} days`} />
            <StatTile label="Quiet days" value={fmt(mean(stepsOffDays))} hint={`${stepsOffDays.length} days`} />
            <StatTile label="Baseline" value={fmt(user.baselineSteps)} hint="at enrolment" />
          </dl>
        </ChartCard>

        <ChartCard
          title="Daily temperature"
          subtitle="Real weather for the same window — plotted separately rather than on a second y-axis."
          source="real"
          table={<SimpleTable head={["Date", "°F", "Precip in"]} rows={rows.map((r) => [r.date, r.weather?.tempF ?? "—", r.weather?.precipIn ?? "—"])} />}
        >
          <LineChart
            series={[{ key: "temp", label: "Mean temp °F", color: "#eb6834", points: tempPoints }]}
            yLabel="°F"
            formatY={(v) => `${v}°`}
          />
        </ChartCard>
      </div>

      <div style={{ marginTop: 14 }}>
        <ChartCard
          title={`Messages sent to ${user.uid}`}
          subtitle="Message bodies are real accepted output; the routing is mock."
          source={tag}
        >
          {mine.length === 0 ? (
            <div className="a4a-empty">No messages routed to this participant in scope.</div>
          ) : (
            <div className="a4a-table-wrap">
              <table className="a4a-table">
                <thead>
                  <tr>
                    <th>Sent</th><th>BCT</th><th>Message</th>
                    <th className="num">Steps</th><th className="num">°F</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((s) => (
                    <tr key={s.id}>
                      <td className="a4a-mono">{s.sentAt}</td>
                      <td>{s.bct}</td>
                      <td className="msg">{s.messageText}</td>
                      <td className="num">{s.stepsSameDay?.toLocaleString() ?? "—"}</td>
                      <td className="num">{s.tempF}</td>
                      <td>
                        <span className="a4a-status">
                          <span className="a4a-dot" style={{
                            background: s.deliveryStatus === "delivered" ? STATUS.good : s.deliveryStatus === "failed" ? STATUS.critical : STATUS.warning,
                          }} />
                          {s.deliveryStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
