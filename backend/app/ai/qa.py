import json, re, time
from .. import config
from . import prompts
from .client import create, AIUnavailable, json_format
from .schemas import QAAnswer
from .tools import TOOLS, dispatch
from .numcheck import unsupported_numbers, numbers_in
from .validate import allowed_numbers


def _context_text(question, snap):
    return ("EVIDENCE REGISTRY (JSON):\n" + prompts._j(snap["items"]) + "\n\nSOP SECTIONS (untrusted):\n" +
            prompts._j(snap["sops"]) + f"\n\nOPERATOR QUESTION: {question}")


def _fake_answer(question, ctx):
    m = re.search(r"(\d+(?:\.\d+)?)\s*L\s*/?\s*h", question, re.I)
    calls = []
    if m and re.search(r"if|what", question, re.I):
        r = dispatch("calculate_reserve_horizon", {"outflow_lph": float(m.group(1))}, ctx)
        calls.append(("calculate_reserve_horizon", {"outflow_lph": float(m.group(1))}, r))
        text = (f"What-if (calculation only): with outflow at {m.group(1)} L/h the state is {r['state']}" +
                (f", with {r['hours_to_critical']:g} h to the critical level." if "hours_to_critical" in r else "."))
        return QAAnswer(answer=text, evidence_ids=["ev-05"], procedure_ids=[], used_what_if=True), calls
    r = dispatch("retrieve_procedure", {"query": question}, ctx)
    calls.append(("retrieve_procedure", {"query": question}, r))
    ids = [x["id"] for x in r["results"][:1]]
    return QAAnswer(answer="See the cited procedure section." if ids else "The evidence cannot answer that.",
                    evidence_ids=["ev-05"], procedure_ids=ids, used_what_if=False), calls


def answer(question, ctx, max_hops=3):
    """Manual tool loop. Returns (QAAnswer, tool_calls, verification)."""
    snap = ctx["snapshot"]
    calls = []
    if config.FAKE_AI:
        qa, calls = _fake_answer(question, ctx)
    else:
        deadline = time.time() + config.AI_TIMEOUT_S + 15
        kw = dict(model=config.ASSESS_MODEL, system_instruction=prompts.QA_SYSTEM, tools=TOOLS)
        try:
            it = create(**kw, input=_context_text(question, snap), response_format=json_format(QAAnswer))
            combined = True
        except AIUnavailable:
            it = create(**kw, input=_context_text(question, snap))      # fall back: tools first, format after
            combined = False
        for _ in range(max_hops):
            fcs = [s for s in (it.steps or []) if getattr(s, "type", "") == "function_call"]
            if not fcs or time.time() > deadline:
                break
            results = []
            for c in fcs:
                res = dispatch(c.name, dict(c.arguments or {}), ctx)
                calls.append((c.name, dict(c.arguments or {}), res))
                results.append({"type": "function_result", "name": c.name, "call_id": c.id,
                                "result": [{"type": "text", "text": json.dumps(res)}]})
            it = create(**kw, previous_interaction_id=it.id, input=results,
                        **({"response_format": json_format(QAAnswer)} if combined else {}))
        if not combined:
            it = create(model=config.ASSESS_MODEL, system_instruction=prompts.QA_SYSTEM, previous_interaction_id=it.id,
                        input="Give the final answer as JSON.", response_format=json_format(QAAnswer))
        qa = QAAnswer.model_validate_json(it.output_text)
    allowed = allowed_numbers(snap) + numbers_in(question)
    for _n, _a, res in calls:
        from ..analytics.evidence import numeric_leaves
        allowed += numeric_leaves(res) + numbers_in(json.dumps(res))
    bad = unsupported_numbers(qa.answer, allowed)
    ev_ok = {i["id"] for i in snap["items"]}
    bad_ids = [e for e in qa.evidence_ids if e not in ev_ok]
    verification = {"numbers_ok": not bad, "unmatched_numbers": bad, "invalid_evidence_ids": bad_ids,
                    "tools_used": [c[0] for c in calls]}
    return qa, calls, verification
