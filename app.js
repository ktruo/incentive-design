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

const manualControls = {
  mode: el("manualMode"),
  panel: el("manualPanel"),
  status: el("manualStatus"),
  hint: el("manualHint"),
  toggleRead: el("toggleRead"),
  togglePublish: el("togglePublish"),
  advanceRound: el("advanceRound"),
};

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function createState({
  nClinics,
  nPatients,
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

  return {
    rand,
    clinics,
    patients,
    histories,
    cfg: {
      readCost: 3,
      publishReward: 4,
      publishStake: 2,
      decayPerRound: 1,
      minCreditsToRead: 3,
      disputeProbability: 0.12,
      disputeThreshold: 0.45,
      slashAmount: 6,
      matchPoolRate: 0.5,
    },
    poolBalance: 0,
    totalReads: 0,
    totalPublishes: 0,
    playerReads: 0,
    playerPublishes: 0,
    playerQualityBias,
    round: 0,
  };
}

function stepRound(state, playerActions) {
  const { rand, clinics, patients, histories, cfg } = state;

  for (const clinic of clinics) {
    if (clinic.optedIn && clinic.credits > 0) {
      clinic.credits = Math.max(0, clinic.credits - cfg.decayPerRound);
    }
  }

  for (const clinic of clinics) {
    if (!clinic.optedIn) continue;

    const isPlayer = clinic.isPlayer;
    const wantsRead = isPlayer ? playerActions.read : rand() < 0.55;
    if (wantsRead && clinic.credits >= cfg.minCreditsToRead) {
      const pid = patients[Math.floor(rand() * patients.length)];
      if (clinic.credits >= cfg.readCost) {
        clinic.credits -= cfg.readCost;
        state.poolBalance += Math.floor(cfg.readCost * cfg.matchPoolRate);
        const list = histories.get(pid) || [];
        if (list.length) state.totalReads += 1;
        if (isPlayer && list.length) state.playerReads += 1;
      }
    }

    const needsCredits = clinic.credits < 6;
    const willPublish = isPlayer
      ? playerActions.publish
      : (!clinic.freeRide && (needsCredits || rand() < clinic.sharePropensity));

    if (willPublish && clinic.credits >= cfg.publishStake) {
      const pid = patients[Math.floor(rand() * patients.length)];
      clinic.credits -= cfg.publishStake;
      clinic.credits += cfg.publishReward;
      clinic.contrib += 1;

      const quality = isPlayer
        ? (rand() < playerActions.qualityBias ? 0.7 + rand() * 0.3 : 0.2 + rand() * 0.4)
        : (clinic.lowQuality && rand() < 0.6 ? 0.1 + rand() * 0.4 : 0.6 + rand() * 0.4);

      if (!histories.has(pid)) histories.set(pid, []);
      histories.get(pid).push({ quality, clinicId: clinic.id });
      state.totalPublishes += 1;
      if (isPlayer) state.playerPublishes += 1;

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
  if (contributors.length && state.poolBalance > 0) {
    const totalContrib = contributors.reduce((sum, c) => sum + c.contrib, 0);
    for (const c of contributors) {
      const share = Math.floor(state.poolBalance * (c.contrib / totalContrib));
      c.credits += share;
    }
    state.poolBalance = 0;
  }
  for (const c of clinics) c.contrib = 0;

  state.round += 1;
}

function buildStats(state) {
  const clinics = state.clinics;
  const player = clinics[0];
  const optedIn = clinics.filter((c) => c.optedIn).length;
  const avgCredits = clinics.reduce((sum, c) => sum + c.credits, 0) / clinics.length;
  const avgRep = clinics.reduce((sum, c) => sum + c.reputation, 0) / clinics.length;

  return {
    playerCredits: player.credits,
    playerReads: state.playerReads,
    playerPublishes: state.playerPublishes,
    playerReputation: player.reputation,
    optInRate: optedIn / clinics.length,
    totalReads: state.totalReads,
    totalPublishes: state.totalPublishes,
    avgCredits,
    avgRep,
    remainingClinics: optedIn,
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
  const state = createState({
    nClinics,
    nPatients,
    starterCredits,
    freeRiderFraction,
    lowQualityFraction,
    playerSharePropensity,
    playerQualityBias,
    seed,
  });

  for (let r = 0; r < rounds; r += 1) {
    const player = state.clinics[0];
    const needsCredits = player.credits < 6;
    const autoPublish = needsCredits || state.rand() < player.sharePropensity;
    const autoRead = state.rand() < 0.55;
    stepRound(state, {
      read: autoRead,
      publish: autoPublish,
      qualityBias: playerQualityBias,
    });
  }

  return buildStats(state);
}

function render(stats) {
  output.yourCredits.textContent = stats.playerCredits.toFixed(1);
  output.yourReads.textContent = stats.playerReads.toFixed(0);
  output.yourPublishes.textContent = stats.playerPublishes.toFixed(0);
  output.yourRep.textContent = stats.playerReputation.toFixed(2);
  output.optIn.textContent = `${stats.optInRate.toFixed(3)}`;
  output.networkActivity.textContent = `${stats.totalReads.toFixed(0)} reads / ${stats.totalPublishes.toFixed(0)} publishes`;
}

let manualState = null;
let manualActions = { read: false, publish: false };

function clearManualSelections() {
  manualControls.toggleRead.classList.remove("selected");
  manualControls.togglePublish.classList.remove("selected");
}

function syncManualUI() {
  const isManual = manualControls.mode.checked;
  document.body.classList.toggle("manual-mode", isManual);
  manualControls.panel.style.display = isManual ? "block" : "none";

  if (manualState && isManual) {
    const totalRounds = Number(form.rounds.value);
    manualControls.status.textContent = `Round ${manualState.round} of ${totalRounds}`;
    const status = [];
    if (manualActions.read) status.push("Read");
    if (manualActions.publish) status.push("Publish");
    manualControls.hint.textContent = status.length ? `Selected: ${status.join(", ")}` : "Select actions for this round.";
  } else {
    manualControls.status.textContent = "Round 0 of 0";
    manualControls.hint.textContent = "Select actions for this round, then advance.";
  }
}

function startManual() {
  manualState = createState({
    nClinics: Number(form.clinics.value),
    nPatients: Number(form.patients.value),
    starterCredits: Number(form.credits.value),
    freeRiderFraction: Number(form.freeRider.value) / 100,
    lowQualityFraction: Number(form.lowQuality.value) / 100,
    playerSharePropensity: Number(form.shareProp.value) / 100,
    playerQualityBias: Number(form.qualityBias.value) / 100,
    seed: 7,
  });
  manualActions = { read: false, publish: false };
  clearManualSelections();
  render(buildStats(manualState));
  syncManualUI();
}

function advanceManualRound() {
  if (!manualState) return;
  const totalRounds = Number(form.rounds.value);
  if (manualState.round >= totalRounds) {
    manualControls.hint.textContent = "Simulation complete. Reset or change settings.";
    return;
  }

  const qualityBias = Number(form.qualityBias.value) / 100;
  stepRound(manualState, {
    read: manualActions.read,
    publish: manualActions.publish,
    qualityBias,
  });
  manualActions = { read: false, publish: false };
  clearManualSelections();
  render(buildStats(manualState));
  syncManualUI();
}

function toggleAction(key, buttonEl) {
  manualActions[key] = !manualActions[key];
  buttonEl.classList.toggle("selected", manualActions[key]);
  syncManualUI();
}

function run() {
  if (manualControls.mode.checked) {
    startManual();
    return;
  }
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
manualControls.mode.addEventListener("change", () => {
  if (manualControls.mode.checked) {
    startManual();
  } else {
    manualState = null;
    manualActions = { read: false, publish: false };
    clearManualSelections();
  }
  syncManualUI();
});
manualControls.toggleRead.addEventListener("click", () => toggleAction("read", manualControls.toggleRead));
manualControls.togglePublish.addEventListener("click", () => toggleAction("publish", manualControls.togglePublish));
manualControls.advanceRound.addEventListener("click", advanceManualRound);

run();
