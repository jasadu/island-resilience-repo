"""Incident report built only from the stored immutable assessment document (not from live telemetry)."""
import json
from .store import store
from . import config


def build(run_id, fmt="md"):
    st = store()
    run = st.get("runs", run_id)
    if run is None:
        return None
    aid = run.get("latest_assessment_id")
    d = st.get("assessments", aid) if aid else None
    if d is None or d["stage"] != "final":
        return None
    snap, a, v = d["snapshot"], d.get("assessment"), d["verification"]
    payload = {"run_id": run_id, "scenario": run["scenario_id"], "checkpoint_step": d["step"], "sim_time": snap["sim_time"],
               "synthetic_data": True, "snapshot_hash": d["snapshot_hash"], "evidence": snap["items"],
               "calculation_snapshot": snap["horizon"], "sop_sections": [{"id": s["id"], "title": s["title"]} for s in snap["sops"]],
               "assessment": a, "verification": v, "source": d.get("source"), "models": {"assess": config.ASSESS_MODEL, "judge": config.JUDGE_MODEL},
               "prompt_version": d.get("prompt_version"), "approvals": run["approvals"], "actions_executed": run["actions"],
               "audit": run["audit"]}
    if fmt == "json":
        return json.dumps(payload, indent=2, default=str), "application/json"
    L = [f"# Incident report — {run['scenario_id']} (run {run_id})",
         "", "> **SYNTHETIC DATA.** This is a simulation. Procedures are demo SOPs, not approved field procedures.", "",
         f"- Checkpoint: step {d['step']} ({snap['sim_time']})", f"- Evidence snapshot: `{d['snapshot_hash'][:16]}`",
         f"- AI: {d.get('source')} · assessor `{config.ASSESS_MODEL}` · judge `{config.JUDGE_MODEL}` · prompt {d.get('prompt_version')}",
         f"- Verification: **{v.get('status')}**"
         + (f" — {v.get('supported')}/{v.get('claims_total')} claims supported, {len(v.get('removed', []))} removed" if 'claims_total' in v else ""), ""]
    if a:
        L += ["## Summary", a["summary"], "", "## Hypotheses (all unverified)"]
        L += [f"- **{h['hyp_id']}** {h['cause']} _(evidence: {', '.join(h['evidence_ids'])})_" for h in a["hypotheses"]] or ["- none"]
        L += ["", "## Recommended actions (each needs operator approval)"]
        L += [f"- **{x['action_id']}** {x['title']} — {x['owner_role']}; {x['rationale']} _(evidence: {', '.join(x['evidence_ids'])}; procedures: {', '.join(x['procedure_ids']) or '-'})_" for x in a["actions"]] or ["- none"]
        L += ["", "## Limitations"] + [f"- {x}" for x in a["limitations"]]
    else:
        L += ["## AI assessment", "AI was unavailable for this checkpoint; the fixed SOP checklist was shown instead."]
    if v.get("removed"):
        L += ["", "## Claims removed after verification"] + [f"- {r['item_id']} ({r['source']}): {r['reason']}" for r in v["removed"]]
    L += ["", "## Calculation snapshot (reserve horizon)", "```json", json.dumps(snap["horizon"], indent=2), "```",
          "", "## Evidence"] + [f"- **{i['id']}** {i['label']} — steps {i['step_range'][0]}–{i['step_range'][1]}: `{json.dumps(i['values'])}`" for i in snap["items"]]
    L += ["", "## Approvals and execution (simulated)"]
    L += [f"- {k}: approved at step {x['approved_step']} → `{x['command']}`" for k, x in run["approvals"].items()] or ["- none"]
    L += [f"- Command `{c}` executed in simulation at step {s}" for c, s in run["actions"].items()]
    L += ["", "## Audit timeline"] + [f"- step {e['step']}: {e['event']} {({k: x for k, x in e.items() if k not in ('at','step','event')}) or ''}" for e in run["audit"]]
    return "\n".join(L), "text/markdown"
