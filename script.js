const el = (id) => document.getElementById(id);
const lastSignals = { btc: null, sol: null };

function paintCard(prefix, data) {
  el(`${prefix}-price`).textContent = data.price;
  el(`${prefix}-change`).textContent = data.change;
  el(`${prefix}-volume`).textContent = data.volume;
  el(`${prefix}-trend`).textContent = data.trend;
  el(`${prefix}-support`).textContent = data.support;
  el(`${prefix}-resistance`).textContent = data.resistance;
  el(`${prefix}-sentiment`).textContent = data.sentiment;
  el(`${prefix}-justification`).textContent = data.justification;

  const chip = el(`${prefix}-signal`);
  chip.textContent = data.signal;
  chip.classList.remove("buy", "sell", "wait");
  if (data.signal === "COMPRA") chip.classList.add("buy");
  else if (data.signal === "VENDA") chip.classList.add("sell");
  else chip.classList.add("wait");
}

function paintMini(prefix, data) {
  el(`${prefix}-mini-price`).textContent = data.price;
  el(`${prefix}-mini-change`).textContent = data.change;
}

// --- Integração com redundância (CoinGecko primária, Binance fallback) ---
const FETCH_TIMEOUT = 10_000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) {
    const err = new Error(`Falha na API (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchMarket() {
  // 1) Tentativa CoinGecko
  try {
    const url =
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana&vs_currencies=usd,brl&include_24hr_change=true&include_24hr_vol=true";
    const data = await fetchWithTimeout(url);
    if (!data.bitcoin || !data.solana) throw new Error("Resposta incompleta da API");
    return {
      btc: mapAsset(data.bitcoin),
      sol: mapAsset(data.solana),
      source: "CoinGecko",
    };
  } catch (err) {
    console.warn("CoinGecko falhou, tentando Binance...", err);
  }

  // 2) Fallback Binance 24h ticker
  const [btc, sol] = await Promise.all([
    fetchWithTimeout("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"),
    fetchWithTimeout("https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT"),
  ]);

  return {
    btc: mapBinance(btc),
    sol: mapBinance(sol),
    source: "Binance",
  };
}

function mapBinance(d) {
  const priceUsd = parseFloat(d.lastPrice);
  const volUsd = parseFloat(d.quoteVolume); // já em USD para par USDT
  const change = parseFloat(d.priceChangePercent);

  const trend = change > 1 ? "Alta" : change < -1 ? "Baixa" : "Lateral";
  const sentiment = change > 0 ? "Otimista" : change < -2 ? "Pessimista" : "Neutro";
  const signal =
    change > 1.5 ? "COMPRA" : change < -1.5 ? "VENDA" : "ESPERA";

  const support = priceUsd * 0.97;
  const resistance = priceUsd * 1.05;

  return {
    price: `US$ ${priceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    change: `${change.toFixed(2)}%`,
    volume: `US$ ${(volUsd / 1e9).toFixed(2)}B`,
    trend,
    support: `US$ ${support.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    resistance: `US$ ${resistance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    sentiment,
    signal,
    justification: `Variação 24h em ${change.toFixed(2)}%. Tendência ${trend.toLowerCase()} com suporte em ${support.toFixed(0)} e resistência em ${resistance.toFixed(0)}. Fonte: Binance.`,
  };
}

function mapAsset(d) {
  const priceUsd = d.usd;
  const volUsd = d.usd_24h_vol;
  const change = d.usd_24h_change;

  const trend = change > 1 ? "Alta" : change < -1 ? "Baixa" : "Lateral";
  const sentiment = change > 0 ? "Otimista" : change < -2 ? "Pessimista" : "Neutro";
  const signal =
    change > 1.5 ? "COMPRA" : change < -1.5 ? "VENDA" : "ESPERA";

  // Níveis simples: +-3% e +-5% como zonas de suporte/resistência rápidas
  const support = priceUsd * 0.97;
  const resistance = priceUsd * 1.05;

  return {
    price: `US$ ${priceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    change: `${change.toFixed(2)}%`,
    volume: `US$ ${(volUsd / 1e9).toFixed(2)}B`,
    trend,
    support: `US$ ${support.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    resistance: `US$ ${resistance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    sentiment,
    signal,
    justification: `Variação 24h em ${change.toFixed(2)}%. Tendência ${trend.toLowerCase()} com suporte em ${support.toFixed(0)} e resistência em ${resistance.toFixed(0)}.`,
  };
}

function paintAll(dataset) {
  paintCard("btc", dataset.btc);
  paintCard("sol", dataset.sol);
  paintMini("btc", dataset.btc);
  paintMini("sol", dataset.sol);
  el("global-sentiment").textContent = dataset.btc.sentiment;
  triggerAlerts("btc", dataset.btc);
  triggerAlerts("sol", dataset.sol);
  if (dataset.source) {
    el("last-updated").textContent =
      (el("last-updated").textContent || "Atualizado") + ` · Fonte: ${dataset.source}`;
  }
}

async function loadData() {
  try {
    setLoading(true);
    const live = await fetchMarket();
    paintAll(live);
    updateStamp();
    setHealth("online");
    scheduleInterval(REFRESH_MS_OK);
  } catch (err) {
    console.error(err);
    const message =
      err?.status === 429
        ? "Rate limit: espere 2 min"
        : err?.name === "AbortError"
        ? "Timeout na API"
        : "Erro API — tentando novamente";
    setHealth("error", message);
    scheduleInterval(REFRESH_MS_BACKOFF);
  } finally {
    setLoading(false);
  }
}

document.getElementById("refresh").addEventListener("click", loadData);

// --- Atualização contínua ---
const REFRESH_MS_OK = 60_000;
const REFRESH_MS_BACKOFF = 120_000;
let intervalId;

function scheduleInterval(delay) {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(loadData, delay);
}

function updateStamp() {
  const ts = new Date();
  const hh = String(ts.getHours()).padStart(2, "0");
  const mm = String(ts.getMinutes()).padStart(2, "0");
  el("last-updated").textContent = `Atualizado às ${hh}:${mm}`;
}

// Carrega dados iniciais e inicia auto-refresh
loadData().then(() => scheduleInterval(REFRESH_MS_OK));

// Revalida sempre que o usuário volta para a aba
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadData();
});

function setLoading(state) {
  const btn = document.getElementById("refresh");
  btn.disabled = state;
  btn.textContent = state ? "⌛ Atualizando..." : "↻ Atualizar";
}

function setHealth(status, message) {
  if (status === "online") {
    el("last-updated").textContent =
      el("last-updated").textContent || "Atualizado";
    el("global-sentiment").textContent =
      el("global-sentiment").textContent || "Neutro";
    return;
  }
  el("last-updated").textContent = message || "Falha ao atualizar";
  pushToast("API instável", message || "Tente novamente em instantes", "sell");
}

// --- Alertas de compra/venda ---
function triggerAlerts(prefix, data) {
  const prev = lastSignals[prefix];
  if (prev === data.signal) return;
  lastSignals[prefix] = data.signal;

  if (data.signal === "COMPRA") {
    pushToast(
      `${prefix.toUpperCase()} em ponto de compra`,
      "Sinal positivo + funding saudável.",
      "buy"
    );
  } else if (data.signal === "VENDA") {
    pushToast(
      `${prefix.toUpperCase()} favorável a venda/alavancagem short`,
      "Pressão vendedora ou funding negativo.",
      "sell"
    );
  }
}

function pushToast(title, text, variant) {
  const stack = el("alert-stack");
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  const icon = variant === "buy" ? "▲" : "▼";
  toast.innerHTML = `
    <div class="icon">${icon}</div>
    <h5>${title}</h5>
    <p>${text}</p>
    <div class="life"></div>
  `;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 5200);
}

// --- Doação ---
const wallets = {
  btc: "luizoliveira197@bipa.app", // Lightning address para BTC
};

async function copyAddress(chain = "btc") {
  const out = wallets[chain] || wallets.btc;
  try {
    await navigator.clipboard.writeText(out);
    el("donate-feedback").textContent = `${chain.toUpperCase()} copiado!`;
  } catch (err) {
    console.error(err);
    el("donate-feedback").textContent = "Não foi possível copiar.";
  }
}
