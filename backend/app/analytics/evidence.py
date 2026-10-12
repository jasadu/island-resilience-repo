"""Evidence registry: fixed-order items with stable IDs ev-01..ev-09. Deterministic for (scenario, seed, step, actions)."""
import hashlib, json
from .detect import RULES, RULE_LABELS, detect
from .reserve import horizon_from_window
from ..sim.engine import build_trace
from .. import sops as sopmod


def _r(x, n=2):
    return None if x is None else round(float(x), n)


def _window(rows, ch, n=10):
    vals = [(r["step"], r["obs"][ch][0]) for r in rows[-n:] if ch in r["obs"]]
    if not vals:
        return None
    v = [x for _, x in vals]
    return {"first_step": vals[0][0], "last_step": vals[-1][0], "min": _r(min(v)), "mean": _r(sum(v) / len(v)),
            "last": _r(v[-1]), "readings": len(v)}


def checkpoints(sc, actions, upto):
    """Steps at which a new assessment is meaningful: rule-set changes, executed actions, resolution."""
    rows = build_trace(sc, upto, actions)
    det = detect(rows, sc)
    steps = set(det["change_steps"]) | {s for s in actions.values() if s <= upto}
    if det["resolved_step"] is not None:
        steps.add(det["resolved_step"])
    return sorted(steps), det


def build_snapshot(sc, actions, step):
    acts = {c: s for c, s in actions.items() if s <= step}
    rows = build_trace(sc, step, acts)
    det = detect(rows, sc)
    h = horizon_from_window(rows, sc)
    last = rows[-1]
    first_below_v = next((r["step"] for r in rows if r["obs"]["voltage"][0] < 210), None)
    first_low_in = next((r["step"] for r in rows if r["obs"]["inflow"][0] < 400), None)
    tank_age = None
    tank_steps = [r["step"] for r in rows if "tank_volume" in r["obs"]]
    if tank_steps:
        tank_age = step - tank_steps[-1]

    items = [
        {"id": "ev-01", "kind": "telemetry_window", "label": "Supply voltage, last 10 steps (V)",
         "step_range": [max(0, step - 9), step],
         "values": {**(_window(rows, "voltage") or {}), "first_step_below_210": first_below_v}},
        {"id": "ev-02", "kind": "telemetry_window", "label": "Water inflow, last 10 steps (L/h)",
         "step_range": [max(0, step - 9), step],
         "values": {**(_window(rows, "inflow") or {}), "first_step_below_400": first_low_in}},
        {"id": "ev-03", "kind": "telemetry_window", "label": "Water outflow (demand), last 10 steps (L/h)",
         "step_range": [max(0, step - 9), step], "values": _window(rows, "outflow") or {}},
        {"id": "ev-04", "kind": "telemetry_window", "label": "Tank volume, last 10 steps (L)",
         "step_range": [max(0, step - 9), step], "values": _window(rows, "tank_volume") or {"status": "no readings"}},
    ]
    calc = {k: (_r(v, 3) if isinstance(v, float) else v) for k, v in h.items()}
    items.append({"id": "ev-05", "kind": "calculation", "label": "Reserve horizon (calculated, rates held constant)",
                  "step_range": [max(0, step - 9), step], "values": calc})
    for n, rule in enumerate(RULES):
        fs = det["first_fired"][rule]
        items.append({"id": f"ev-0{6 + n}", "kind": "detection_rule", "label": f"Rule: {RULE_LABELS[rule]}",
                      "step_range": [fs, step] if fs is not None else [step, step],
                      "values": {"fired": fs is not None and fs <= step, "first_sustained_step": fs,
                                 "active_now": rule in det["active_rules"]}})
    items.append({"id": "ev-09", "kind": "data_quality", "label": "Data quality and sensor freshness",
                  "step_range": [step, step],
                  "values": {"horizon_coverage": h.get("coverage"), "tank_sensor_age_steps": tank_age,
                             "tank_sensor_missing": tank_age is None,
                             "readings_per_channel_in_window": min(10, step + 1)}})
    fired = [r for r in RULES if det["first_fired"][r] is not None and det["first_fired"][r] <= step]
    sensor_problem = h["state"] == "unavailable"
    sop_secs = sopmod.sops_for(fired, sensor_problem, det["state"] == "resolved")
    digest = {"scenario": sc.id, "seed": sc.seed, "step": step, "actions": sorted(acts.items()), "items": items,
              "sops": [s["id"] for s in sop_secs]}
    snap_hash = hashlib.sha256(json.dumps(digest, sort_keys=True, default=str).encode()).hexdigest()
    return {"snapshot_hash": snap_hash, "step": step, "sim_time": last["sim_time"], "incident_state": det["state"],
            "active_rules": det["active_rules"], "severity": det["severity"], "items": items,
            "sops": [{"id": s["id"], "title": s["title"], "text": s["text"], "banner": s["banner"]} for s in sop_secs],
            "actions_executed": acts, "horizon": calc}


def numeric_leaves(obj, out=None):
    out = [] if out is None else out
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, (int, float)):
        out += [float(obj), round(float(obj), 1), round(float(obj), 0)]
    elif isinstance(obj, dict):
        for v in obj.values():
            numeric_leaves(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            numeric_leaves(v, out)
    return out
