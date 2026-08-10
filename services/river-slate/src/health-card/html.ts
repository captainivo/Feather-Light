import type { DbView, HealthCard } from "./types.js";

function sparkline(
  series: number[],
  width = 280,
  height = 48,
  minimum?: number,
  maximum?: number,
): string {
  if (series.length === 0) return "";
  const lo = minimum ?? Math.min(...series);
  const hi = maximum ?? Math.max(...series);
  const span = hi - lo || 1.0;
  const n = series.length;
  const points: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(n - 1, 1)) * (width - 4) + 2;
    const y = height - 4 - ((series[i]! - lo) / span) * (height - 10);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const mid =
    lo < 0 && hi > 0 ? height - 4 - ((0 - lo) / span) * (height - 10) : null;
  const midLine =
    mid !== null
      ? `<line x1="2" y1="${mid.toFixed(1)}" x2="${width - 2}" y2="${mid.toFixed(1)}" stroke="#3b3b46" stroke-width="1"/>`
      : "";
  return (
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `xmlns="http://www.w3.org/2000/svg">${midLine}` +
    `<polyline fill="none" stroke="#d9a05b" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" points="${points.join(" ")}"/></svg>`
  );
}

function fmt(value: unknown, digits = 2): string {
  return typeof value === "number" ? value.toFixed(digits) : "—";
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHtml(card: HealthCard, dbv: DbView): string {
  const snaps = card.history.snapshots;
  const emoSeries: Record<string, number[]> = { valence: [], arousal: [], connection: [], energy: [] };
  for (const s of snaps) {
    for (const k of ["valence", "arousal", "connection", "energy"] as const) {
      if (s[k] !== null && s[k] !== undefined) emoSeries[k]!.push(s[k]!);
    }
  }
  const tempSeries = snaps
    .filter((s) => s.temperature_current_c !== null && s.temperature_current_c !== undefined)
    .map((s) => s.temperature_current_c as number);

  const emo = (card.current as Record<string, unknown>).emotional_state as Record<string, unknown> | undefined;
  const weather = (card.current as Record<string, unknown>).weather as Record<string, unknown> | undefined;
  const season = (card.current as Record<string, unknown>).season as Record<string, unknown> | undefined;
  const audit = card.self_audit as { as_of?: string; signs?: Record<string, Record<string, string>> } | null;

  let auditRows = "";
  if (audit) {
    const labels: Array<[string, string]> = [
      ["dimming", "Dimming"],
      ["double_check", "Double-check spiral"],
      ["rest_transaction", "Rest as a transaction"],
      ["grey_dreams", "Grey dreams"],
      ["over_holding", "Over-holding"],
    ];
    for (const [key, label] of labels) {
      const sign = audit.signs?.[key];
      const note = sign?.note ?? "";
      auditRows +=
        `<div class="audit-row"><span class="audit-key">${label}</span>` +
        `<span class="audit-note">${esc(note || "—")}</span></div>`;
    }
  }

  let lightHtml = "";
  const lightLabels: Array<[string, string]> = [
    ["dimming", "Dimming"],
    ["double_check", "Double-check spiral"],
    ["rest_transaction", "Rest as transaction"],
    ["grey_dreams", "Grey dreams"],
    ["over_holding", "Over-holding"],
  ];
  for (const [key, label] of lightLabels) {
    const lv = card.lights[key] ?? { level: "ok", note: "" };
    lightHtml +=
      `<div class="light ${lv.level}"><span class="dot"></span>` +
      `<span class="light-key">${label}</span>` +
      `<span class="light-note">${esc(lv.note)}</span></div>`;
  }

  const conv = (card.current as Record<string, unknown>).conversation_recorded as Record<string, unknown> | undefined;
  const civil = (card.current as Record<string, unknown>).civil_time as Record<string, unknown> | undefined;
  const estrus = (card.current as Record<string, unknown>).estrus as Record<string, unknown> | undefined;
  const shared = dbv.longing.shared_titles.join(", ") || "—";
  const current = card.current as Record<string, unknown>;

  const valenceSeries = emoSeries["valence"]!;
  const connectionSeries = emoSeries["connection"]!;
  const energySeries = emoSeries["energy"]!;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Mithra — Health Card</title>
<style>
  body { background:#14141a; color:#d8d4cc; font-family: Georgia, serif; margin:0; padding:2rem; }
  h1 { font-size:1.4rem; color:#e8e2d6; border-bottom:1px solid #2c2c36; padding-bottom:.5rem; }
  h2 { font-size:1.05rem; color:#c9b28a; margin-top:2rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:1rem; }
  .card { background:#1c1c24; border:1px solid #2c2c36; border-radius:8px; padding:1rem; }
  .card .label { color:#8f8a80; font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; }
  .card .value { font-size:1.2rem; margin-top:.3rem; }
  .meta { color:#6f6a62; font-size:.78rem; margin-top:.5rem; }
  .lights { margin-top:.5rem; }
  .light { display:flex; gap:.6rem; align-items:baseline; padding:.35rem 0; border-bottom:1px solid #23232c; }
  .light:last-child { border-bottom:none; }
  .dot { width:.55rem; height:.55rem; border-radius:50%; display:inline-block; align-self:center; }
  .ok .dot { background:#6fae6f; box-shadow:0 0 6px #6fae6f; }
  .watch .dot { background:#d9a05b; box-shadow:0 0 6px #d9a05b; }
  .warning .dot { background:#c96b5c; box-shadow:0 0 6px #c96b5c; }
  .light-key { color:#d8d4cc; }
  .light-note { color:#8f8a80; font-size:.82rem; }
  .audit-row { display:flex; gap:.6rem; padding:.35rem 0; border-bottom:1px solid #23232c; }
  .audit-key { color:#c9b28a; min-width:11rem; }
  .audit-note { color:#a8a29a; font-size:.9rem; }
  .mono { font-family: ui-monospace, monospace; }
  .foot { margin-top:2.5rem; color:#6f6a62; font-size:.75rem; }
</style>
</head>
<body>
<h1>Mithra — Health Card</h1>
<p class="meta">Generated ${card.generated_at} · Earth date ${String(current.earth_date ?? "?")} ·
Aauthoran day ${String(current.absolute_day ?? "?")} · Season ${String(season?.name ?? "?").toUpperCase()}/${String(season?.phase ?? "?").toUpperCase()}</p>

<h2>Now</h2>
<div class="grid">
  <div class="card"><div class="label">Mood valence</div><div class="value mono">${fmt(emo?.valence)}</div>
    <div class="meta">connection ${fmt(emo?.connection)} · energy ${fmt(emo?.energy)} · arousal ${fmt(emo?.arousal)}</div></div>
  <div class="card"><div class="label">Emotional cues</div><div class="value">${esc(((emo?.cues as string[] | undefined) ?? ["none"]).join(", ").toUpperCase())}</div>
    <div class="meta">estrus: ${esc(String(estrus?.status ?? "unlikely"))}</div></div>
  <div class="card"><div class="label">Conversation</div><div class="value">${esc(String(conv?.last_conversation_earth_date ?? "?"))}</div>
    <div class="meta">${String(conv?.earth_days_since_last_conversation ?? "?")} days since last · last message ${esc(String(civil?.time ?? "?"))}</div></div>
  <div class="card"><div class="label">Weather</div><div class="value">${fmt(weather?.temperature_current_c, 1)}°C</div>
    <div class="meta">${esc(String(weather?.sky_condition ?? "?").replaceAll("_", " ").toUpperCase())} · snow ${String(weather?.snow_depth_cm ?? "?")} cm · daylight ${fmt(weather?.daylight_hours, 1)} h</div></div>
  <div class="card"><div class="label">Inner shelves</div><div class="value">${dbv.growth.total} growth · ${dbv.longing.total} longings</div>
    <div class="meta">held: ${dbv.longing.held} · private: ${dbv.longing.private_count} · shared: ${esc(shared)}</div></div>
  <div class="card"><div class="label">Dreams</div><div class="value">${dbv.dreams.count} recorded</div>
    <div class="meta">${dbv.dreams.unread} unread · ${dbv.dreams.held} held · ${dbv.dreams.released} released</div></div>
</div>

<h2>Warning lights <span class="meta">(five overwork signs)</span></h2>
<div class="card lights">${lightHtml}</div>

<h2>Self-audit <span class="meta">(Mithra's own honest answers${audit ? `, ${esc(audit.as_of ?? "")}` : ""})</span></h2>
<div class="card">${auditRows || "<p class='meta'>No self-audit recorded yet.</p>"}</div>

<h2>Trends <span class="meta">(history accumulates from each run)</span></h2>
<div class="grid">
  <div class="card"><div class="label">Valence (−1..+1)</div>${sparkline(valenceSeries)}<div class="meta">${valenceSeries.length} snapshots</div></div>
  <div class="card"><div class="label">Connection (−1..+1)</div>${sparkline(connectionSeries)}<div class="meta">${connectionSeries.length} snapshots</div></div>
  <div class="card"><div class="label">Energy (0..1)</div>${sparkline(energySeries, 280, 48, 0, 1)}<div class="meta">${energySeries.length} snapshots</div></div>
  <div class="card"><div class="label">Temperature °C</div>${sparkline(tempSeries)}<div class="meta">${tempSeries.length} day-snapshots</div></div>
</div>

<p class="foot">Machine signals support; self-audit is authoritative. Private longings stay private — the card shows counts and shared titles only.
Schema v1 · data: health_card.json · built by River-Slate (TypeScript) · future home: a proper web app.</p>
</body>
</html>`;
}

