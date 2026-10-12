"""Stateless island simulator. The trace is a pure function of (scenario, seed, step, executed actions)."""
from __future__ import annotations
import hashlib, json, random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

DT_S = 60
DT_H = DT_S / 3600
SIM_EPOCH = datetime(2026, 10, 12, 2, 0, 0, tzinfo=timezone.utc)
PROD_TRIGGER_V = 210.0   # production target drops when lagged voltage is below this (scenario setting)


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str = ""
    description: str = ""
    seed: int = 42
    n_steps: int = 720
    capacity: float = 20_000
    start_volume: float = 12_000
    critical: float = 3_000
    prod_normal: float = 800
    prod_disrupted: float = 200
    demand_normal: float = 650
    demand_incident: float = 850
    demand_conserved: float = 700
    v_nominal: float = 230
    v_dip: float = 190
    dip_start: int | None = None
    demand_rise_start: int | None = None
    prod_lag: int = 6
    ramp: int = 5
    tank_sensor_fail_at: int | None = None


SCENARIOS = {
    "normal": Scenario(id="normal", title="Normal operations",
                       description="Stable power, production and demand. No incident should appear."),
    "power-water": Scenario(id="power-water", title="Power instability reduces water supply",
                            description="Voltage dips at step 20, pumping output falls, demand rises: the reserve starts to deplete.",
                            dip_start=20, demand_rise_start=30),
    "sensor-fault": Scenario(id="sensor-fault", title="Tank sensor fault",
                             description="The tank level sensor stops reporting at step 40: the reserve forecast must be withheld.",
                             tank_sensor_fail_at=40),
}


def _ramp(k, start, steps, a, b):
    if start is None or k < start:
        return a
    return a + (b - a) * min(1.0, (k - start) / max(1, steps))


def voltage_true(sc, k, acts):
    v = _ramp(k, sc.dip_start, sc.ramp, sc.v_nominal, sc.v_dip)
    s = acts.get("restore_power_feed")
    if s is not None and k > s:
        v_at_s = _ramp(s, sc.dip_start, sc.ramp, sc.v_nominal, sc.v_dip)
        v = _ramp(k, s + 1, sc.ramp, v_at_s, sc.v_nominal)
    return v


def demand_true(sc, k, acts):
    d = _ramp(k, sc.demand_rise_start, sc.ramp, sc.demand_normal, sc.demand_incident)
    s = acts.get("conserve_demand")
    if s is not None and k > s:
        d_at_s = _ramp(s, sc.demand_rise_start, sc.ramp, sc.demand_normal, sc.demand_incident)
        d = _ramp(k, s + 1, sc.ramp, d_at_s, sc.demand_conserved)
    return d


def _noise(sc, k, ch, amp):
    return random.Random(f"{sc.seed}:{k}:{ch}").uniform(-amp, amp)


def build_trace(sc: Scenario, upto: int, acts: dict[str, int]) -> list[dict]:
    """acts maps an allowlisted command to the step at which it was executed."""
    upto = max(0, min(upto, sc.n_steps - 1))
    rows, vol, prod, v_hist = [], sc.start_volume, sc.prod_normal, []
    rate = (sc.prod_normal - sc.prod_disrupted) / max(1, sc.ramp)
    for k in range(upto + 1):
        v_hist.append(voltage_true(sc, k, acts))
        lagged = v_hist[k - sc.prod_lag] if k >= sc.prod_lag else sc.v_nominal
        target = sc.prod_disrupted if lagged < PROD_TRIGGER_V else sc.prod_normal
        prod += max(-rate, min(rate, target - prod))
        dem = demand_true(sc, k, acts)
        nxt = vol + (prod - dem) * DT_H
        spill, unmet = max(0.0, nxt - sc.capacity), max(0.0, -nxt)
        nxt = min(max(nxt, 0.0), sc.capacity)
        in_eff, out_eff = prod - spill / DT_H, dem - unmet / DT_H
        obs = {
            "voltage": (v_hist[k] + _noise(sc, k, "v", 1.5), "V"),
            "inflow": (in_eff + _noise(sc, k, "in", 10), "L/h"),
            "outflow": (out_eff + _noise(sc, k, "out", 10), "L/h"),
            "production_power": (0.0225 * prod + _noise(sc, k, "kw", 0.15), "kW"),
        }
        if sc.tank_sensor_fail_at is None or k < sc.tank_sensor_fail_at:
            obs["tank_volume"] = (vol + _noise(sc, k, "tank", 15), "L")
        rows.append({"step": k, "sim_time": (SIM_EPOCH + timedelta(seconds=k * DT_S)).isoformat(),
                     "obs": obs, "latent": {"volume": vol, "production": prod, "demand": dem}})
        vol = nxt
    return rows


def trace_hash(rows) -> str:
    return hashlib.sha256(json.dumps([r["obs"] for r in rows], sort_keys=True).encode()).hexdigest()
