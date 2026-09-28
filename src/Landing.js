// Public landing page. Carries no study data of any kind, so it is safe to
// serve without authentication. The link to /admin is just a link; the server
// is what challenges for credentials.

import "./landing.css";

export default function Landing() {
  return (
    <main className="landing">
      <div className="landing-card">
        <p className="landing-eyebrow">AIM4Active</p>
        <h1>Message pipeline dashboard</h1>
        <p className="landing-lede">
          An internal view over the message generation pipeline: what was produced, which
          messages passed review, why the rest were rejected, and what reached participants.
        </p>

        <a className="landing-cta" href="/admin">
          Open the dashboard
        </a>

        <p className="landing-note">
          Access is restricted to the study team. You will be asked to sign in.
        </p>
      </div>

      <footer className="landing-foot">
        AIM4Active research tooling. No participant data is shown on this page.
      </footer>
    </main>
  );
}
