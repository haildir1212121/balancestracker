
import React, { useEffect, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
// We'll try Firestore first, then fall back to Realtime Database if Firestore isn't available.
import {
  getFirestore,
  collection,
  getDocs,
} from "firebase/firestore";
import { getDatabase, ref as rtdbRef, child, get as rtdbGet } from "firebase/database";

// --- IMPORTANT ---
// Replace the firebaseConfig object below with your Firebase project credentials.
// You can find these in your Firebase console (Project settings -> SDK setup).
const firebaseConfig = {
  apiKey: "AIzaSyB-P87cAnvDHpCoPocqhjHE9zGaDQXxe2U",
  authDomain: "balance-t.firebaseapp.com",
  databaseURL: "https://balance-t-default-rtdb.firebaseio.com",
  projectId: "balance-t",
  storageBucket: "balance-t.firebasestorage.app",
  messagingSenderId: "893924100931",
  appId: "1:893924100931:web:70427b3ff655341594fdf6",
  measurementId: "G-5RJM9SQDS1"
};

// Initialize Firebase app only once (safe for hot-reload)
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

// Try to get Firestore. If the environment / SDK doesn't have firestore enabled
// we'll gracefully fall back to Realtime Database (RTDB). This avoids the
// "Service firestore is not available" runtime error and supports projects
// that are using RTDB instead of Firestore.
let firestoreAvailable = true;
let firestoreDB = null;
try {
  firestoreDB = getFirestore(app);
} catch (err) {
  // Most likely the SDK doesn't include Firestore or project isn't configured.
  console.warn("Firestore not available — will try Realtime Database as fallback.", err);
  firestoreAvailable = false;
}

let rtdb = null;
if (!firestoreAvailable) {
  try {
    rtdb = getDatabase(app);
  } catch (err) {
    console.error("Realtime Database also not available:", err);
  }
}

export default function FirebaseClientsDashboard() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search and filter state
  const [query, setQuery] = useState("");
  // three prefix filters (user-editable). If empty -> ignored.
  const [prefixes, setPrefixes] = useState(["AH", "BH", "CH"]);
  const [activeFilter, setActiveFilter] = useState(0); // 0 = All, 1..3 = prefixes[0..2]

  useEffect(() => {
    let mounted = true;
    async function fetchClients() {
      setLoading(true);
      try {
        const items = [];

        if (firestoreAvailable && firestoreDB) {
          // --- Firestore path ---
          const snap = await getDocs(collection(firestoreDB, "clients"));
          snap.forEach((doc) => {
            const data = doc.data() || {};
            items.push({ id: doc.id, ...data });
          });
        } else if (rtdb) {
          // --- Realtime Database path ---
          // Expecting a structure like: /clients/{clientName}: { clientName: ..., monthlyData: [...] }
          const snapshot = await rtdbGet(child(rtdbRef(rtdb), "clients"));
          if (snapshot.exists()) {
            const val = snapshot.val();
            // val is an object whose keys are client names (or ids)
            Object.keys(val).forEach((k) => {
              const data = val[k] || {};
              // If the client object doesn't contain clientName, use key
              items.push({ id: k, clientName: data.clientName || k, ...data });
            });
          }
        } else {
          throw new Error(
            "Neither Firestore nor Realtime Database are available. Check your Firebase SDK imports and project configuration."
          );
        }

        if (mounted) {
          // normalize string fields
          const normalized = items.map((it) => ({
            ...it,
            clientName: it.clientName || it.id,
            accountNumber: it.accountNumber || "",
            monthlyData: Array.isArray(it.monthlyData) ? it.monthlyData : [],
          }));

          normalized.sort((a, b) => (a.clientName || "").localeCompare(b.clientName || ""));
          setClients(normalized);
          setError(null);
        }
      } catch (e) {
        console.error(e);
        if (mounted) setError(e.message || "Failed to load clients");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchClients();
    return () => (mounted = false);
  }, []);

  // Derived list after search + filter
  const filtered = clients.filter((c) => {
    // Search by name or accountNumber
    const name = (c.clientName || c.id || "").toLowerCase();
    const acc = (c.accountNumber || "").toLowerCase();
    const q = query.trim().toLowerCase();
    if (q) {
      if (!name.includes(q) && !acc.includes(q)) return false;
    }
    if (activeFilter === 0) return true;
    const prefix = prefixes[activeFilter - 1] || "";
    if (!prefix) return true; // treat empty prefix as passthrough
    return (c.accountNumber || "").toString().startsWith(prefix);
  });

  function formatMoney(n) {
    if (n == null || isNaN(n)) return "—";
    return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function latestMonthInfo(client) {
    const months = client.monthlyData || [];
    if (!months.length) return null;
    // assume monthlyData is sorted newest-first, otherwise pick first
    return months[0];
  }

  // Simple CSV export for selected client
  function downloadClientCSV(client) {
    const rows = [];
    rows.push(["Month", "Monthly Limit", "Remaining Balance", "Trip Total"].join(","));
    (client.monthlyData || []).forEach((m) => {
      rows.push([
        `"${m.month || ""}"`,
        m.monthlyLimit ?? "",
        m.remainingBalance ?? "",
        m.tripTotal ?? "",
      ].join(","));
    });
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.clientName || client.id}_monthly.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Clients Dashboard</h1>
          <div className="flex items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients or account #"
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 focus:outline-none focus:ring"
            />
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-2 rounded-md border ${activeFilter === 0 ? "bg-blue-600 text-white" : "bg-white"}`}
                onClick={() => setActiveFilter(0)}
              >
                All
              </button>
              {prefixes.map((p, idx) => (
                <button
                  key={idx}
                  title={`Filter: starts with '${p || "(empty)"}'`}
                  onClick={() => setActiveFilter(idx + 1)}
                  className={`px-3 py-2 rounded-md border ${activeFilter === idx + 1 ? "bg-blue-600 text-white" : "bg-white"}`}
                >
                  {p || `Filter ${idx + 1}`}
                </button>
              ))}
            </div>
          </div>
        </header>

        <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg shadow-sm bg-white dark:bg-gray-800">
            <h3 className="font-medium">Filters</h3>
            <p className="text-sm text-gray-500">Edit prefixes used for the three filters. Leave blank to make that filter passthrough.</p>
            <div className="mt-3 space-y-2">
              {prefixes.map((val, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={val}
                    onChange={(e) => {
                      const next = [...prefixes];
                      next[i] = e.target.value.toUpperCase();
                      setPrefixes(next);
                    }}
                    className="flex-1 px-2 py-1 border rounded"
                    placeholder={`Prefix ${i + 1} (e.g. AH)`}
                  />
                  <button
                    className="px-2 py-1 border rounded text-sm"
                    onClick={() => {
                      const next = [...prefixes];
                      next[i] = "";
                      setPrefixes(next);
                    }}
                  >
                    Clear
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-lg shadow-sm bg-white dark:bg-gray-800 md:col-span-2">
            <h3 className="font-medium">Summary</h3>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-700">
                <div className="text-sm text-gray-500">Clients shown</div>
                <div className="text-xl font-semibold">{filtered.length}</div>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-700">
                <div className="text-sm text-gray-500">Total remaining balance</div>
                <div className="text-xl font-semibold">{formatMoney(filtered.reduce((s, c) => s + (latestMonthInfo(c)?.remainingBalance || 0), 0))}</div>
              </div>
            </div>
          </div>
        </section>

        <main>
          {loading ? (
            <div className="p-8 text-center">Loading clients…</div>
          ) : error ? (
            <div className="p-4 bg-red-50 text-red-700 rounded">Error: {error}</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((c) => (
                <article key={c.id} className="p-4 bg-white dark:bg-gray-800 rounded shadow-sm flex flex-col md:flex-row justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">{c.clientName || c.id}</div>
                    <div className="text-sm text-gray-500">Account #: {c.accountNumber || "—"}</div>
                    <div className="mt-2 text-sm">
                      {(() => {
                        const m = latestMonthInfo(c);
                        if (!m) return <span className="text-gray-500">No monthly data</span>;
                        return (
                          <div className="flex gap-4">
                            <div>
                              <div className="text-xs text-gray-500">Month</div>
                              <div className="font-medium">{m.month}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Remaining</div>
                              <div className="font-medium">{formatMoney(m.remainingBalance)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Trip Total</div>
                              <div className="font-medium">{formatMoney(m.tripTotal)}</div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex items-center gap-2">
                    <button
                      onClick={() => downloadClientCSV(c)}
                      className="px-3 py-2 border rounded-md text-sm"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={() => alert(JSON.stringify(c, null, 2))}
                      className="px-3 py-2 border rounded-md text-sm"
                    >
                      View Raw
                    </button>
                  </div>
                </article>
              ))}

              {filtered.length === 0 && <div className="p-4 text-center text-gray-500">No clients match your filters.</div>}
            </div>
          )}
        </main>

        <footer className="mt-8 text-sm text-gray-500">
          <div>Note: this component attempts to read from Firestore first. If Firestore is not available it will try your project's Realtime Database at <code>/clients/</code>.</div>
          <div className="mt-2">If you expect the data to come from Firestore but still see an error, please confirm which database (Firestore or Realtime Database) your project uses and whether you're using the modular Firebase v9+ SDK.</div>
        </footer>
      </div>
    </div>
  );
}
