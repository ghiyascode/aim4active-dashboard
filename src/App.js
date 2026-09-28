// Two routes: a public landing page, and the dashboard under /admin.
//
// The /admin prefix is what the web server protects. Both the dashboard route
// and its data (/admin/data/snapshot.json) sit under it, so a single server
// rule covers them. Nothing here performs authentication: a check in React
// would not stop anyone fetching the data file directly.

import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import Landing from "./Landing";
import Dashboard from "./dashboard/Dashboard";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
