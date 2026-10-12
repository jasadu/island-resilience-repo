import { useCallback, useEffect, useRef, useState } from "react";
import { api, Doc, Scenario, State } from "./api";
import Charts from "./Charts";
import Schematic from "./Schematic";
import Incident from "./Incident";
import QA from "./QA";
import Drawer from "./Drawer";

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "n/a" : n.toLocaleString(undefined, { maximumFractionDigits: d }));

function Metric({ label, value, unit, sub, src, tone }: { label: string; value: string; unit?: string; sub?: string; src: "Observed" | "Calculated"; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="metric">
      <div className="lbl"><span>{label}</span><span className={`src ${src === "Calculated" ? "calc" : ""}`}>{src}</span></div>
      <div className="val" style={tone ? { color: `var(--${tone})` } : undefined}>{value}{unit && <span className="muted" style={{ fontSize: 13 }}> {unit}</span>}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scn, setScn] = useState("power-water");
  const [runId, setRunId] = useState<string | null>(() => { try { return sessionStorage.getItem("runId"); } catch { return null; } });
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selNode, setSelNode] = useState("tank");
  const [drawer, setDrawer] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<Doc | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const acc = useRef(0);
  const prevDet = useRef("none");
  const ticking = useRef(false);

  useEffect(() => { api.scenarios().then(setScenarios).catch(() => setErr("Cannot reach the API.")); }, []);

  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      const st = await api.state(runId);
      setS(st);
      const a = st.assessment as Doc | null;
      if (a && a.stage === "final") setLastDoc(a);
      if (prevDet.current === "none" && st.detection.state === "active" && st.run.state === "playing") {
        await api.control(runId, { cmd: "pause" });
        setToast(`Incident detected at step ${st.detection.started_step}. Simulation paused: assess it when ready, or resume.`);
        st.run.state = "paused"; setS({ ...st });
      }
      prevDet.current = st.detection.state;
    } catch (e) {
      if ((e as { status?: number }).status === 404) { setRunId(null); setS(null); } else setErr((e as Error).message);
    }
  }, [runId]);

  useEffect(() => { if (runId) { try { sessionStorage.setItem("runId", runId); } catch { /* ignore */ } refresh(); } }, [runId, refresh]);

  // Client-driven ticks: speed/60 steps per second; the server clamps catch-up and is idempotent.
  useEffect(() => {
    if (!runId || !s || s.run.state !== "playing") return;
    const t = setInterval(async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        acc.current += s.run.speed / 60;
        const n = Math.floor(acc.current);
        if (n >= 1) {
          acc.current -= n;
          await api.control(runId, { cmd: "tick", to_step: s.run.current_step + n });
        }
        await refresh();
      } catch (e) { setErr((e as Error).message); } finally { ticking.current = false; }
    }, 1000);
    return () => clearInterval(t);
  }, [runId, s?.run.state, s?.run.speed, s?.run.current_step, refresh]);

  async function start() {
    setErr(null); setToast(null); setLastDoc(null); prevDet.current = "none"; acc.current = 0;
    const r = await api.newRun(scn); setS(null); setRunId(r.run_id);
  }
  async function ctl(body: object) {
    if (!runId) return;
    const r = await api.control(runId, body) as { run_id: string };
    if ((body as { cmd: string }).cmd === "reset") { setLastDoc(null); prevDet.current = "none"; acc.current = 0; setToast(null); setRunId(r.run_id); } else await refresh();
  }

  if (!runId || !s) {
    return (<>
      <div className="banner">SYNTHETIC DATA — SIMULATION ONLY. No real island, utility or person is represented.</div>
      <div className="intro">
        <h1>Island Resilience AI</h1>
        <p>An operations assistant for a fictional island's linked water and power systems. It detects a disruption with deterministic rules, asks Gemini for an evidence-cited assessment, has a second model verify every claim, and waits for an operator to approve any action before a simulated recovery.</p>
        <div className="card">
          <h2>Start a sandbox run</h2>
          <select value={scn} onChange={(e) => setScn(e.target.value)} aria-label="Scenario">{scenarios.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
          <p className="small muted">{scenarios.find((x) => x.id === scn)?.description}</p>
          <button className="primary" onClick={start} disabled={!scenarios.length}>Start run</button>
          {err && <div className="alert bad small" role="alert" style={{ marginTop: 8 }}>{err}</div>}
        </div>
      </div></>);
  }

  const { run, horizon: h, latest: L } = s;
  const net = L.inflow?.value !== null && L.outflow?.value !== null && L.inflow && L.outflow ? (L.inflow.value as number) - (L.outflow.value as number) : null;
  const doc = (s.assessment && s.assessment.stage === "final" ? (s.assessment as Doc) : null) ?? (s.new_evidence ? lastDoc : null);
  const outdated = !!doc && !!s.assessment && s.assessment.stage !== "final";
  const aiBadge = !doc ? { t: "AI: idle", c: "info" } : doc.ai_status === "unavailable" ? { t: "AI: unavailable", c: "warn" } : doc.source === "cached" ? { t: "AI: cached", c: "info" } : { t: "AI: live", c: "ok" };
  const hLabel = h.state === "unavailable" ? "Unavailable" : h.state === "no_depletion" ? "No depletion" : h.state === "below_critical" ? "Below critical" : `${fmt(h.hours_to_critical, 1)} h`;
  const tankAge = L.tank_volume?.value === null ? L.tank_volume?.age_steps : 0;

  return (<>
    <div className="banner">SYNTHETIC DATA — SIMULATION ONLY. Procedures are demo SOPs, not approved field procedures.</div>
    <header className="top">
      <h1>Island Resilience AI</h1>
      <span className="badge info">{s.scenario.title}</span>
      <div className="seg" role="group" aria-label="Playback">
        <button className={run.state === "playing" ? "on" : ""} onClick={() => ctl({ cmd: "play" })}>Play</button>
        <button className={run.state === "paused" ? "on" : ""} onClick={() => ctl({ cmd: "pause" })}>Pause</button>
      </div>
      <div className="seg" role="group" aria-label="Speed">{[1, 10, 60].map((x) => <button key={x} className={run.speed === x ? "on" : ""} onClick={() => ctl({ cmd: "speed", speed: x })}>{x}×</button>)}</div>
      <button onClick={() => ctl({ cmd: "reset" })}>Reset</button>
      <button onClick={() => { setRunId(null); setS(null); try { sessionStorage.removeItem("runId"); } catch { /* ignore */ } }}>New scenario</button>
      <span className="spacer" />
      <span className="small muted">Step {run.current_step}/{s.scenario.n_steps - 1} · {new Date(s.sim_time).toISOString().slice(11, 16)} sim time</span>
      <span className={`badge ${aiBadge.c}`}>{aiBadge.t}</span>
    </header>
    {toast && <div className="alert warn" role="status" style={{ margin: "12px 16px 0" }}>{toast} <button className="link" onClick={() => setToast(null)}>dismiss</button></div>}
    {err && <div className="alert bad" role="alert" style={{ margin: "12px 16px 0" }}>{err} <button className="link" onClick={() => setErr(null)}>dismiss</button></div>}
    <main>
      <section>
        <div className="metrics">
          <Metric label="Tank volume" src="Observed" value={fmt(L.tank_volume?.value)} unit="L" sub={tankAge ? `sensor silent ${tankAge} steps` : "fresh"} tone={tankAge ? "bad" : undefined} />
          <Metric label="Inflow (production)" src="Observed" value={fmt(L.inflow?.value)} unit="L/h" />
          <Metric label="Outflow (demand)" src="Observed" value={fmt(L.outflow?.value)} unit="L/h" />
          <Metric label="Net flow" src="Calculated" value={fmt(net)} unit="L/h" sub={net !== null && net < 0 ? "tank is losing water" : "tank is stable or filling"} />
          <Metric label="Voltage" src="Observed" value={fmt(L.voltage?.value, 1)} unit="V" tone={(L.voltage?.value ?? 230) < 210 ? "bad" : undefined} />
          <Metric label="Reserve horizon" src="Calculated" value={hLabel} sub={h.state === "depleting" ? `to critical · rates held constant` : h.state === "unavailable" ? "forecast withheld: data too thin" : undefined}
            tone={h.state === "depleting" && (h.hours_to_critical ?? 99) < 16 ? "bad" : h.state === "unavailable" ? "warn" : undefined} />
        </div>
        <div className="stack">
          <Schematic s={s} selected={selNode} onSelect={setSelNode} />
          <Charts s={s} />
        </div>
      </section>
      <section className="stack">
        <Incident s={s} doc={doc} outdated={outdated} runId={runId} openEv={setDrawer} refresh={refresh} />
        <QA runId={runId} openEv={setDrawer} disabled={run.qa_calls >= 10} />
        <div className="card small muted">Run {run.id} · {run.ai_calls} model call(s) this run. Each visitor gets an isolated synthetic run. Production would add sign-in and roles.</div>
      </section>
    </main>
    {drawer && <Drawer id={drawer} doc={doc ?? lastDoc} onClose={() => setDrawer(null)} />}
  </>);
}
