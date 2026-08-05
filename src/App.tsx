import { FormEvent, useEffect, useMemo, useState } from "react";

type Monitor = { id: number; name: string; source: string; expected: string; status: "Healthy" | "Waiting"; received: string; recipients: string[] };
const seed: Monitor[] = [
  { id: 1, name: "Daily revenue report", source: "reports@stripe.com", expected: "8:30 AM", status: "Healthy", received: "Today, 8:12 AM", recipients: ["BJ", "AK", "+2"] },
  { id: 2, name: "Warehouse sync", source: "ops@northstar.io", expected: "10:00 AM", status: "Waiting", received: "Yesterday, 9:47 AM", recipients: ["BJ", "+1"] },
  { id: 3, name: "Database backup", source: "notify@backups.dev", expected: "6:00 AM", status: "Healthy", received: "Today, 5:54 AM", recipients: ["AK"] },
];
function Mark() { return <span className="mark" aria-hidden="true"><i/><i/><i/></span>; }

export default function App() {
  const [monitors, setMonitors] = useState(seed);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<"All" | "Healthy" | "Waiting">("All");
  const visible = useMemo(() => filter === "All" ? monitors : monitors.filter((item) => item.status === filter), [filter, monitors]);

  useEffect(() => {
    fetch("/api/session", { credentials: "include" }).then((response) => response.json() as Promise<{ user: { email: string; name: string } | null }>).then(async ({ user: activeUser }) => {
      setUser(activeUser); setSessionReady(true);
      if (!activeUser) return;
      const response = await fetch("/v1/monitors", { credentials: "include" });
      if (!response.ok) return;
      const data = await response.json() as { monitors: Array<{ id: string; name: string; inboxAddress: string; scheduleHourUtc: number; lastReceivedAt: string | null; recipients: Array<{ destination: string }> }> };
      setMonitors(data.monitors.map((monitor: { id: string; name: string; inboxAddress: string; scheduleHourUtc: number; lastReceivedAt: string | null; recipients: Array<{ destination: string }> }) => ({
        id: Number.parseInt(monitor.id.replaceAll("-", "").slice(0, 10), 16), name: monitor.name, source: monitor.inboxAddress,
        expected: `${String(monitor.scheduleHourUtc).padStart(2, "0")}:00 UTC`, status: monitor.lastReceivedAt?.startsWith(new Date().toISOString().slice(0, 10)) ? "Healthy" : "Waiting",
        received: monitor.lastReceivedAt ? new Date(monitor.lastReceivedAt).toLocaleString() : "Not received yet", recipients: monitor.recipients.map((recipient) => recipient.destination),
      })));
    }).catch(() => setSessionReady(true));
  }, []);

  function beginAdd() { if (!user) { window.location.assign("/auth/google"); return; } setDialogOpen(true); }

  function addMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const hour = Number(String(data.get("expected")).split(":")[0]);
    fetch("/v1/monitors", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), inboxAddress: data.get("inbox"), scheduleHourUtc: hour, graceMinutes: 15, recipients: [{ channel: "email", destination: data.get("recipient") }] }) }).then(async (response) => {
      if (!response.ok) throw new Error("Could not create monitor");
      setMonitors((current) => [{ id: Date.now(), name: String(data.get("name")), source: String(data.get("inbox")), expected: `${String(hour).padStart(2,"0")}:00 UTC`, status: "Waiting", received: "Not received yet", recipients: [String(data.get("recipient"))] }, ...current]);
      setDialogOpen(false); setToast("Monitor is live"); window.setTimeout(() => setToast(""), 3000);
    }).catch(() => { setToast("Could not create monitor"); window.setTimeout(() => setToast(""), 3000); });
  }

  return <div className="app-shell">
    <header>
      <a className="brand" href="#top" aria-label="Pulseguard home"><Mark/>pulseguard</a>
      <nav aria-label="Primary navigation"><a className="active" href="#monitors">Monitors</a><a href="#activity">Activity</a><a href="#how-it-works">Docs</a></nav>
      <div className="header-actions"><span className="system-status"><i/> All systems normal</span>{sessionReady && (user ? <a href="/auth/logout" className="avatar" aria-label="Sign out" title={`Signed in as ${user.email}`}>{user.name.split(" ").map(part => part[0]).join("").slice(0,2)}</a> : <a className="sign-in" href="/auth/google">Sign in with Google</a>)}</div>
    </header>
    <main id="top">
      <section className="hero">
        <div><p className="eyebrow">EMAIL ANOMALY DETECTION</p><h1>Silence shouldn’t<br/>go <em>unnoticed.</em></h1><p className="lede">Pulseguard watches for the emails your business depends on—and tells everyone who needs to know when one doesn’t arrive.</p><div className="hero-actions"><button className="primary" onClick={beginAdd}>{user ? "Add a monitor" : "Sign in to start"} <span>↗</span></button><a className="text-link" href="#how-it-works">See how it works <span>↓</span></a></div></div>
        <div className="signal-card" aria-label="Live signal visualization"><div className="signal-top"><span>LIVE SIGNAL</span><b><i/> Watching 3 inboxes</b></div><div className="signal-graphic"><div className="mail-node">✉</div><div className="pulse-line"><span/><span/><span/></div><div className="check-node">✓</div></div><div className="signal-event"><i/><div><strong>Daily revenue report</strong><span>Received 18 min early</span></div><time>8:12 AM</time></div></div>
      </section>
      <section className="stats" aria-label="Monitoring summary"><article><span>ACTIVE MONITORS</span><strong>{monitors.length.toString().padStart(2,"0")}</strong><small><b>↑</b> 1 this week</small></article><article><span>ON-TIME RATE</span><strong>99.4<sup>%</sup></strong><small><b>↑</b> 0.3% vs last month</small></article><article><span>EMAILS WATCHED</span><strong>847</strong><small>Past 30 days</small></article><article><span>AVG. ARRIVAL</span><strong>12<sup>m</sup></strong><small>Before deadline</small></article></section>
      <section className="monitors" id="monitors"><div className="section-heading"><div><p className="eyebrow">YOUR MONITORS</p><h2>The emails that matter.</h2></div><div className="filters" role="group" aria-label="Filter monitors">{(["All","Healthy","Waiting"] as const).map(item => <button className={filter===item?"selected":""} onClick={()=>setFilter(item)} key={item}>{item}</button>)}</div></div>
        <div className="table-wrap"><table><thead><tr><th>MONITOR</th><th>EXPECTED</th><th>LAST RECEIVED</th><th>STATUS</th><th>ALERTS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(monitor => <tr key={monitor.id}><td><div className="monitor-name"><span>✉</span><div><strong>{monitor.name}</strong><small>{monitor.source}</small></div></div></td><td>{monitor.expected}<small>daily</small></td><td>{monitor.received}</td><td><span className={`badge ${monitor.status.toLowerCase()}`}><i/>{monitor.status}</span></td><td><div className="recipients">{monitor.recipients.map(r=><span key={r}>{r}</span>)}</div></td><td><button className="more" aria-label={`More options for ${monitor.name}`}>•••</button></td></tr>)}</tbody></table></div>
      </section>
      <section className="how" id="how-it-works"><div><p className="eyebrow">HOW IT WORKS</p><h2>Forward. Wait.<br/>We’ll watch.</h2></div><ol><li><span>01</span><div><strong>Choose the signal</strong><p>Give each important email a private Pulseguard address.</p></div></li><li><span>02</span><div><strong>Set the deadline</strong><p>Tell us when it should arrive and add a grace period.</p></div></li><li><span>03</span><div><strong>Alert the right people</strong><p>Email everyone—or add SMS when the signal is critical.</p></div></li></ol></section>
    </main>
    <footer><a className="brand" href="#top"><Mark/>pulseguard</a><span>Missing-email detection, without another server to babysit.</span><a href="https://github.com" target="_blank" rel="noreferrer">View source ↗</a></footer>
    {dialogOpen && <div className="dialog-backdrop" onMouseDown={()=>setDialogOpen(false)}><form className="dialog" onSubmit={addMonitor} onMouseDown={e=>e.stopPropagation()}><button className="close" type="button" onClick={()=>setDialogOpen(false)} aria-label="Close">×</button><p className="eyebrow">NEW MONITOR</p><h2>Watch an important email.</h2><label>Name<input name="name" required placeholder="Daily revenue report"/></label><label>Pulseguard inbox<input name="inbox" type="email" required placeholder="revenue@pulseguard.bryantjames.com"/></label><label>Alert email<input name="recipient" type="email" required defaultValue={user?.email}/></label><label>Daily deadline (UTC)<input name="expected" type="time" required defaultValue="16:00"/></label><p className="form-note">Forward the expected email to this inbox. Pulseguard alerts you after the deadline plus a 15-minute grace period.</p><button className="primary" type="submit">Create monitor <span>↗</span></button></form></div>}
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </div>;
}
