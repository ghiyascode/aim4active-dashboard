// Sign-in form shown when the snapshot is encrypted.
//
// Each study team member has their own username and password (managed with
// `npm run users`). Nothing is sent to a server: the password unlocks that
// person's key to the data in this browser, so a wrong username or password
// simply produces no data. See scripts/encrypt.mjs for the scheme.

import { useState } from "react";
import { isSupported } from "./decrypt";

export default function SignIn({ onSubmit, error, busy }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const supported = isSupported();
  const ready = username.trim() && password && !busy;

  const submit = (e) => {
    e.preventDefault();
    if (ready) onSubmit(username, password);
  };

  return (
    <div className="a4a-unlock">
      <form className="a4a-unlock-card" onSubmit={submit}>
        <p className="a4a-unlock-eyebrow">AIM4Active</p>
        <h1>Sign in</h1>
        <p className="a4a-unlock-lede">
          This dashboard is restricted to the study team. Sign in with your own account.
        </p>

        {!supported ? (
          <p className="a4a-unlock-error">
            This browser cannot open the data because the page is not being served over a
            secure connection. Open it over HTTPS, or on localhost.
          </p>
        ) : (
          <>
            <label className="a4a-unlock-field">
              <span>Username</span>
              <input
                type="text"
                name="username"
                value={username}
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setUsername(e.target.value)}
                aria-invalid={error ? "true" : undefined}
              />
            </label>

            <label className="a4a-unlock-field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? "true" : undefined}
              />
            </label>

            {error && <p className="a4a-unlock-error" role="alert">{error}</p>}

            <button className="a4a-unlock-button" type="submit" disabled={!ready}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </>
        )}

        <p className="a4a-unlock-note">
          No account, or forgot your password? Ask the study team administrator.
        </p>
      </form>
    </div>
  );
}
