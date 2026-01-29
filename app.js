const ranges = {
  shares: document.getElementById("sharesRange"),
  reads: document.getElementById("readsRange"),
  details: document.getElementById("detailRange"),
};

const values = {
  shares: document.getElementById("sharesValue"),
  reads: document.getElementById("readsValue"),
  details: document.getElementById("detailValue"),
  earned: document.getElementById("earnedPoints"),
  spent: document.getElementById("spentPoints"),
  net: document.getElementById("netPoints"),
};

const honorValue = document.getElementById("honorValue");
const stars = Array.from(document.querySelectorAll(".star"));

const RATES = {
  earnPerShare: 5,
  spendStandard: 3,
  spendDetail: 8,
};

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function updateCalculator() {
  const shares = Number(ranges.shares.value);
  const reads = Number(ranges.reads.value);
  const details = Number(ranges.details.value);

  values.shares.textContent = shares;
  values.reads.textContent = reads;
  values.details.textContent = details;

  const earned = shares * RATES.earnPerShare;
  const spent = reads * RATES.spendStandard + details * RATES.spendDetail;
  const net = earned - spent;

  values.earned.textContent = formatNumber(earned);
  values.spent.textContent = formatNumber(spent);
  values.net.textContent = formatNumber(net);
}

function setHonor(value) {
  stars.forEach((star) => {
    const starValue = Number(star.dataset.value);
    star.classList.toggle("is-active", starValue <= value);
  });
  honorValue.textContent = `Private honor set to ${value} ${value === 1 ? "star" : "stars"}`;
}

ranges.shares.addEventListener("input", updateCalculator);
ranges.reads.addEventListener("input", updateCalculator);
ranges.details.addEventListener("input", updateCalculator);

stars.forEach((star) => {
  star.addEventListener("click", () => {
    setHonor(Number(star.dataset.value));
  });
});

setHonor(4);
updateCalculator();
