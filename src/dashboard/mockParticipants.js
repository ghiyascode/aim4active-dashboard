// Fabricated participants and send log.
//
// The pipeline does not yet record which message went to which person: the
// message->participant columns are empty and no delivery log is persisted. This
// module stands in for that so the participant views have something to draw.
// Everything it produces is tagged "mock" in the UI.
//
// Real even here: the weather series, the study window, and the text of every
// message sent. Invented: the people, their steps, and the routing.
//
// To replace with real data, drop this module and load USERS,
// DELIVERED_MESSAGES and PERSONALIZATION_DAILY_ACTIVITY from the snapshot. The
// object shapes returned below are what the views expect.

const STUDY_DAYS = 30;
const PARTICIPANTS = 12;

// Participants are identified by UID. Names are not collected, and the USERS
// table has no column for them. Race and ethnicity are excluded by study
// decision, so the mock does not invent them either.
const GENDERS = ["F", "M"];
const WEIGHT_CATEGORIES = ["Normal", "Overweight", "Obese"];

// Zips within one metro, so they share a single weather series.
const ZIPS = [
  { zip: "76010", area: "Arlington" },
  { zip: "76102", area: "Fort Worth" },
  { zip: "75201", area: "Dallas" },
  { zip: "76013", area: "Arlington W" },
];

// Seeded so the mock is identical on every reload.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rough 0-100 index of how pleasant a day is to walk in, from real temp/precip.
function walkability({ tempF, precipIn }) {
  const score = 100 - Math.max(0, tempF - 78) * 3.2 - Math.max(0, 55 - tempF) * 1.6 - precipIn * 45;
  return Math.max(5, Math.min(100, Math.round(score)));
}

/**
 * @param weather  snapshot rows: [{ date, tempF, precipIn }]
 * @param accepted accepted candidates: [{ id, text, bct, bctUri, runId }]
 */
export function buildParticipants(weather, accepted) {
  const rnd = mulberry32(20260713);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  // The study window is the most recent stretch we have real weather for. With
  // no weather series at all, synthesise a plain one so the layer still builds.
  const window = weather.length
    ? weather.slice(-STUDY_DAYS)
    : Array.from({ length: STUDY_DAYS }, (_, i) => {
        const d = new Date(Date.UTC(2025, 6, 23) + i * 86400000);
        return { date: d.toISOString().slice(0, 10), tempF: 82, precipIn: 0 };
      });
  const dates = window.map((w) => w.date);
  const weatherByDate = Object.fromEntries(
    window.map((w) => [w.date, { ...w, walkability: walkability(w) }])
  );

  const users = [];
  for (let i = 0; i < PARTICIPANTS; i++) {
    const { zip, area } = ZIPS[i % ZIPS.length];
    const linked = i !== 4 && i !== 9;
    const baseline = int(2400, 7400);
    const enrolledIdx = int(0, 7);
    const sensitivity = rnd() * 12 + 3;

    const steps = {};
    dates.forEach((date, day) => {
      if (day < enrolledIdx || !linked) return;
      if (rnd() < 0.05) return; // missed sync
      const drift = (weatherByDate[date].walkability - 62) * sensitivity;
      const value = baseline + day * int(6, 24) + int(-1200, 1200) + drift;
      steps[date] = Math.max(180, Math.round(value));
    });

    users.push({
      uid: `U${String(i + 1).padStart(3, "0")}`,
      age: int(45, 82),
      gender: pick(GENDERS),
      weightCategory: pick(WEIGHT_CATEGORIES),
      zip,
      area,
      fitbitLinked: linked,
      tokenStatus: !linked ? "unlinked" : i === 7 ? "expiring" : "valid",
      enrolledAt: dates[enrolledIdx],
      baselineSteps: baseline,
      steps,
    });
  }

  // A message is generated for one participant and sent only to them, so the
  // pool is drawn down rather than sampled: no message reaches two people.
  const pool = accepted.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const sends = [];
  for (const user of users) {
    if (!user.fitbitLinked) continue;
    for (let day = dates.indexOf(user.enrolledAt); day < dates.length; day++) {
      if (rnd() > 0.45) continue;
      const msg = pool.pop();
      if (!msg) break;

      const date = dates[day];
      const hh = String(int(8, 19)).padStart(2, "0");
      const mm = String(int(0, 59)).padStart(2, "0");
      const roll = rnd();

      sends.push({
        id: `s${String(sends.length + 1).padStart(4, "0")}`,
        messageId: msg.id,
        messageText: msg.text,
        runId: msg.runId,
        bct: msg.bct,
        bctUri: msg.bctUri,
        uid: user.uid,
        date,
        sentAt: `${date} ${hh}:${mm}`,
        deliveryStatus: roll < 0.92 ? "delivered" : roll < 0.97 ? "failed" : "queued",
        stepsSameDay: user.steps[date] ?? null,
        tempF: weatherByDate[date].tempF,
        precipIn: weatherByDate[date].precipIn,
        zip: user.zip,
        area: user.area,
      });
    }
  }
  sends.sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  return { users, sends, dates, weatherByDate };
}
