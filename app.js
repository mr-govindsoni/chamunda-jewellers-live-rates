const state = {
  data: null,
  activeView: "live",
  refreshTimer: null,
  renderCount: 0,
};

const elements = {
  refreshBtn: document.querySelector("#refreshBtn"),
  marketStatus: document.querySelector("#marketStatus"),
  sourceLine: document.querySelector("#sourceLine"),
  livePill: document.querySelector("#livePill"),
  internationalGrid: document.querySelector("#internationalGrid"),
  mcxTable: document.querySelector("#mcxTable"),
  jewelleryTable: document.querySelector("#jewelleryTable"),
  calcProduct: document.querySelector("#calcProduct"),
  calcWeight: document.querySelector("#calcWeight"),
  calcUnit: document.querySelector("#calcUnit"),
  calcTotal: document.querySelector("#calcTotal"),
};

const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatChange(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}${suffix}`;
}

function classForTrend(trend) {
  if (trend === "up") return "up";
  if (trend === "down") return "down";
  return "flat";
}

function trendArrow(trend) {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  return "●";
}

function trendLabel(trend) {
  if (trend === "up") return "Rate up";
  if (trend === "down") return "Rate down";
  return "Rate flat";
}

function rowMeta(row) {
  const high = row.high ? `H: ${formatNumber(row.high)}` : "H: --";
  const low = row.low ? `L: ${formatNumber(row.low)}` : "L: --";
  return `${high} | ${low}`;
}

function setLoading(isLoading) {
  elements.refreshBtn.classList.toggle("loading", isLoading);
  document.body.classList.toggle("is-loading", isLoading);
  elements.refreshBtn.disabled = isLoading;
}

function setView(viewName) {
  state.activeView = viewName;

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function renderInternational(rows = []) {
  const order = ["comexGold", "comexSilver", "usdInr"];
  const orderedRows = order.map((id) => rows.find((row) => row.id === id)).filter(Boolean);

  if (!orderedRows.length) {
    elements.internationalGrid.innerHTML =
      '<div class="empty-state">COMEX data abhi available nahi hai.</div>';
    return;
  }

  elements.internationalGrid.innerHTML = orderedRows
    .map(
      (row) => `
        <article class="quote-card trend-${row.trend}" aria-label="${row.name} ${trendLabel(row.trend)}">
          <h2>${row.name}</h2>
          <strong class="price-pop">${formatNumber(row.last, row.id === "usdInr" ? 3 : 2)}</strong>
          <div class="meta ${classForTrend(row.trend)}">
            <span class="trend-chip">${trendArrow(row.trend)}</span>
            <span>${formatChange(row.change)}</span>
            <span>|</span>
            <span>${formatChange(row.changePercent, "%")}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderMcx(rows = []) {
  if (!rows.length) {
    elements.mcxTable.innerHTML = '<div class="empty-state">MCX data abhi available nahi hai.</div>';
    return;
  }

  elements.mcxTable.innerHTML = rows
    .map(
      (row) => `
        <article class="rate-row trend-${row.trend}" aria-label="${row.name} ${trendLabel(row.trend)}">
          <div>
            <h3>${row.name}</h3>
            <small>${row.lastTrade || "Last trade --"}</small>
          </div>
          <div class="number-cell">
            <strong class="price-pop">${formatNumber(row.last)}</strong>
            <small>${rowMeta(row)}</small>
          </div>
          <div class="number-cell ${classForTrend(row.trend)}">
            <strong><span class="trend-arrow">${trendArrow(row.trend)}</span>${formatChange(row.change)}</strong>
            <small>${formatChange(row.changePercent, "%")}</small>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderJewellery(rows = []) {
  if (!rows.length) {
    elements.jewelleryTable.innerHTML =
      '<div class="empty-state">Jewellery rates abhi calculate nahi ho pa rahe.</div>';
    return;
  }

  elements.jewelleryTable.innerHTML = rows
    .map(
      (row) => `
        <article class="rate-row jewellery-row">
          <div>
            <h3>${row.name}</h3>
            <small>Purity: ${row.purity || "--"}</small>
          </div>
          <div class="number-cell">
            <strong>${formatNumber(row.buy, 0)}</strong>
            <small>H: ${formatNumber(row.high, 0)}</small>
          </div>
          <div class="number-cell">
            <strong>${formatNumber(row.sell, 0)}</strong>
            <small>L: ${formatNumber(row.low, 0)}</small>
          </div>
        </article>
      `,
    )
    .join("");
}

function getCalculatorRate() {
  const data = state.data;
  if (!data) return null;

  const product = elements.calcProduct.value;
  const gold = data.jewellery?.find((row) => row.name === "24 Carat Gold");
  const gold22 = data.jewellery?.find((row) => row.name === "22 Carat Jewellery HUID");
  const gold18 = data.jewellery?.find((row) => row.name === "18 Carat Jewellery HUID");
  const silver = data.jewellery?.find((row) => row.name === "Silver Chorsa / Bartan");

  if (product === "gold") return { rate: gold?.sell, per: 10 };
  if (product === "gold22") return { rate: gold22?.sell, per: 10 };
  if (product === "gold18") return { rate: gold18?.sell, per: 10 };
  return { rate: silver?.sell, per: 1_000 };
}

function renderCalculator() {
  const weight = Number(elements.calcWeight.value);
  const unit = elements.calcUnit.value;
  const rateInfo = getCalculatorRate();

  if (!rateInfo?.rate || !Number.isFinite(weight) || weight <= 0) {
    elements.calcTotal.textContent = "--";
    return;
  }

  const grams = unit === "tola" ? weight * 11.6638 : unit === "kg" ? weight * 1000 : weight;
  const total = (rateInfo.rate / rateInfo.per) * grams;
  elements.calcTotal.textContent = rupeeFormatter.format(total);
}

function render(data) {
  state.data = data;
  state.renderCount += 1;
  const fetchedDate = data.source?.fetchedAt ? new Date(data.source.fetchedAt) : null;
  const localTime = fetchedDate
    ? fetchedDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "--";

  elements.marketStatus.textContent = data.stale
    ? "Cached rates dikh rahe hain"
    : "Rates updated";
  elements.sourceLine.textContent = data.source?.sourceTimestamp
    ? `${data.source.name} + ${data.source.comexProvider || "COMEX"} | As on ${
        data.source.sourceTimestamp
      }`
    : `${data.source?.name || "Source"} | fetched ${localTime}`;
  elements.livePill.classList.toggle("stale", Boolean(data.stale));
  elements.livePill.lastChild.textContent = data.stale ? " CACHED" : " LIVE";

  renderInternational(data.international);
  renderMcx(data.mcx);
  renderJewellery(data.jewellery);
  renderCalculator();

  document.body.classList.remove("rates-updated");
  window.requestAnimationFrame(() => {
    document.body.classList.add("rates-updated");
  });
}

async function loadRates() {
  setLoading(true);
  try {
    const response = await fetch("/api/rates", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Rates load nahi ho paaye");
    }
    render(data);
  } catch (error) {
    elements.marketStatus.textContent = "Rates load nahi ho paaye";
    elements.sourceLine.textContent = error.message;
    elements.livePill.classList.add("stale");
    elements.livePill.lastChild.textContent = " OFFLINE";
  } finally {
    setLoading(false);
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

elements.refreshBtn.addEventListener("click", loadRates);
elements.calcProduct.addEventListener("change", renderCalculator);
elements.calcWeight.addEventListener("input", renderCalculator);
elements.calcUnit.addEventListener("change", renderCalculator);

loadRates();
state.refreshTimer = window.setInterval(loadRates, 30_000);
