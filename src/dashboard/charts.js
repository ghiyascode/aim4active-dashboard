// Hand-rolled SVG charts, so the dashboard adds no charting dependency.
//
// Conventions worth keeping if you add to this file: bars get rounded ends and
// a 2px gap rather than a border, labels go on the endpoints rather than every
// point, and anything plotted also has a table view behind ChartCard's toggle.

import { useCallback, useMemo, useRef, useState } from "react";
import { INK, STATUS } from "./palette";

// Tooltip
export function useTooltip() {
  const [tip, setTip] = useState(null);

  const show = useCallback((evt, content) => {
    setTip({ x: evt.clientX, y: evt.clientY, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const node = tip ? (
    <div
      className="a4a-tip"
      style={{
        left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
        top: tip.y + 16,
      }}
    >
      {tip.content}
    </div>
  ) : null;

  return { show, hide, node };
}

// Card wrapper with a table-view twin
export function ChartCard({ title, subtitle, source, table, children, actions }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="a4a-card">
      <header>
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="a4a-card-actions">
          {actions}
          {/* Only fabricated panels are tagged. Real data is the default and
              needs no badge; the tag exists to stop mock data being mistaken
              for real, not to advertise provenance on every card. */}
          {source === "mock" && (
            <span className="a4a-chip" title="Fabricated demo data — not from your pipeline">
              <span className="a4a-dot" style={{ background: STATUS.warning }} />
              mock
            </span>
          )}
          {table && (
            <button className="a4a-toggle" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
              Table
            </button>
          )}
        </div>
      </header>
      {showTable && table ? <div className="a4a-table-wrap">{table}</div> : children}
    </section>
  );
}

// For when the story is a single number and a chart would add nothing.
export function StatTile({ label, value, hint, tone }) {
  const color = tone ? STATUS[tone] : undefined;
  return (
    <div className="a4a-tile">
      <dt>{label}</dt>
      <dd style={color ? { color } : undefined}>{value}</dd>
      {hint && <small>{hint}</small>}
    </div>
  );
}

const fmt = (n) => (n == null ? "—" : typeof n === "number" ? n.toLocaleString() : n);

// Horizontal bars for comparing magnitude across named categories.
// One measure -> one colour per entity (identity), values direct-labelled.
export function HBars({ data, height = 22, gap = 8, valueLabel = (d) => fmt(d.value), tipContent }) {
  const { show, hide, node } = useTooltip();
  const max = Math.max(1, ...data.map((d) => d.value));
  const labelW = 148;
  const valueW = 56;
  const h = data.length * (height + gap);

  return (
    <>
      <svg className="a4a-chart" viewBox={`0 0 640 ${h}`} height={h} preserveAspectRatio="xMinYMin meet" role="img">
        {data.map((d, i) => {
          const y = i * (height + gap);
          const w = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (640 - labelW - valueW));
          return (
            <g key={d.key ?? d.label}>
              <text x={labelW - 10} y={y + height / 2 + 4} textAnchor="end" className="lbl">
                {d.label.length > 22 ? d.label.slice(0, 21) + "…" : d.label}
              </text>
              <rect
                x={labelW}
                y={y}
                width={w}
                height={height}
                rx={4}
                fill={d.color || "#2a78d6"}
                className="a4a-mark"
              />
              <rect
                x={labelW}
                y={y}
                width={640 - labelW}
                height={height}
                className="a4a-hit"
                onMouseMove={(e) => show(e, tipContent ? tipContent(d) : <><b>{d.label}</b><br />{fmt(d.value)}</>)}
                onMouseLeave={hide}
              />
              <text x={labelW + w + 8} y={y + height / 2 + 4} className="lbl">
                {valueLabel(d)}
              </text>
            </g>
          );
        })}
      </svg>
      {node}
    </>
  );
}

// Accepted against rejected. These are pass/fail states rather than series, so
// use the reserved status palette rather than categorical hues.
export function AcceptRejectBars({ data, tipContent }) {
  const { show, hide, node } = useTooltip();
  const max = Math.max(1, ...data.map((d) => d.accepted + d.rejected));
  const height = 20, gap = 9, labelW = 168, pctW = 52;
  const plotW = 640 - labelW - pctW;
  const h = data.length * (height + gap);

  return (
    <>
      <svg className="a4a-chart" viewBox={`0 0 640 ${h}`} height={h} preserveAspectRatio="xMinYMin meet" role="img">
        {data.map((d, i) => {
          const y = i * (height + gap);
          const total = d.accepted + d.rejected;
          const aw = (d.accepted / max) * plotW;
          const rw = (d.rejected / max) * plotW;
          const tip = tipContent
            ? tipContent(d)
            : (
              <>
                <b>{d.label}</b>
                <br />
                <span className="k">accepted</span> {fmt(d.accepted)} · <span className="k">rejected</span> {fmt(d.rejected)}
                <br />
                <span className="k">rate</span> {((d.accepted / total) * 100).toFixed(1)}%
              </>
            );
          return (
            <g key={d.key ?? d.label}>
              <text x={labelW - 10} y={y + height / 2 + 4} textAnchor="end" className="lbl">
                {d.label.length > 26 ? d.label.slice(0, 25) + "…" : d.label}
              </text>
              {/* 2px surface gap between the two fills, not a border */}
              <rect x={labelW} y={y} width={Math.max(aw, d.accepted ? 2 : 0)} height={height} rx={4} fill={STATUS.good} />
              <rect x={labelW + aw + 2} y={y} width={Math.max(rw - 2, d.rejected ? 2 : 0)} height={height} rx={4} fill={STATUS.critical} opacity={0.85} />
              <rect
                x={labelW} y={y} width={plotW} height={height} className="a4a-hit"
                onMouseMove={(e) => show(e, tip)} onMouseLeave={hide}
              />
              <text x={labelW + plotW + 8} y={y + height / 2 + 4} className="lbl">
                {((d.accepted / total) * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>
      <div className="a4a-legend">
        <span><span className="a4a-dot" style={{ background: STATUS.good }} /> Accepted</span>
        <span><span className="a4a-dot" style={{ background: STATUS.critical, opacity: 0.85 }} /> Rejected</span>
      </div>
      {node}
    </>
  );
}

// Line chart over dates, with optional event markers on the x axis.
// Used for: sends over time, and steps-with-message-markers.
export function LineChart({
  series,          // [{ key, label, color, points: [{x: 'YYYY-MM-DD', y: number|null}] }]
  events = [],     // [{ x, count, label }] — rendered as ticks under the plot
  height = 190,
  yLabel,
  formatY = fmt,
}) {
  const { show, hide, node } = useTooltip();
  const [hoverIdx, setHoverIdx] = useState(null);
  const ref = useRef(null);

  const xs = useMemo(() => {
    const all = new Set();
    for (const s of series) for (const p of s.points) all.add(p.x);
    for (const e of events) all.add(e.x);
    return [...all].sort();
  }, [series, events]);

  const W = 640;
  const padL = 46, padR = 14, padT = 12;
  const plotH = height - padT - (events.length ? 46 : 30);
  const plotW = W - padL - padR;

  const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => y != null);
  const maxY = Math.max(1, ...allY);
  const xAt = (x) => padL + (xs.indexOf(x) / Math.max(1, xs.length - 1)) * plotW;
  const yAt = (y) => padT + plotH - (y / maxY) * plotH;

  const ticks = [0, 0.5, 1].map((t) => Math.round(maxY * t));
  const eventByX = useMemo(() => Object.fromEntries(events.map((e) => [e.x, e])), [events]);
  const maxEvent = Math.max(1, ...events.map((e) => e.count));

  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((rel - padL) / plotW) * (xs.length - 1));
    const idx = Math.max(0, Math.min(xs.length - 1, i));
    setHoverIdx(idx);
    const x = xs[idx];
    show(
      e,
      <>
        <b>{x}</b>
        {series.map((s) => {
          const p = s.points.find((q) => q.x === x);
          return (
            <div key={s.key}>
              <span className="k">{s.label}</span> {p && p.y != null ? formatY(p.y) : "no data"}
            </div>
          );
        })}
        {eventByX[x] && <div><span className="k">{eventByX[x].label || "messages"}</span> {eventByX[x].count}</div>}
      </>
    );
  };

  return (
    <>
      <svg
        ref={ref}
        className="a4a-chart"
        viewBox={`0 0 ${W} ${height}`}
        height={height}
        preserveAspectRatio="xMinYMin meet"
        onMouseMove={onMove}
        onMouseLeave={() => { setHoverIdx(null); hide(); }}
        role="img"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} className="grid-line" />
            <text x={padL - 8} y={yAt(t) + 3.5} textAnchor="end">{formatY(t)}</text>
          </g>
        ))}

        {hoverIdx != null && (
          <line x1={xAt(xs[hoverIdx])} x2={xAt(xs[hoverIdx])} y1={padT} y2={padT + plotH} className="axis-line" />
        )}

        {series.map((s) => {
          // break the path across null gaps rather than interpolating over them
          let d = "";
          let pen = false;
          for (const x of xs) {
            const p = s.points.find((q) => q.x === x);
            if (!p || p.y == null) { pen = false; continue; }
            d += `${pen ? "L" : "M"}${xAt(x).toFixed(1)},${yAt(p.y).toFixed(1)}`;
            pen = true;
          }
          return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
        })}

        {/* selective direct label: the last real point of each series */}
        {series.map((s) => {
          const last = [...s.points].reverse().find((p) => p.y != null);
          if (!last) return null;
          return (
            <g key={s.key + "-end"}>
              <circle cx={xAt(last.x)} cy={yAt(last.y)} r={3.5} fill={s.color} stroke="#fcfcfb" strokeWidth={2} />
            </g>
          );
        })}

        {/* event ticks — days a message was received */}
        {events.map((e) => {
          const h = 6 + (e.count / maxEvent) * 10;
          return (
            <rect
              key={e.x}
              x={xAt(e.x) - 1.5}
              y={padT + plotH + 8}
              width={3}
              height={h}
              rx={1.5}
              fill={INK.muted}
            />
          );
        })}

        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} className="axis-line" />
        {xs.length > 0 && (
          <>
            <text x={padL} y={height - 4}>{xs[0]}</text>
            <text x={W - padR} y={height - 4} textAnchor="end">{xs[xs.length - 1]}</text>
          </>
        )}
        {yLabel && <text x={padL - 8} y={padT - 2} textAnchor="end">{yLabel}</text>}
      </svg>
      {node}
    </>
  );
}

// Inline trend line for table rows. The row supplies the axis and labels.
export function Sparkline({ values, color = "#2a78d6", width = 90, height = 22 }) {
  const real = values.filter((v) => v != null);
  if (real.length < 2) return <span style={{ color: INK.muted, fontSize: 11 }}>no data</span>;
  const max = Math.max(...real), min = Math.min(...real);
  const span = max - min || 1;
  let d = "", pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const x = (i / (values.length - 1)) * width;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Counts across the ordered 1-5 score buckets.
// Ordered categories, so a single hue at one step, not a rainbow.
export function ScoreBars({ buckets, color = "#2a78d6", height = 96 }) {
  const { show, hide, node } = useTooltip();
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const W = 300, barW = W / buckets.length;
  return (
    <>
      <svg className="a4a-chart" viewBox={`0 0 ${W} ${height}`} height={height} preserveAspectRatio="xMinYMin meet" role="img">
        {buckets.map((b, i) => {
          const h = (b.count / max) * (height - 26);
          const x = i * barW;
          return (
            <g key={b.label}>
              <rect x={x + 3} y={height - 20 - h} width={barW - 6} height={Math.max(h, b.count ? 2 : 0)} rx={4} fill={color} />
              <rect x={x} y={0} width={barW} height={height - 18} className="a4a-hit"
                onMouseMove={(e) => show(e, <><b>score {b.label}</b><br />{fmt(b.count)} messages</>)}
                onMouseLeave={hide} />
              <text x={x + barW / 2} y={height - 6} textAnchor="middle">{b.label}</text>
            </g>
          );
        })}
      </svg>
      {node}
    </>
  );
}

export { fmt };
