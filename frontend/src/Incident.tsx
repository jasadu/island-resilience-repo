import { useState } from "react";
import { api, Doc, State } from "./api";

const PROGRESS: Record<string, string> = {
  new: "Assessing the evidence with Gemini…", assessed: "Checking IDs and numbers, then verifying with an independent judge…",
  needs_repair: "Repairing flagged claims…", repaired: "Re-verifying the repaired assessment…",
};

function Chips({ ids, sop, open }: { ids: string[]; sop?: boolean; open: (id: string) => void }) {
  return <>{ids.map((i) => <button key={i} className={`chip ${sop ? "sop" : ""}`} onClick={() => open(i)}>{i}</button>)}</>;
}

export default function Incident({ s, doc, outdated, runId, openEv, refresh }: {
  s: State; doc: Doc | null; outdated: boolean; runId: string; openEv: (id: string) => void; refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const det = s.detection;

  async function assess() {
    setErr(null); setBusy(PROGRESS.new);
    try {
      let stage = "new";
      for (let i = 0; i < 6 && stage !== "final"; i++) {
        setBusy(PROGRESS[stage] ?? "Working…");
        const d = await api.advance(runId, force);
        stage = d.stage;
        await refresh();
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr((e as Error).message); }
  }

  if (det.state === "none") return (
    <div className="card"><h2>Incident workspace</h2>
      <p className="muted">No incident. Operations look normal. Start playback to watch for a disruption.</p></div>
  );

  const a = doc?.assessment, v = doc?.verification;
  const final = doc?.stage === "final";
  return (
    <div className="card">
      <h2>Incident workspace</h2>
      <div className={`alert ${det.state === "active" ? "bad" : "ok"}`}>
        <div className="row"><span className={`badge ${det.state === "active" ? "bad" : "ok"}`}>{det.state === "active" ? `ACTIVE · ${det.severity}` : "RESOLVED"}</span>
          <span className="small">Started at step {det.started_step}{det.resolved_step !== null && ` · resolved at step ${det.resolved_step}`}</span></div>
        <div className="small muted" style={{ marginTop: 4 }}>Active rules: {det.active_rules.join(", ") || "none (recovering)"}. Resolution is decided by the detector after 5 healthy steps, never by an approval.</div>
      </div>

      {s.new_evidence && <div className="alert warn small">New evidence since the last assessment (checkpoint step {s.incident?.checkpoint_step}). Assess again to refresh. Earlier approvals no longer apply.</div>}
      {err && <div className="alert bad small" role="alert">{err}</div>}

      <div className="row" style={{ marginBottom: 8 }}>
        <button className="primary" disabled={!!busy || (final && !s.new_evidence)} onClick={assess}>{final && !s.new_evidence ? "Assessment up to date" : s.new_evidence ? "Re-assess incident" : "Assess incident"}</button>
        <label className="small"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Force live (bypass cache)</label>
      </div>
      {busy && <div className="progress" role="status"><span className="spin" />{busy}</div>}

      {doc && doc.ai_status === "unavailable" && (<>
        <div className="alert warn"><span className="badge warn">AI unavailable</span> {v?.reason}. Charts, detection and forecasts keep working. Fixed SOP checklist:</div>
        {doc.fallback_checklist?.map((c) => <div key={c.id} className="small"><button className="chip sop" onClick={() => openEv(c.id)}>{c.id}</button> {c.title}</div>)}
      </>)}

      {a && v && (
        <div style={outdated ? { opacity: 0.55 } : undefined}>
          {outdated && <div className="alert warn small">Outdated assessment (step {doc!.step}). Re-assess before acting.</div>}
          <div className="row">
            <span className={`badge ${doc!.source === "cached" ? "info" : "ok"}`}>{doc!.source === "cached" ? "Cached (same evidence)" : "Live"}</span>
            <span className={`badge ${v.status === "verified" ? "ok" : v.status === "unverified" ? "bad" : "warn"}`}>
              {v.status === "verified" && `Verified · ${v.supported}/${v.claims_total} claims supported`}
              {v.status === "verified_with_removals" && `${v.removed?.length} claim(s) removed after verification`}
              {v.status === "unverified" && "UNVERIFIED (judge unavailable)"}
            </span>
            {v.repaired && <span className="badge info">repaired once</span>}
          </div>
          <p><strong>{a.summary}</strong> <span className="src ai">AI</span></p>
          <div className="small muted">Data quality: {a.data_quality}</div>

          <h2 style={{ marginTop: 12 }}>Hypotheses (unverified)</h2>
          {a.hypotheses.map((h) => (
            <div className="hyp" key={h.hyp_id}>
              <div><span className="src ai">AI hypothesis</span> <strong>{h.hyp_id}</strong> {h.cause} {h.flag && <span className="badge warn">partially supported</span>}</div>
              <Chips ids={h.evidence_ids} open={openEv} />
            </div>
          ))}
          {!a.hypotheses.length && <div className="muted small">None.</div>}

          <h2 style={{ marginTop: 12 }}>Recommended actions</h2>
          {a.actions.map((x) => {
            const ap = s.approvals[x.action_id];
            const ex = x.simulated_command !== "none" ? s.actions[x.simulated_command] : undefined;
            const status = ex ? ex.status : ap ? "approved" : "proposed";
            return (
              <div className="act" key={x.action_id}>
                <div className="row"><strong>{x.action_id} · {x.title}</strong><span className="spacer" /><span className="badge info">{status}</span></div>
                <div className="small">{x.owner_role} · priority {x.priority}. {x.rationale} {x.flag && <span className="badge warn">partially supported</span>}</div>
                <div><Chips ids={x.evidence_ids} open={openEv} /><Chips ids={x.procedure_ids} sop open={openEv} /></div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button disabled={outdated || !!ap || !final} onClick={() => act(() => api.approve(runId, x.action_id, doc!.id))}>Approve</button>
                  <button disabled={!ap || !!ex || x.simulated_command === "none"} onClick={() => act(() => api.simulate(runId, x.action_id))}>
                    {x.simulated_command === "none" ? "Manual task (no simulation)" : "Simulate execution"}</button>
                </div>
              </div>
            );
          })}
          {!a.actions.length && <div className="muted small">None.</div>}

          {!!a.missing_evidence.length && <p className="small"><strong>Missing evidence:</strong> {a.missing_evidence.join("; ")}</p>}
          <p className="small"><strong>Limitations:</strong> {a.limitations.join(" ")}</p>

          {!!v.removed?.length && (<details><summary className="small">Claims removed ({v.removed.length})</summary>
            {v.removed.map((r, i) => <div key={i} className="small muted">{r.item_id} · {r.source} check: {r.reason}</div>)}</details>)}
          <div className="timeline">{doc!.source !== "cached" && doc!.timeline.map((t) => `${t.stage} ${(t.latency_ms / 1000).toFixed(1)}s`).join("  →  ")} {doc!.source !== "cached" && "· "}{doc!.source === "cached" ? "served from cache: no model calls for this visitor" : `${doc!.calls} model call(s)`}</div>
        </div>
      )}

      {det.state === "resolved" && <p className="small">Recovery confirmed by the detector. <a href={api.reportUrl(runId, "md")}>Download report (Markdown)</a> · <a href={api.reportUrl(runId, "json")}>JSON</a></p>}
      {det.state === "active" && final && <p className="small"><a href={api.reportUrl(runId, "md")}>Download interim report</a></p>}
    </div>
  );
}
