from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
import random
import time


# ---------------------------------
# Incentive design under competition
# ---------------------------------

@dataclass
class HistoryEntry:
    patient_id: str
    author_clinic_id: str
    summary: str
    quality_score: float
    timestamp: float = field(default_factory=lambda: time.time())
    stake: int = 0
    redacted_author: bool = True  # hides identity to reduce reputational fear


@dataclass
class AccessToken:
    patient_id: str
    issued_to_clinic_id: str
    expires_at: float
    encounter_bound: bool = True  # must be tied to an active patient encounter


@dataclass
class Clinic:
    clinic_id: str
    credits: int
    reputation: float = 1.0
    opted_in: bool = True
    share_propensity: float = 0.7
    free_ride: bool = False
    low_quality: bool = False
    last_round_contribution: int = 0


class ReciprocityEngine:
    def __init__(
        self,
        read_cost: int = 3,
        publish_reward: int = 4,
        publish_stake: int = 2,
        decay_per_round: int = 1,
        min_credits_to_read: int = 3,
        dispute_probability: float = 0.12,
        dispute_threshold: float = 0.45,
        slash_amount: int = 6,
        match_pool_rate: float = 0.5,
    ):
        self.read_cost = read_cost
        self.publish_reward = publish_reward
        self.publish_stake = publish_stake
        self.decay_per_round = decay_per_round
        self.min_credits_to_read = min_credits_to_read
        self.dispute_probability = dispute_probability
        self.dispute_threshold = dispute_threshold
        self.slash_amount = slash_amount
        self.match_pool_rate = match_pool_rate

        self.clinics: Dict[str, Clinic] = {}
        self.patient_histories: Dict[str, List[HistoryEntry]] = {}
        self.access_log: List[Tuple[float, str, str]] = []
        self.pool_balance: int = 0

    def add_clinic(self, clinic: Clinic) -> None:
        self.clinics[clinic.clinic_id] = clinic

    def issue_patient_token(self, patient_id: str, clinic_id: str, ttl_seconds: int = 3600) -> AccessToken:
        return AccessToken(
            patient_id=patient_id,
            issued_to_clinic_id=clinic_id,
            expires_at=time.time() + ttl_seconds,
            encounter_bound=True,
        )

    def can_read(self, clinic_id: str, token: AccessToken) -> bool:
        clinic = self.clinics[clinic_id]
        if not clinic.opted_in:
            return False
        if token.issued_to_clinic_id != clinic_id:
            return False
        if time.time() > token.expires_at:
            return False
        if clinic.credits < self.min_credits_to_read:
            return False
        return True

    def read_history(self, clinic_id: str, token: AccessToken) -> List[HistoryEntry]:
        if not self.can_read(clinic_id, token):
            return []

        clinic = self.clinics[clinic_id]
        if clinic.credits < self.read_cost:
            return []

        clinic.credits -= self.read_cost
        # portion goes to a shared pool that rewards contributors
        self.pool_balance += int(self.read_cost * self.match_pool_rate)
        self.access_log.append((time.time(), clinic_id, token.patient_id))
        return list(self.patient_histories.get(token.patient_id, []))

    def publish_history(self, clinic_id: str, entry: HistoryEntry) -> bool:
        clinic = self.clinics[clinic_id]
        if not clinic.opted_in:
            return False
        if clinic.credits < self.publish_stake:
            return False

        clinic.credits -= self.publish_stake
        entry.stake = self.publish_stake

        clinic.credits += self.publish_reward
        clinic.last_round_contribution += 1
        self.patient_histories.setdefault(entry.patient_id, []).append(entry)

        if random.random() < self.dispute_probability:
            self._maybe_dispute(entry)
        return True

    def _maybe_dispute(self, entry: HistoryEntry) -> None:
        if entry.quality_score < self.dispute_threshold:
            author = self.clinics[entry.author_clinic_id]
            penalty = min(self.slash_amount, author.credits)
            author.credits -= penalty
            author.reputation *= 0.9

    def decay_credits(self) -> None:
        for clinic in self.clinics.values():
            if clinic.opted_in and clinic.credits > 0:
                clinic.credits = max(0, clinic.credits - self.decay_per_round)

    def distribute_pool(self) -> None:
        contributors = [c for c in self.clinics.values() if c.last_round_contribution > 0]
        if not contributors or self.pool_balance <= 0:
            for c in self.clinics.values():
                c.last_round_contribution = 0
            return

        total_contribs = sum(c.last_round_contribution for c in contributors)
        for clinic in contributors:
            share = int(self.pool_balance * (clinic.last_round_contribution / total_contribs))
            clinic.credits += share
        self.pool_balance = 0
        for c in self.clinics.values():
            c.last_round_contribution = 0

    def opt_in_rate(self) -> float:
        if not self.clinics:
            return 0.0
        return sum(1 for c in self.clinics.values() if c.opted_in) / len(self.clinics)


def simulate(
    n_clinics: int = 200,
    n_patients: int = 400,
    rounds: int = 45,
    starter_credits: int = 10,
    free_rider_fraction: float = 0.18,
    low_quality_fraction: float = 0.10,
    seed: int = 7,
) -> Dict[str, float]:
    random.seed(seed)

    engine = ReciprocityEngine(
        read_cost=3,
        publish_reward=4,
        publish_stake=2,
        decay_per_round=1,
        min_credits_to_read=3,
        dispute_probability=0.12,
        dispute_threshold=0.45,
        slash_amount=6,
        match_pool_rate=0.5,
    )

    for i in range(n_clinics):
        cid = f"C{i:03d}"
        free_ride = random.random() < free_rider_fraction
        low_quality = (not free_ride) and (random.random() < low_quality_fraction)
        share_propensity = 0.75 if not free_ride else 0.05

        engine.add_clinic(Clinic(
            clinic_id=cid,
            credits=starter_credits,
            opted_in=True,
            share_propensity=share_propensity,
            free_ride=free_ride,
            low_quality=low_quality,
        ))

    patients = [f"P{i:04d}" for i in range(n_patients)]

    total_reads = 0
    total_publishes = 0

    for _ in range(rounds):
        engine.decay_credits()

        for clinic in list(engine.clinics.values()):
            if not clinic.opted_in:
                continue

            if random.random() < 0.55:
                pid = random.choice(patients)
                token = engine.issue_patient_token(pid, clinic.clinic_id)
                hist = engine.read_history(clinic.clinic_id, token)
                if hist:
                    total_reads += 1

            needs_credits = clinic.credits < 6
            will_publish = (not clinic.free_ride) and (
                needs_credits or (random.random() < clinic.share_propensity)
            )

            if will_publish:
                pid = random.choice(patients)
                if clinic.low_quality and random.random() < 0.6:
                    q = random.uniform(0.1, 0.5)
                    summary = "Generic note: exercises advised. (low detail)"
                else:
                    q = random.uniform(0.6, 1.0)
                    summary = "Structured summary: Dx, red flags checked, plan-of-care, response, discharge status."

                ok = engine.publish_history(clinic.clinic_id, HistoryEntry(
                    patient_id=pid,
                    author_clinic_id=clinic.clinic_id,
                    summary=summary,
                    quality_score=q,
                    redacted_author=True,
                ))
                if ok:
                    total_publishes += 1

            if clinic.credits < 3 and random.random() < 0.05:
                if clinic.free_ride or clinic.reputation < 0.7:
                    clinic.opted_in = False

        engine.distribute_pool()

    opt_in = engine.opt_in_rate()
    avg_credits = sum(c.credits for c in engine.clinics.values()) / len(engine.clinics)
    avg_rep = sum(c.reputation for c in engine.clinics.values()) / len(engine.clinics)

    return {
        "opt_in_rate": opt_in,
        "total_reads": float(total_reads),
        "total_publishes": float(total_publishes),
        "avg_credits": float(avg_credits),
        "avg_reputation": float(avg_rep),
        "remaining_clinics": float(sum(1 for c in engine.clinics.values() if c.opted_in)),
    }


def run_demo() -> None:
    stats = simulate()
    print("Project 1: Incentive Design Under Adversarial Conditions")
    print("Simulation results:")
    for k, v in stats.items():
        if "rate" in k:
            print(f"- {k}: {v:.3f}")
        else:
            print(f"- {k}: {v:.1f}")


if __name__ == "__main__":
    run_demo()
