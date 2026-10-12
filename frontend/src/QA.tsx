import { useState } from "react";
import { api, QAResp } from "./api";

const SUGGEST = ["Which evidence shows the reserve is depleting?", "What happens if demand falls to 650 L/h?", "Which procedure covers demand conservation?"];

export default function QA({ runId, openEv, disabled }: { runId: string; openEv: (id: string) => void; disabled: boolean }) {
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [r, setR] = useState<QAResp | null>(null); const [err, setErr] = useState<string | null>(null);
  async function ask(text: string) {
    setBusy(true); setErr(null);
    try { setR(await api.ask(runId, text)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>Ask about this incident</h2>
      <div className="row" style={{ marginBottom: 6 }}>{SUGGEST.map((s) => <button key={s} className="chip" disabled={busy || disabled} onClick={() => { setQ(s); ask(s); }}>{s}</button>)}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" maxLength={400} aria-label="Question" />
        <button className="primary" disabled={busy || disabled}>Ask</button>
      </form>
      {busy && <div className="progress" role="status" style={{ marginTop: 8 }}><span className="spin" />Gemini is using tools…</div>}
      {err && <div className="alert bad small" role="alert" style={{ marginTop: 8 }}>{err}</div>}
      {r && (<div style={{ marginTop: 10 }}>
        <p>{r.answer.answer} <span className="src ai">AI</span> {r.answer.used_what_if && <span className="badge info">what-if (calculation only)</span>}</p>
        <div>{r.answer.evidence_ids.map((i) => <button key={i} className="chip" onClick={() => openEv(i)}>{i}</button>)}{r.answer.procedure_ids.map((i) => <button key={i} className="chip sop" onClick={() => openEv(i)}>{i}</button>)}</div>
        <div className="small muted">Tools used: {r.verification.tools_used.join(", ") || "none"} · numbers {r.verification.numbers_ok ? "match tool results and evidence" : `NOT verified: ${r.verification.unmatched_numbers.join(", ")}`}</div>
      </div>)}
    </div>
  );
}
