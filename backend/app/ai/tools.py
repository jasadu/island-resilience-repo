import json
from ..analytics.reserve import reserve_horizon
from .. import sops as sopmod

CHANNELS = ("voltage", "inflow", "outflow", "tank_volume", "production_power")

TOOLS = [
    {"type": "function", "name": "get_telemetry_window",
     "description": "Observed telemetry for one metric between two simulation steps (max 30 steps, never beyond the current step).",
     "parameters": {"type": "object", "properties": {
         "metric": {"type": "string", "enum": list(CHANNELS)},
         "start_step": {"type": "integer"}, "end_step": {"type": "integer"}},
         "required": ["metric", "start_step", "end_step"]}},
    {"type": "function", "name": "calculate_reserve_horizon",
     "description": "Compute hours to critical reserve and to empty. Optional overrides make it a what-if; it never changes the live system.",
     "parameters": {"type": "object", "properties": {
         "inflow_lph": {"type": "number"}, "outflow_lph": {"type": "number"},
         "volume_l": {"type": "number"}, "critical_l": {"type": "number"}}}},
    {"type": "function", "name": "retrieve_procedure",
     "description": "Keyword search over the demo SOP sections. Returns section ids, text and a match score.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
]


def dispatch(name, args, ctx):
    """ctx: {sc, rows (trace up to current step), snapshot}. The model cannot choose a run or mutate state."""
    if name == "get_telemetry_window":
        m = args.get("metric")
        if m not in CHANNELS:
            return {"error": "unknown metric"}
        cur = ctx["rows"][-1]["step"]
        e = min(int(args.get("end_step", cur)), cur)
        s = max(int(args.get("start_step", e - 9)), e - 29, 0)
        out = [{"step": r["step"], "value": round(r["obs"][m][0], 2), "unit": r["obs"][m][1]}
               for r in ctx["rows"] if s <= r["step"] <= e and m in r["obs"]]
        return {"metric": m, "start_step": s, "end_step": e, "readings": out}
    if name == "calculate_reserve_horizon":
        items = {i["id"]: i["values"] for i in ctx["snapshot"]["items"]}
        vol = args.get("volume_l", items["ev-04"].get("last"))
        inflow = args.get("inflow_lph", items["ev-02"].get("mean"))
        outflow = args.get("outflow_lph", items["ev-03"].get("mean"))
        crit = args.get("critical_l", ctx["sc"].critical)
        res = reserve_horizon(vol, inflow, outflow, crit, 1.0 if all(x is not None for x in (vol, inflow, outflow)) else 0.0)
        res = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items()}
        res["inputs"] = {"volume_l": vol, "inflow_lph": inflow, "outflow_lph": outflow, "critical_l": crit,
                         "overridden": [k for k in ("volume_l", "inflow_lph", "outflow_lph", "critical_l") if k in args]}
        return res
    if name == "retrieve_procedure":
        return {"results": [{"id": s["id"], "title": s["title"], "text": s["text"], "score": s["score"]}
                            for s in sopmod.retrieve(args.get("query", ""))]}
    return {"error": "unknown tool"}
