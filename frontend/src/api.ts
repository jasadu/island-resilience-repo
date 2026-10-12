export type Reading = { value: number | null; unit: string; age_steps: number | null };
export type SeriesPt = { step: number; tank_volume: number | null; inflow: number | null; outflow: number | null; voltage: number | null; production_power: number | null };
export type Horizon = { state: "unavailable" | "below_critical" | "no_depletion" | "depleting"; hours_to_critical?: number; hours_to_empty?: number; net_drawdown_lph?: number; coverage: number };
export type Hypothesis = { hyp_id: string; cause: string; evidence_ids: string[]; status: string; flag: string | null };
export type Action = { action_id: string; title: string; owner_role: string; priority: number; rationale: string; prerequisites: string[]; evidence_ids: string[]; procedure_ids: string[]; requires_approval: boolean; simulated_command: string; flag: string | null };
export type Assessment = { summary: string; hypotheses: Hypothesis[]; data_quality: string; missing_evidence: string[]; actions: Action[]; limitations: string[]; evidence_ids: string[] };
export type EvidenceItem = { id: string; kind: string; label: string; step_range: [number, number]; values: Record<string, unknown> };
export type Doc = {
  id: string; step: number; stage: string; source?: string; ai_status?: string; calls: number; snapshot_hash: string;
  assessment: Assessment | null; timeline: { stage: string; model: string; latency_ms: number; ok: boolean; note: string }[];
  verification: { status: string; claims_total?: number; supported?: number; removed?: { item_id: string; reason: string; source: string }[]; partially_supported?: { item_id: string; reason: string }[]; repaired?: boolean; reason?: string };
  fallback_checklist?: { id: string; title: string; text: string }[];
  snapshot: { items: EvidenceItem[]; sops: { id: string; title: string; text: string; banner: string }[]; step: number };
};
export type State = {
  run: { id: string; scenario_id: string; state: "playing" | "paused"; current_step: number; speed: number; ai_calls: number; qa_calls: number };
  scenario: { id: string; title: string; n_steps: number; critical_L: number; capacity_L: number };
  sim_time: string; series: SeriesPt[]; latest: Record<string, Reading>; horizon: Horizon;
  detection: { state: "none" | "active" | "resolved"; started_step: number | null; resolved_step: number | null; active_rules: string[]; first_fired: Record<string, number | null>; severity: string };
  incident: { id: string; checkpoint_step: number; state: string } | null;
  assessment: (Partial<Doc> & { id: string; step: number; stage: string }) | null;
  new_evidence: boolean;
  actions: Record<string, { step: number; status: string | null }>;
  approvals: Record<string, { assessment_id: string; command: string; approved_step: number }>;
};
export type Scenario = { id: string; title: string; description: string };
export type QAResp = { answer: { answer: string; evidence_ids: string[]; procedure_ids: string[]; used_what_if: boolean }; tool_calls: { name: string; arguments: unknown; result: unknown }[]; verification: { numbers_ok: boolean; unmatched_numbers: number[]; tools_used: string[] } };

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail ?? msg; } catch { /* ignore */ }
    throw Object.assign(new Error(String(msg)), { status: r.status });
  }
  return r.json();
}
const post = <T,>(p: string, body?: unknown) => j<T>(p, { method: "POST", body: JSON.stringify(body ?? {}) });

export const api = {
  scenarios: () => j<Scenario[]>("/scenarios"),
  newRun: (scenario_id: string) => post<{ run_id: string }>("/runs", { scenario_id }),
  control: (id: string, body: object) => post<{ run_id: string; current_step: number; state: string }>(`/runs/${id}/control`, body),
  state: (id: string) => j<State>(`/runs/${id}/state`),
  advance: (id: string, force_live: boolean) => post<Doc>(`/runs/${id}/pipeline/advance`, { force_live }),
  approve: (id: string, action: string, assessment_id: string) => post(`/runs/${id}/actions/${action}/approve`, { assessment_id }),
  simulate: (id: string, action: string) => post(`/runs/${id}/actions/${action}/simulate`),
  ask: (id: string, question: string) => post<QAResp>(`/runs/${id}/qa`, { question }),
  reportUrl: (id: string, fmt: "md" | "json") => `/api/runs/${id}/report?format=${fmt}`,
};
