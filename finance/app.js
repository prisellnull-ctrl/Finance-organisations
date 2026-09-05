const KEY = "finance-pwa-v2";
const SYM = { RUB: "₽", EUR: "€", USD: "$", UAH: "₴" };

const DEFAULT_CATS = [
  { name: "Продукты", emoji: "🛒" },
  { name: "Энергетики", emoji: "⚡" },
  { name: "Кафе", emoji: "☕" },
  { name: "Развлечения", emoji: "🎟" },
  { name: "Транспорт", emoji: "🚌" },
  { name: "Жильё", emoji: "🏠" },
  { name: "Связь", emoji: "📱" },
  { name: "Здоровье", emoji: "✚" },
  { name: "Одежда", emoji: "👕" },
  { name: "Подписки", emoji: "▭" },
  { name: "Другое", emoji: "·" }
];

const state = {
  currency: "RUB",
  dailyBudget: 500,
  nextPay: "",
  budgetFrom: "",
  wallet: 0,
  categories: [],
  jars: [],
  debts: [],
  txs: [],
  page: "day"
};

const ui = {
  txType: "expense",
  txEdit: null,
  txCat: "",
  catIcon: "",
  jarEdit: null,
  jarIcon: "",
  debtEdit: null,
  debtKind: "mfo",
  debtIcon: "",
  payDebtId: ""
};

const $ = (id) => document.getElementById(id);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function money(n) {
  const abs = Math.abs(r2(n));
  const s = abs.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} ${SYM[state.currency] || "₽"}`;
}

function parseAmt(v) {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? r2(n) : 0;
}

function seedCats() {
  state.categories = DEFAULT_CATS.map((c) => ({ id: uid(), name: c.name, emoji: c.emoji, icon: "" }));
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw) {
      seedCats();
      state.budgetFrom = todayISO();
      return;
    }
    Object.assign(state, raw);
    if (!state.categories || !state.categories.length) seedCats();
    if (!Array.isArray(state.jars)) state.jars = [];
    if (!Array.isArray(state.debts)) state.debts = [];
    if (!Array.isArray(state.txs)) state.txs = [];
  } catch (e) {
    seedCats();
    state.budgetFrom = todayISO();
  }
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify({
    currency: state.currency,
    dailyBudget: state.dailyBudget,
    nextPay: state.nextPay,
    budgetFrom: state.budgetFrom,
    wallet: state.wallet,
    categories: state.categories,
    jars: state.jars,
    debts: state.debts,
    txs: state.txs
  }));
}

function catById(id) {
  return state.categories.find((c) => c.id === id);
}

function iconHTML(obj, fallback) {
  if (obj && obj.icon) return `<img src="${obj.icon}" alt="" />`;
  return (obj && obj.emoji) || fallback || "·";
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function expensesOn(date) {
  return r2(state.txs
    .filter((t) => t.type === "expense" && t.date === date)
    .reduce((s, t) => s + t.amount, 0));
}

function dayPlan() {
  const end = todayISO();
  const from = state.budgetFrom && state.budgetFrom <= end ? state.budgetFrom : end;
  let carry = 0;
  let cursor = from;
  const days = [];
  while (cursor <= end) {
    const spent = expensesOn(cursor);
    const available = r2(Number(state.dailyBudget) + carry);
    const remain = r2(available - spent);
    days.push({ date: cursor, available, spent, remain, carry });
    carry = remain;
    cursor = addDays(cursor, 1);
  }
  return days;
}

function todayPlan() {
  const days = dayPlan();
  return days[days.length - 1] || {
    available: state.dailyBudget,
    spent: 0,
    remain: state.dailyBudget,
    carry: 0
  };
}

function weekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(todayISO(d));
  }
  return days;
}

function liveDebt(debt) {
  if (debt.kind === "card") {
    return { amount: Math.max(0, r2(debt.currentDue)), overdue: 0, perDay: 0 };
  }
  const days = Math.max(0, Number(debt.overdueDays) || 0);
  const rawRate = days > 0 ? (Number(debt.currentDue) - Number(debt.principal)) / days : 0;
  const perDay = rawRate > 0 ? r2(rawRate) : 0;
  const elapsedMs = Date.now() - new Date(debt.snapshotAt || Date.now()).getTime();
  const elapsed = Math.max(0, elapsedMs / 86400000);
  return {
    amount: Math.max(0, r2(Number(debt.currentDue) + perDay * elapsed)),
    overdue: days + Math.floor(elapsed),
    perDay
  };
}

function openSheet(id, on) {
  $(id).classList.toggle("open", on);
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + page));
  document.querySelectorAll(".tabs .tab").forEach((t) => t.classList.toggle("on", t.dataset.page === page));
  const titles = { day: "Сегодня", week: "Неделя", jars: "Копилки", debts: "Долги" };
  $("pageTitle").textContent = titles[page];
  render();
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function render() {
  const now = new Date();
  $("kicker").textContent = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  renderDay();
  renderWeek();
  renderJars();
  renderDebts();
}

function renderDay() {
  const plan = todayPlan();
  $("dayHero").classList.toggle("over", plan.remain < 0);
  $("dayLeft").textContent = money(plan.remain);
  $("dayCap").textContent = money(plan.available);
  $("daySpent").textContent = money(plan.spent);
  const carryTxt = plan.carry > 0
    ? `Перешло со вчера ${money(plan.carry)}.`
    : plan.carry < 0
      ? `Вчерашний перерасход ${money(Math.abs(plan.carry))} уже вычтен.`
      : "Переноса со вчера нет.";
  $("dayNote").textContent = `${carryTxt} Базовый лимит ${money(state.dailyBudget)} в день.`;
  $("walletHint").textContent = `кошелёк ${money(state.wallet)}`;

  const list = state.txs
    .filter((t) => t.date === todayISO() && (t.type === "expense" || t.type === "income"))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  $("todayList").innerHTML = list.length
    ? list.map((t) => {
      const cat = catById(t.categoryId);
      const title = t.type === "income" ? "Доход" : (cat && cat.name) || "Расход";
      return `<button class="item" data-tx="${t.id}">
        <div class="avatar">${t.type === "income" ? "↑" : iconHTML(cat, "↓")}</div>
        <div><h3>${esc(title)}</h3><p>${t.note ? esc(t.note) : (t.type === "income" ? "зачисление" : "трата")}</p></div>
        <div class="sum ${t.type === "income" ? "good" : "bad"}">${t.type === "income" ? "+" : "−"}${money(t.amount)}</div>
      </button>`;
    }).join("")
    : `<div class="empty">Сегодня ещё нет операций</div>`;
}

function renderWeek() {
  const days = weekRange();
  const names = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const today = todayISO();
  const planMap = {};
  dayPlan().forEach((d) => { planMap[d.date] = d; });
  $("weekDays").innerHTML = days.map((iso, i) => {
    const spent = expensesOn(iso);
    const over = planMap[iso] ? planMap[iso].remain < 0 : spent > state.dailyBudget;
    return `<div class="dayp ${iso === today ? "today" : ""} ${over ? "over" : ""}">
      <div class="d">${names[i]}</div>
      <div class="n">${spent ? Math.round(spent) : "·"}</div>
    </div>`;
  }).join("");

  const weekTx = state.txs.filter((t) => days.includes(t.date));
  const spent = r2(weekTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));
  const income = r2(weekTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0));
  $("weekTotal").textContent = money(spent);
  $("weekIn").textContent = money(income);

  const map = new Map();
  weekTx.filter((t) => t.type === "expense").forEach((t) => {
    const cat = catById(t.categoryId);
    const name = (cat && cat.name) || "Другое";
    map.set(name, r2((map.get(name) || 0) + t.amount));
  });
  const cats = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  const top = cats[0];
  $("weekTop").textContent = top ? top[0] : "—";
  if (!spent) {
    $("weekCallout").textContent = "За эту неделю трат ещё нет. Как появятся — здесь будет видно, какая категория забирает основную массу.";
  } else {
    const pct = Math.round((top[1] / spent) * 100);
    $("weekCallout").innerHTML = `Основная масса ушла в <strong>${esc(top[0])}</strong> — ${money(top[1])}, это ${pct}% недели. Имеет смысл резать именно эту категорию.`;
  }
  const max = (cats[0] && cats[0][1]) || 1;
  $("weekCats").innerHTML = cats.length
    ? `<div class="bars">${cats.map((row, i) => `
        <div class="bar-row">
          <div>${esc(row[0])}</div>
          <div class="track"><div class="fill ${i === 0 ? "hot" : ""}" style="width:${Math.max(6, (row[1] / max) * 100)}%"></div></div>
          <div class="sum">${money(row[1])}</div>
        </div>`).join("")}</div>`
    : `<div class="empty">Нет расходов</div>`;
}

function renderJars() {
  $("walletValue").textContent = money(state.wallet);
  const daysLeft = state.nextPay ? Math.max(0, daysBetween(todayISO(), state.nextPay)) : null;
  if (daysLeft === null) {
    $("planNote").textContent = "Укажите дату зарплаты в настройках — приложение разложит кошелёк по оставшимся дням.";
  } else if (daysLeft === 0) {
    $("planNote").textContent = "Сегодня день зарплаты. После зачисления дохода копилки пополнятся по вашим процентам.";
  } else {
    const perDay = r2(state.wallet / daysLeft);
    $("planNote").innerHTML = `До зарплаты <strong>${daysLeft} дн.</strong> Если растянуть кошелёк, на день выходит <strong>${money(perDay)}</strong>. Дневной лимит стоит ${money(state.dailyBudget)}.`;
  }

  const pctSum = r2(state.jars.reduce((s, j) => s + (Number(j.percent) || 0), 0));
  $("jarList").innerHTML = state.jars.length
    ? state.jars.map((j) => `
        <button class="item" data-jar="${j.id}">
          <div class="avatar">${iconHTML(j, "▣")}</div>
          <div>
            <h3>${esc(j.name)}</h3>
            <p>${j.percent || 0}% с дохода</p>
          </div>
          <div class="sum">${money(j.balance || 0)}</div>
        </button>`).join("") + (pctSum > 100 ? `<p class="hint">Сумма процентов копилок ${pctSum}%. При доходе распределение урежется до 100%.</p>` : "")
    : `<div class="empty">Добавьте копилку, например «Отпуск 10%» или «Долги 10%»</div>`;
}

function renderDebts() {
  const lives = state.debts.map((d) => ({ d: d, live: liveDebt(d) }));
  const total = r2(lives.reduce((s, x) => s + x.live.amount, 0));
  const perDay = r2(lives.reduce((s, x) => s + x.live.perDay, 0));
  const paid = r2(state.debts.reduce((s, d) => s + (d.paidTotal || 0), 0));
  $("debtTotal").textContent = money(total);
  $("debtPerDay").textContent = money(perDay);
  $("debtPaid").textContent = money(paid);

  $("debtList").innerHTML = lives.length
    ? lives.map((x) => {
      const d = x.d;
      const live = x.live;
      return `<div class="card" style="padding:12px">
          <button class="item" data-debt="${d.id}" style="border:0;padding:0;background:none">
            <div class="avatar">${iconHTML(d, "◇")}</div>
            <div>
              <h3>${esc(d.name)}</h3>
              <p>${d.kind === "mfo" ? `МФО · просрочка ${live.overdue} дн.` : "Кредитка · фиксированная сумма"}</p>
            </div>
            <div class="sum ${d.kind === "mfo" ? "bad" : ""}">${money(live.amount)}</div>
          </button>
          <div class="metrics" style="margin-top:10px">
            <div class="metric"><span>${d.kind === "mfo" ? "Брал" : "Фикс"}</span><b>${money(d.kind === "mfo" ? d.principal : d.currentDue)}</b></div>
            <div class="metric"><span>${d.kind === "mfo" ? "Прирост / день" : "Платежи"}</span><b>${d.kind === "mfo" ? money(live.perDay) : money(d.paidTotal || 0)}</b></div>
          </div>
          <div class="actions-row" style="margin:10px 0 0">
            <button class="btn" data-edit-debt="${d.id}">Цифры</button>
            <button class="btn solid" data-pay-debt="${d.id}">Внести платёж</button>
          </div>
        </div>`;
    }).join("")
    : `<div class="empty">Добавьте МФО или кредитку</div>`;
}

function renderTxCats() {
  $("txCats").innerHTML = state.categories.map((c) => `
    <button class="pick ${ui.txCat === c.id ? "on" : ""}" data-cat="${c.id}">
      <span class="mini">${iconHTML(c, "·")}</span>${esc(c.name)}
    </button>`).join("");
}

function openTx(type, item) {
  ui.txType = (item && item.type) || type;
  ui.txEdit = (item && item.id) || null;
  ui.txCat = (item && item.categoryId) || (state.categories[0] && state.categories[0].id) || "";
  $("txTitle").textContent = ui.txType === "income" ? "Доход" : "Расход";
  $("txTypeSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.type === ui.txType));
  $("txCatWrap").classList.toggle("hidden", ui.txType === "income");
  $("txAmount").value = item ? String(item.amount).replace(".", ",") : "";
  $("txDate").value = (item && item.date) || todayISO();
  $("txNote").value = (item && item.note) || "";
  $("txDelete").classList.toggle("hidden", !item);
  renderTxCats();
  openSheet("txSheet", true);
}

function applyIncome(amount, date, note) {
  const jars = state.jars.filter((j) => Number(j.percent) > 0);
  const pct = jars.reduce((s, j) => s + Number(j.percent), 0);
  const scale = pct > 100 ? 100 / pct : 1;
  let allocated = 0;
  jars.forEach((j) => {
    const part = r2(amount * Number(j.percent) * scale / 100);
    j.balance = r2((j.balance || 0) + part);
    allocated = r2(allocated + part);
    if (part > 0) {
      state.txs.push({
        id: uid(),
        type: "jar",
        amount: part,
        date: date,
        note: "В копилку «" + j.name + "»",
        jarId: j.id,
        createdAt: new Date().toISOString()
      });
    }
  });
  const rest = r2(amount - allocated);
  state.wallet = r2(state.wallet + rest);
  state.txs.push({
    id: uid(),
    type: "income",
    amount: amount,
    date: date,
    note: note,
    createdAt: new Date().toISOString()
  });
}

function applyExpense(amount, date, note, categoryId, existingId) {
  if (existingId) {
    const old = state.txs.find((t) => t.id === existingId);
    if (old) state.wallet = r2(state.wallet + old.amount);
  }
  state.wallet = r2(state.wallet - amount);
  if (existingId) {
    const old = state.txs.find((t) => t.id === existingId);
    Object.assign(old, { amount: amount, date: date, note: note, categoryId: categoryId, type: "expense" });
  } else {
    state.txs.push({
      id: uid(),
      type: "expense",
      amount: amount,
      date: date,
      note: note,
      categoryId: categoryId,
      createdAt: new Date().toISOString()
    });
  }
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-page]");
  if (tab) setPage(tab.dataset.page);
});

$("addExpense").addEventListener("click", () => openTx("expense"));
$("addIncome").addEventListener("click", () => openTx("income"));
$("addIncome2").addEventListener("click", () => openTx("income"));
$("txCancel").addEventListener("click", () => openSheet("txSheet", false));

$("txTypeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]");
  if (!b) return;
  ui.txType = b.dataset.type;
  $("txTitle").textContent = ui.txType === "income" ? "Доход" : "Расход";
  $("txTypeSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.type === ui.txType));
  $("txCatWrap").classList.toggle("hidden", ui.txType === "income");
});

$("txCats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  ui.txCat = b.dataset.cat;
  renderTxCats();
});

$("txSave").addEventListener("click", () => {
  const amount = parseAmt($("txAmount").value);
  if (!amount) { $("txAmount").focus(); return; }
  const date = $("txDate").value || todayISO();
  const note = $("txNote").value.trim();
  if (ui.txEdit) {
    const old = state.txs.find((t) => t.id === ui.txEdit);
    if (!old) return;
    if (old.type === "income") {
      alert("Редактирование дохода лучше удалить и внести заново — иначе собьются копилки.");
      return;
    }
    applyExpense(amount, date, note, ui.txCat, ui.txEdit);
  } else if (ui.txType === "income") {
    applyIncome(amount, date, note);
  } else {
    applyExpense(amount, date, note, ui.txCat);
  }
  persist();
  openSheet("txSheet", false);
  render();
});

$("txDelete").addEventListener("click", () => {
  const old = state.txs.find((t) => t.id === ui.txEdit);
  if (!old) return;
  if (old.type === "income") {
    alert("Удаление дохода не откатывает копилки автоматически.");
  }
  if (old.type === "expense") state.wallet = r2(state.wallet + old.amount);
  state.txs = state.txs.filter((t) => t.id !== old.id);
  persist();
  openSheet("txSheet", false);
  render();
});

$("todayList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tx]");
  if (!b) return;
  const item = state.txs.find((t) => t.id === b.dataset.tx);
  if (item) openTx(item.type, item);
});

function renderCatManage() {
  $("catManageList").innerHTML = state.categories.map((c) => `
    <div class="item">
      <div class="avatar">${iconHTML(c, "·")}</div>
      <div><h3>${esc(c.name)}</h3><p>категория трат</p></div>
      <button class="quiet" data-del-cat="${c.id}">удалить</button>
    </div>`).join("");
}

$("manageCats").addEventListener("click", () => {
  renderCatManage();
  openSheet("catSheet", true);
});
$("catClose").addEventListener("click", () => openSheet("catSheet", false));

$("catManageList").addEventListener("click", (e) => {
  const id = e.target.dataset.delCat;
  if (!id) return;
  state.categories = state.categories.filter((c) => c.id !== id);
  persist();
  renderCatManage();
  renderTxCats();
});

$("catIconFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  ui.catIcon = await resizeImage(file);
  $("catIconPrev").innerHTML = `<img src="${ui.catIcon}" alt="" />`;
});

$("catAdd").addEventListener("click", () => {
  const name = $("catName").value.trim();
  if (!name) return;
  state.categories.push({ id: uid(), name: name, emoji: "·", icon: ui.catIcon || "" });
  $("catName").value = "";
  ui.catIcon = "";
  $("catIconPrev").textContent = "🛒";
  persist();
  renderCatManage();
  renderTxCats();
});

$("addJar").addEventListener("click", () => {
  ui.jarEdit = null;
  ui.jarIcon = "";
  $("jarTitle").textContent = "Новая копилка";
  $("jarName").value = "";
  $("jarPercent").value = "10";
  $("jarIconPrev").textContent = "▣";
  $("jarDelete").classList.add("hidden");
  openSheet("jarSheet", true);
});

$("jarList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-jar]");
  if (!b) return;
  const j = state.jars.find((x) => x.id === b.dataset.jar);
  if (!j) return;
  ui.jarEdit = j.id;
  ui.jarIcon = j.icon || "";
  $("jarTitle").textContent = j.name;
  $("jarName").value = j.name;
  $("jarPercent").value = String(j.percent || 0);
  $("jarIconPrev").innerHTML = iconHTML(j, "▣");
  $("jarDelete").classList.remove("hidden");
  openSheet("jarSheet", true);
});

$("jarCancel").addEventListener("click", () => openSheet("jarSheet", false));
$("jarIconFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  ui.jarIcon = await resizeImage(file);
  $("jarIconPrev").innerHTML = `<img src="${ui.jarIcon}" alt="" />`;
});

$("jarSave").addEventListener("click", () => {
  const name = $("jarName").value.trim();
  if (!name) return;
  const percent = Math.max(0, Number(String($("jarPercent").value).replace(",", ".")) || 0);
  if (ui.jarEdit) {
    const j = state.jars.find((x) => x.id === ui.jarEdit);
    Object.assign(j, { name: name, percent: percent, icon: ui.jarIcon || j.icon || "" });
  } else {
    state.jars.push({ id: uid(), name: name, percent: percent, icon: ui.jarIcon || "", emoji: "▣", balance: 0 });
  }
  persist();
  openSheet("jarSheet", false);
  render();
});

$("jarDelete").addEventListener("click", () => {
  const j = state.jars.find((x) => x.id === ui.jarEdit);
  if (!j) return;
  if (!confirm("Удалить копилку? Накопленная сумма вернётся в кошелёк.")) return;
  state.wallet = r2(state.wallet + (j.balance || 0));
  state.jars = state.jars.filter((x) => x.id !== j.id);
  persist();
  openSheet("jarSheet", false);
  render();
});

function setDebtKind(kind) {
  ui.debtKind = kind;
  $("debtKindSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  $("mfoFields").classList.toggle("hidden", kind !== "mfo");
  $("cardFields").classList.toggle("hidden", kind !== "card");
}

$("addDebt").addEventListener("click", () => {
  ui.debtEdit = null;
  ui.debtKind = "mfo";
  ui.debtIcon = "";
  $("debtTitle").textContent = "Новый займ";
  $("debtName").value = "";
  $("debtPrincipal").value = "";
  $("debtCurrent").value = "";
  $("debtOverdue").value = "";
  $("debtFixed").value = "";
  $("debtIconPrev").textContent = "◇";
  $("debtDelete").classList.add("hidden");
  setDebtKind("mfo");
  openSheet("debtSheet", true);
});

$("debtKindSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (b) setDebtKind(b.dataset.kind);
});

$("debtCancel").addEventListener("click", () => openSheet("debtSheet", false));
$("debtIconFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  ui.debtIcon = await resizeImage(file);
  $("debtIconPrev").innerHTML = `<img src="${ui.debtIcon}" alt="" />`;
});

function fillDebtForm(d) {
  ui.debtEdit = d.id;
  ui.debtIcon = d.icon || "";
  $("debtTitle").textContent = d.name;
  $("debtName").value = d.name;
  setDebtKind(d.kind);
  $("debtPrincipal").value = d.principal || "";
  $("debtCurrent").value = d.kind === "mfo" ? liveDebt(d).amount : "";
  $("debtOverdue").value = d.kind === "mfo" ? liveDebt(d).overdue : "";
  $("debtFixed").value = d.kind === "card" ? d.currentDue : "";
  $("debtIconPrev").innerHTML = iconHTML(d, "◇");
  $("debtDelete").classList.remove("hidden");
  openSheet("debtSheet", true);
}

$("debtList").addEventListener("click", (e) => {
  const pay = e.target.closest("[data-pay-debt]");
  if (pay) { openPay(pay.dataset.payDebt); return; }
  const edit = e.target.closest("[data-edit-debt]") || e.target.closest("[data-debt]");
  if (!edit) return;
  const id = edit.dataset.editDebt || edit.dataset.debt;
  const d = state.debts.find((x) => x.id === id);
  if (d) fillDebtForm(d);
});

$("debtSave").addEventListener("click", () => {
  const name = $("debtName").value.trim();
  if (!name) return;
  const kind = ui.debtKind;
  let principal = 0;
  let currentDue = 0;
  let overdueDays = 0;
  if (kind === "mfo") {
    principal = parseAmt($("debtPrincipal").value);
    currentDue = parseAmt($("debtCurrent").value);
    overdueDays = Math.max(0, parseInt($("debtOverdue").value, 10) || 0);
    if (!principal || !currentDue) return;
  } else {
    currentDue = parseAmt($("debtFixed").value);
    principal = currentDue;
    if (!currentDue) return;
  }
  if (ui.debtEdit) {
    const d = state.debts.find((x) => x.id === ui.debtEdit);
    Object.assign(d, {
      name: name,
      kind: kind,
      principal: principal,
      currentDue: currentDue,
      overdueDays: overdueDays,
      icon: ui.debtIcon || d.icon || "",
      snapshotAt: new Date().toISOString()
    });
  } else {
    state.debts.push({
      id: uid(),
      name: name,
      kind: kind,
      principal: principal,
      currentDue: currentDue,
      overdueDays: overdueDays,
      icon: ui.debtIcon || "",
      emoji: "◇",
      snapshotAt: new Date().toISOString(),
      paidTotal: 0
    });
  }
  persist();
  openSheet("debtSheet", false);
  render();
});

$("debtDelete").addEventListener("click", () => {
  if (!confirm("Удалить займ?")) return;
  state.debts = state.debts.filter((d) => d.id !== ui.debtEdit);
  persist();
  openSheet("debtSheet", false);
  render();
});

function openPay(id) {
  const d = state.debts.find((x) => x.id === id);
  if (!d) return;
  ui.payDebtId = id;
  const live = liveDebt(d);
  $("payTarget").textContent = d.name + ": сейчас " + money(live.amount);
  $("payAmount").value = "";
  $("payDate").value = todayISO();
  $("payNote").value = "";
  $("paySource").innerHTML =
    `<option value="wallet">Кошелёк (${money(state.wallet)})</option>` +
    state.jars.map((j) => `<option value="${j.id}">${esc(j.name)} (${money(j.balance || 0)})</option>`).join("");
  openSheet("paySheet", true);
}

$("payCancel").addEventListener("click", () => openSheet("paySheet", false));
$("paySave").addEventListener("click", () => {
  const amount = parseAmt($("payAmount").value);
  if (!amount) return;
  const d = state.debts.find((x) => x.id === ui.payDebtId);
  if (!d) return;
  const source = $("paySource").value;
  if (source === "wallet") {
    state.wallet = r2(state.wallet - amount);
  } else {
    const jar = state.jars.find((j) => j.id === source);
    if (!jar || (jar.balance || 0) < amount) {
      alert("В выбранной копилке недостаточно средств");
      return;
    }
    jar.balance = r2(jar.balance - amount);
  }
  const live = liveDebt(d);
  d.currentDue = Math.max(0, r2(live.amount - amount));
  d.overdueDays = live.overdue;
  d.snapshotAt = new Date().toISOString();
  d.paidTotal = r2((d.paidTotal || 0) + amount);
  state.txs.push({
    id: uid(),
    type: "debt_pay",
    amount: amount,
    date: $("payDate").value || todayISO(),
    note: $("payNote").value.trim() || ("Платёж: " + d.name),
    debtId: d.id,
    createdAt: new Date().toISOString()
  });
  persist();
  openSheet("paySheet", false);
  render();
});

$("openSettings").addEventListener("click", () => {
  $("currency").value = state.currency;
  $("dailyBudget").value = state.dailyBudget;
  $("nextPay").value = state.nextPay || "";
  openSheet("settingsSheet", true);
});
$("closeSettings").addEventListener("click", () => openSheet("settingsSheet", false));
$("saveSettings").addEventListener("click", () => {
  state.currency = $("currency").value;
  state.dailyBudget = parseAmt($("dailyBudget").value) || 0;
  state.nextPay = $("nextPay").value;
  if (!state.budgetFrom) state.budgetFrom = todayISO();
  persist();
  openSheet("settingsSheet", false);
  render();
});

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([localStorage.getItem(KEY) || "{}"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "finansy-" + todayISO() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    localStorage.setItem(KEY, JSON.stringify(data));
    load();
    render();
    openSheet("settingsSheet", false);
  } catch (err) {
    alert("Файл не прочитался");
  }
});

$("wipeBtn").addEventListener("click", () => {
  if (!confirm("Удалить все данные?")) return;
  localStorage.removeItem(KEY);
  location.reload();
});

["txSheet", "catSheet", "jarSheet", "debtSheet", "paySheet", "settingsSheet"].forEach((id) => {
  $(id).addEventListener("click", (e) => { if (e.target.id === id) openSheet(id, false); });
});

load();
if (!state.budgetFrom) state.budgetFrom = todayISO();
render();
setInterval(render, 60000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
