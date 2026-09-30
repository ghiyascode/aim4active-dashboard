// Builds the participant layer, preferring real data and falling back to the
// mock when the snapshot cannot support a view.
//
// Timeline note: a run executes at CREATED_AT but simulates a study period at
// PSEUDO_TIME, and it is PSEUDO_TIME that lines up with the activity and
// weather series. So the study clock here is pseudo time, not wall clock.

import { buildParticipants as buildMock } from "./mockParticipants";

const dayOf = (ts) => (ts || "").slice(0, 10);

// True when the snapshot carries enough to describe a participant's activity.
function hasRealParticipants(snap) {
  return (snap.db?.dailyActivity?.length ?? 0) > 0;
}

function buildReal(snap, deliveredMessages) {
  const activity = snap.db.dailyActivity;
  const weatherRows = snap.db.dailyWeather ?? [];

  const dates = [...new Set(activity.map((a) => dayOf(a.ts)))].sort();

  // Weather is keyed by zip, but USERS carries no zip, so a single zip in the
  // data can be attributed to everyone. More than one and we cannot tell who
  // belongs where, so weather is left off rather than guessed.
  const zips = [...new Set(weatherRows.map((w) => w.zip))];
  const sharedZip = zips.length === 1 ? zips[0] : null;

  const weatherByDate = {};
  for (const w of weatherRows) {
    if (sharedZip && w.zip !== sharedZip) continue;
    weatherByDate[dayOf(w.ts)] = {
      date: dayOf(w.ts),
      tempF: w.tempMean == null ? null : +w.tempMean.toFixed(1),
      precipIn: w.precipSum ?? 0,
    };
  }

  const stepsByUid = {};
  const extrasByUid = {};
  for (const a of activity) {
    (stepsByUid[a.uid] ??= {})[dayOf(a.ts)] = a.steps;
    (extrasByUid[a.uid] ??= []).push(a);
  }

  const known = new Map((snap.db.users ?? []).map((u) => [u.uid, u]));
  for (const uid of Object.keys(stepsByUid)) if (!known.has(uid)) known.set(uid, { uid });

  const users = [...known.values()].map((u) => {
    const steps = stepsByUid[u.uid] ?? {};
    const days = Object.keys(steps).sort();
    const rows = extrasByUid[u.uid] ?? [];
    const avg = (pick) => {
      const vals = rows.map(pick).filter((v) => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    return {
      uid: u.uid,
      phone: u.phone ?? null,
      age: u.age ?? null,
      gender: u.gender ?? null,
      race: u.race ?? null,
      weightCategory: u.weightCategory ?? null,
      ethnicity: u.ethnicity ?? null,
      zip: sharedZip,
      area: null,
      fitbitLinked: days.length > 0,
      tokenStatus: days.length ? "valid" : "unlinked",
      enrolledAt: days[0] ?? dates[0],
      baselineSteps: steps[days[0]] ?? null,
      restingHr: avg((r) => r.restingHr),
      hoursAsleep: avg((r) => r.hoursAsleep),
      steps,
      // USERS was empty for this run, so demographics are unknown rather than absent.
      demographicsKnown: u.age != null,
    };
  });

  const sends = deliveredMessages
    .filter((m) => m.uid)
    .map((m, i) => {
      const date = dayOf(m.pseudoTime) || dayOf(m.deliveredAt);
      const weather = weatherByDate[date];
      return {
        id: `d${String(i + 1).padStart(4, "0")}`,
        messageId: m.key,
        messageText: m.text,
        runId: m.runId ?? null,
        bct: m.bctName,
        bctUri: m.bctUri,
        uid: m.uid,
        date,
        sentAt: m.pseudoTime || m.deliveredAt,
        deliveryStatus: "delivered",
        stepsSameDay: stepsByUid[m.uid]?.[date] ?? null,
        tempF: weather?.tempF ?? null,
        precipIn: weather?.precipIn ?? null,
        zip: sharedZip,
        area: null,
      };
    })
    .filter((s) => s.date)
    .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));

  return { users, sends, dates, weatherByDate };
}

/**
 * @param snap              the raw snapshot
 * @param deliveredMessages normalised messages with status "accepted"
 * @param acceptedForMock   candidates the mock draws its message text from
 */
export function buildParticipantLayer(snap, deliveredMessages, acceptedForMock) {
  if (hasRealParticipants(snap)) {
    const real = buildReal(snap, deliveredMessages);
    if (real.users.length) return { ...real, isMock: false };
  }
  return { ...buildMock(snap.weather ?? [], acceptedForMock), isMock: true };
}

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

// Participants in the same zip share a weather series, so the rollup reports
// one set of weather figures per zip alongside its cohort's activity.
export function zipRollup(users, sends, weatherByDate, dates) {
  const groups = {};
  for (const u of users) {
    (groups[u.zip] ??= { zip: u.zip, area: u.area, users: [] }).users.push(u);
  }
  const days = dates.map((d) => weatherByDate[d]).filter(Boolean);

  return Object.values(groups)
    .map((g) => {
      const inZip = sends.filter((s) => s.zip === g.zip);
      return {
        ...g,
        userCount: g.users.length,
        sendCount: inZip.length,
        avgSteps: mean(g.users.flatMap((u) => Object.values(u.steps))),
        avgTempF: +(days.reduce((a, w) => a + w.tempF, 0) / (days.length || 1)).toFixed(1),
        rainDays: days.filter((w) => w.precipIn > 0.01).length,
      };
    })
    .sort((a, b) => a.zip.localeCompare(b.zip));
}

// One row per day for a single participant: steps, weather, messages received.
export function userTimeline(user, sends, dates, weatherByDate) {
  const byDate = {};
  for (const s of sends) {
    if (s.uid === user.uid) (byDate[s.date] ??= []).push(s);
  }
  return dates.map((date) => ({
    date,
    steps: user.steps[date] ?? null,
    weather: weatherByDate[date],
    sends: byDate[date] ?? [],
  }));
}
