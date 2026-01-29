const defaults = {
  clinics: 200,
  patients: 400,
  rounds: 30,
  credits: 10,
  freeRider: 18,
  lowQuality: 10,
  shareProp: 70,
  qualityBias: 80,
};

const el = (id) => document.getElementById(id);

const form = {
  clinics: el("clinics"),
  patients: el("patients"),
  rounds: el("rounds"),
  credits: el("credits"),
  freeRider: el("freeRider"),
  lowQuality: el("lowQuality"),
  shareProp: el("shareProp"),
  qualityBias: el("qualityBias"),
};

const output = {
  yourCredits: el("yourCredits"),
  yourReads: el("yourReads"),
  yourPublishes: el("yourPublishes"),
  yourRep: el("yourRep"),
  optIn: el("optIn"),
  networkActivity: el("networkActivity"),
};

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function simulate({
  nClinics,
  nPatients,
  rounds,
  starterCredits,
  freeRiderFraction,
  lowQualityFraction,
  playerSharePropensity,
  playerQualityBias,
  seed = 7,
}) {
  const rand = seededRng(seed);

  const clinics = Array.from({ length: nClinics }, (_, i) => {
    const freeRide = rand() < freeRiderFraction;
    const lowQuality = !freeRide && rand() < lowQualityFraction;
    return {
      id: `C${String(i).padStart(3, "0")}`,
      credits: starterCredits,
      reputation: 1.0,
      optedIn: true,
      sharePropensity: freeRide ? 0.05 : 0.75,
      freeRide,
      lowQuality,
      contrib: 0,
      isPlayer: i === 0,
    };
  });

  const player = clinics[0];
  player.freeRide = false;
  player.lowQuality = false;
  player.sharePropensity = playerSharePropensity;

  const patients = Array.from({ length: nPatients }, (_, i) => `P${String(i).padStart(4, "0")}`);
  const histories = new Map();

  const cfg = {
    readCost: 3,
    publishReward: 4,
    publishStake: 2,
    decayPerRound: 1,
    minCreditsToRead: 3,
    disputeProbability: 0.12,
    disputeThreshold: 0.45,
    slashAmount: 6,
    matchPoolRate: 0.5,
  };

  let poolBalance = 0;
  let totalReads = 0;
  let totalPublishes = 0;
  let playerReads = 0;
  let playerPublishes = 0;

  for (let r = 0; r < rounds; r += 1) {
    for (const clinic of clinics) {
      if (clinic.optedIn && clinic.credits > 0) {
        clinic.credits = Math.max(0, clinic.credits - cfg.decayPerRound);
      }
    }

    for (const clinic of clinics) {
      if (!clinic.optedIn) continue;

      if (rand() < 0.55 && clinic.credits >= cfg.minCreditsToRead) {
        const pid = patients[Math.floor(rand() * patients.length)];
        if (clinic.credits >= cfg.readCost) {
          clinic.credits -= cfg.readCost;
          poolBalance += Math.floor(cfg.readCost * cfg.matchPoolRate);
          const list = histories.get(pid) || [];
          if (list.length) totalReads += 1;
          if (clinic.isPlayer && list.length) playerReads += 1;
        }
      }

      const needsCredits = clinic.credits < 6;
      const willPublish = !clinic.freeRide && (needsCredits || rand() < clinic.sharePropensity);

      if (willPublish && clinic.credits >= cfg.publishStake) {
        const pid = patients[Math.floor(rand() * patients.length)];
        clinic.credits -= cfg.publishStake;
        clinic.credits += cfg.publishReward;
        clinic.contrib += 1;

        const quality = clinic.isPlayer
          ? (rand() < playerQualityBias ? 0.7 + rand() * 0.3 : 0.2 + rand() * 0.4)
          : (clinic.lowQuality && rand() < 0.6 ? 0.1 + rand() * 0.4 : 0.6 + rand() * 0.4);

        if (!histories.has(pid)) histories.set(pid, []);
        histories.get(pid).push({ quality, clinicId: clinic.id });
        totalPublishes += 1;
        if (clinic.isPlayer) playerPublishes += 1;

        if (rand() < cfg.disputeProbability && quality < cfg.disputeThreshold) {
          const penalty = Math.min(cfg.slashAmount, clinic.credits);
          clinic.credits -= penalty;
          clinic.reputation *= 0.9;
        }
      }

      if (clinic.credits < 3 && rand() < 0.05) {
        if (clinic.freeRide || clinic.reputation < 0.7) {
          clinic.optedIn = false;
        }
      }
    }

    const contributors = clinics.filter((c) => c.contrib > 0);
    if (contributors.length && poolBalance > 0) {
      const totalContrib = contributors.reduce((sum, c) => sum + c.contrib, 0);
      for (const c of contributors) {
        const share = Math.floor(poolBalance * (c.contrib / totalContrib));
        c.credits += share;
      }
      poolBalance = 0;
    }
    for (const c of clinics) c.contrib = 0;
  }

  const optedIn = clinics.filter((c) => c.optedIn).length;
  const avgCredits = clinics.reduce((sum, c) => sum + c.credits, 0) / clinics.length;
  const avgRep = clinics.reduce((sum, c) => sum + c.reputation, 0) / clinics.length;

  return {
    playerCredits: player.credits,
    playerReads,
    playerPublishes,
    playerReputation: player.reputation,
    optInRate: optedIn / clinics.length,
    totalReads,
    totalPublishes,
    avgCredits,
    avgRep,
    remainingClinics: optedIn,
  };
}

function render(stats) {
  output.yourCredits.textContent = stats.playerCredits.toFixed(1);
  output.yourReads.textContent = stats.playerReads.toFixed(0);
  output.yourPublishes.textContent = stats.playerPublishes.toFixed(0);
  output.yourRep.textContent = stats.playerReputation.toFixed(2);
  output.optIn.textContent = `${stats.optInRate.toFixed(3)}`;
  output.networkActivity.textContent = `${stats.totalReads.toFixed(0)} reads / ${stats.totalPublishes.toFixed(0)} publishes`;
}

function run() {
  const stats = simulate({
    nClinics: Number(form.clinics.value),
    nPatients: Number(form.patients.value),
    rounds: Number(form.rounds.value),
    starterCredits: Number(form.credits.value),
    freeRiderFraction: Number(form.freeRider.value) / 100,
    lowQualityFraction: Number(form.lowQuality.value) / 100,
    playerSharePropensity: Number(form.shareProp.value) / 100,
    playerQualityBias: Number(form.qualityBias.value) / 100,
  });
  render(stats);
}

function reset() {
  Object.entries(defaults).forEach(([key, value]) => {
    form[key].value = value;
  });
  run();
}

el("runBtn").addEventListener("click", run);
el("resetBtn").addEventListener("click", reset);

run();
