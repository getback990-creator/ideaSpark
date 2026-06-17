// ============================================================
//  IdeaSpark SPA
// ============================================================
const $ = (s, r = document) => r.querySelector(s);
const esc = (s = "") =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

const app = $("#app");
const state = {
  user: null,
  // requirements working state
  chat: [],
  fields: { market_need: "", customer_problem: "", trend: "", cost_difficulty: "" },
  persona: "",
  goal: "",
  projectId: null,
  projectTitle: "",
};

// ---------- overlay ----------
function overlay(text) {
  let el = $("#overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "overlay";
    el.innerHTML = `<div class="ov-card"><div class="spark"></div><p id="ovText"></p></div>`;
    document.body.appendChild(el);
  }
  $("#ovText", el).textContent = text;
  el.classList.remove("hidden");
}
function hideOverlay() {
  $("#overlay")?.classList.add("hidden");
}
function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

// ============================================================
//  Router
// ============================================================
function navigate(hash) {
  if (location.hash === "#" + hash) render();
  else location.hash = hash;
}
window.addEventListener("hashchange", render);
$("#brandHome").addEventListener("click", () => navigate("/dashboard"));

function parseRoute() {
  const raw = (location.hash || "#/dashboard").slice(1);
  const [path, query] = raw.split("?");
  const params = Object.fromEntries(new URLSearchParams(query || ""));
  return { path, params };
}

async function render() {
  if (!state.user) {
    try {
      const { user } = await api("GET", "/api/auth/me");
      state.user = user;
    } catch {}
  }
  renderNav();
  await ensureBanner();
  const { path, params } = parseRoute();

  if (!state.user) return viewAuth();

  switch (path) {
    case "/dashboard":
      return viewDashboard();
    case "/requirements":
      return viewRequirements(params.p);
    case "/ideas":
      return viewIdeas(params.p);
    case "/lab":
      return viewLab();
    case "/mentors":
      return viewMentors();
    default:
      return viewDashboard();
  }
}

async function ensureBanner() {
  if (state.mode === undefined) {
    try {
      const h = await api("GET", "/api/health");
      state.mode = h.mode;
    } catch {
      state.mode = null;
    }
  }
  let b = document.getElementById("mockBanner");
  if (state.mode === "mock") {
    if (!b) {
      b = document.createElement("div");
      b.id = "mockBanner";
      b.className = "mock-banner";
      b.innerHTML = "<b>モック版デモ</b>：AIの応答はサンプルです（本番のAI生成にはOpenAIキー/課金が必要）。機能・操作感はそのままお試しいただけます。";
      document.querySelector(".topbar").after(b);
    }
  } else if (b) {
    b.remove();
  }
}

function renderNav() {
  const nav = $("#topnav");
  if (!state.user) {
    nav.innerHTML = "";
    return;
  }
  nav.innerHTML = `
    <a class="navlink" data-go="/dashboard">ダッシュボード</a>
    <a class="navlink" data-go="/lab">検証ラボ</a>
    <a class="navlink" data-go="/mentors">メンター</a>
    <span class="nav-user">${esc(state.user.name)}${state.user.type === "company" ? "（企業）" : ""}</span>
    <button class="nav-logout" id="logoutBtn">ログアウト</button>`;
  nav.querySelectorAll("[data-go]").forEach((a) => (a.onclick = () => navigate(a.dataset.go)));
  $("#logoutBtn").onclick = async () => {
    await api("POST", "/api/auth/logout");
    state.user = null;
    navigate("/auth");
    render();
  };
}

// ============================================================
//  認証
// ============================================================
function viewAuth() {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="hero">
      <div class="hero-eyebrow">起業 / 社内新規事業 / 副業</div>
      <h1 class="hero-title">考えなくていい。<br><span class="grad">AIが事業を、発想から検証まで。</span></h1>
      <p class="hero-sub">対話で要件を整理 → 10案以上を生成 → 検証プラン → メンター相談。アイデアを形にする全工程を、ひとつのプラットフォームで。</p>
    </div>
    <div class="card auth-card">
      <div class="seg" id="seg">
        <button class="seg-btn active" data-mode="login">ログイン</button>
        <button class="seg-btn" data-mode="signup">新規登録</button>
      </div>
      <form id="authForm">
        <div class="signup-only hidden">
          <label class="field-label">アカウント種別</label>
          <div class="chips" data-group="type" data-single="true">
            <button type="button" class="chip active" data-value="individual">個人</button>
            <button type="button" class="chip" data-value="company">企業</button>
          </div>
          <label class="field-label">お名前</label>
          <input class="free-input" id="f-name" placeholder="山田 太郎" />
          <div class="company-only hidden">
            <label class="field-label">企業名</label>
            <input class="free-input" id="f-company" placeholder="株式会社サンプル" />
          </div>
        </div>
        <label class="field-label">メールアドレス</label>
        <input class="free-input" id="f-email" type="email" placeholder="you@example.com" />
        <label class="field-label">パスワード（6文字以上）</label>
        <input class="free-input" id="f-pass" type="password" placeholder="••••••" />
        <button class="cta" id="authSubmit" type="submit"><span class="cta-label">ログイン</span></button>
        <p class="err-line hidden" id="authErr"></p>
      </form>
      <div class="or-line"><span>または</span></div>
      <button class="ghost-btn wide" id="guestBtn">登録せずにゲストで試す</button>
    </div>
  </div>`;

  let mode = "login";
  let type = "individual";
  const submitLabel = () => $(".cta-label", app).textContent = mode === "login" ? "ログイン" : "アカウント作成";

  $("#seg").onclick = (e) => {
    const b = e.target.closest(".seg-btn");
    if (!b) return;
    mode = b.dataset.mode;
    $$(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    $(".signup-only").classList.toggle("hidden", mode === "login");
    submitLabel();
  };
  const $$ = (s) => app.querySelectorAll(s);
  $(".chips[data-group=type]").onclick = (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    type = c.dataset.value;
    $$(".chips[data-group=type] .chip").forEach((x) => x.classList.toggle("active", x === c));
    $(".company-only").classList.toggle("hidden", type !== "company");
  };

  $("#guestBtn").onclick = async () => {
    try {
      const { user } = await api("POST", "/api/auth/guest");
      state.user = user;
      navigate("/dashboard");
      render();
    } catch (ex) {
      const err = $("#authErr");
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  };

  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#authErr");
    err.classList.add("hidden");
    const payload = { email: $("#f-email").value.trim(), password: $("#f-pass").value };
    try {
      if (mode === "signup") {
        payload.name = $("#f-name").value.trim();
        payload.type = type;
        payload.companyName = $("#f-company")?.value.trim() || "";
        const { user } = await api("POST", "/api/auth/signup", payload);
        state.user = user;
      } else {
        const { user } = await api("POST", "/api/auth/login", payload);
        state.user = user;
      }
      navigate("/dashboard");
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  };
}

// ============================================================
//  ダッシュボード
// ============================================================
async function viewDashboard() {
  app.innerHTML = `<div class="loading-inline"><div class="spark small"></div></div>`;
  const [{ projects }, { validations }] = await Promise.all([
    api("GET", "/api/projects"),
    api("GET", "/api/validations"),
  ]);

  const projCards = projects.length
    ? projects
        .map(
          (p) => `
      <div class="db-card">
        <div class="db-card-top">
          <h3>${esc(p.title)}</h3>
          <span class="badge ${p.status === "ready" ? "ok" : ""}">${p.status === "ready" ? "整理済み" : "下書き"}</span>
        </div>
        <p class="db-meta">${esc((p.customer_problem || "").slice(0, 60) || "課題は未整理")}…</p>
        <div class="db-actions">
          <button class="btn-sm" data-go="/requirements?p=${p.id}">要件を見る</button>
          <button class="btn-sm primary" data-go="/ideas?p=${p.id}">アイデアへ →</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty">まだテーマがありません。下のボタンから始めましょう。</div>`;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">ようこそ、${esc(state.user.name)} さん</h1>
        <p class="page-sub">アイデアの種を、対話から育てましょう。</p>
      </div>
      <button class="cta narrow" data-go="/requirements"><span class="cta-label">＋ 新しいテーマを始める</span></button>
    </div>

    <h2 class="section-title">あなたのテーマ</h2>
    <div class="db-grid">${projCards}</div>

    <h2 class="section-title" style="margin-top:34px;">進行中の検証（${validations.length}）</h2>
    <div class="db-grid">
      ${
        validations.length
          ? validations
              .map((v) => {
                const done = v.steps.filter((s) => s.done).length;
                const pct = v.steps.length ? Math.round((done / v.steps.length) * 100) : 0;
                return `
        <div class="db-card">
          <div class="db-card-top"><h3>${esc(v.idea_title)}</h3></div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          <p class="db-meta">${done}/${v.steps.length} ステップ完了</p>
          <div class="db-actions"><button class="btn-sm primary" data-go="/lab">検証ラボで開く →</button></div>
        </div>`;
              })
              .join("")
          : `<div class="empty">検証中のアイデアはまだありません。</div>`
      }
    </div>`;

  app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => navigate(b.dataset.go)));
}

// ============================================================
//  ① 対話型 要件整理
// ============================================================
const PERSONAS = [
  { v: "起業家・これから起業したい人", t: "起業" },
  { v: "社内の新規事業提案担当者", t: "社内新規事業" },
  { v: "副業で稼ぎたい個人", t: "副業" },
];
const FIELD_LABELS = {
  market_need: "市場ニーズ",
  customer_problem: "顧客課題",
  trend: "トレンド",
  cost_difficulty: "実現コスト/難易度",
};

async function viewRequirements(pid) {
  // load existing or reset
  if (pid) {
    const { projects } = await api("GET", "/api/projects");
    const p = projects.find((x) => String(x.id) === String(pid));
    if (p) {
      state.projectId = p.id;
      state.persona = p.persona || "";
      state.goal = p.goal || "";
      state.projectTitle = p.title;
      state.fields = {
        market_need: p.market_need || "",
        customer_problem: p.customer_problem || "",
        trend: p.trend || "",
        cost_difficulty: p.cost_difficulty || "",
      };
      state.chat = JSON.parse(p.chat_log || "[]");
    }
  } else {
    state.projectId = null;
    state.persona = "";
    state.goal = "";
    state.projectTitle = "";
    state.fields = { market_need: "", customer_problem: "", trend: "", cost_difficulty: "" };
    state.chat = [];
  }
  if (!state.chat.length) {
    state.chat = [
      {
        role: "assistant",
        content:
          "事業アイデアの種を一緒に整理していきましょう。まず、上のボタンからあなたのタイプを選び、すぐ下の「あなたの要望・ゴール」に思っていることを自由に書いてください。たとえば「テーマは何でもいい、数年で億単位のバイアウトをしたい」「月5万円の副業がしたい」のような書き方でOKです。気になっている分野があれば、それも教えてください。なければ「お任せ」でも構いません。",
      },
    ];
  }
  renderRequirements();
}

function renderRequirements() {
  app.innerHTML = `
  <div class="page-head"><h1 class="page-title">要件を対話で整理</h1>
    <button class="ghost-btn" data-go="/dashboard">← ダッシュボード</button></div>

  <div class="req-layout">
    <div class="card req-chat">
      <div class="persona-row">
        ${PERSONAS.map((p) => `<button class="chip ${state.persona === p.v ? "active" : ""}" data-persona="${esc(p.v)}">${p.t}</button>`).join("")}
      </div>
      <div class="goal-box">
        <label class="goal-label">あなたの要望・ゴール<span>（自由・任意。テーマが無くてもOK）</span></label>
        <textarea id="goalInput" class="goal-input" rows="2" placeholder="例：テーマは何でもいい。数年で億単位のバイアウトができる事業がいい／月5万円の副業を作りたい／好きな『食』の分野で起業したい">${esc(state.goal)}</textarea>
      </div>
      <div class="chat-scroll" id="chatScroll"></div>
      <div class="chat-input">
        <textarea id="chatBox" rows="1" placeholder="回答を入力…（お任せでもOK）"></textarea>
        <button class="send-btn" id="sendBtn">送信</button>
      </div>
    </div>

    <div class="card req-side">
      <h3 class="side-title">整理ボード</h3>
      <p class="side-sub">対話が進むと自動で埋まります</p>
      ${Object.entries(FIELD_LABELS)
        .map(
          ([k, label]) => `
        <div class="field-slot ${state.fields[k] ? "filled" : ""}">
          <div class="slot-label">${state.fields[k] ? "✓" : "○"} ${label}</div>
          <div class="slot-val" id="slot-${k}">${esc(state.fields[k]) || '<span class="muted">未整理</span>'}</div>
        </div>`
        )
        .join("")}
      <button class="cta" id="toIdeas" style="margin-top:18px;"><span class="cta-label">この要件でアイデア10案を生成 →</span></button>
      <p class="hint">途中でも確定できます</p>
    </div>
  </div>`;

  app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => navigate(b.dataset.go)));
  app.querySelectorAll("[data-persona]").forEach(
    (b) =>
      (b.onclick = () => {
        state.persona = b.dataset.persona;
        renderRequirements();
      })
  );
  $("#goalInput").oninput = (e) => (state.goal = e.target.value);
  drawChat();

  const box = $("#chatBox");
  box.oninput = () => {
    box.style.height = "auto";
    box.style.height = Math.min(box.scrollHeight, 120) + "px";
  };
  const send = async () => {
    const text = box.value.trim();
    if (!text) return;
    state.chat.push({ role: "user", content: text });
    box.value = "";
    box.style.height = "auto";
    drawChat();
    $("#sendBtn").disabled = true;
    const typing = appendTyping();
    try {
      const out = await api("POST", "/api/requirements/chat", { messages: state.chat, fields: state.fields, goal: state.goal });
      state.fields = { ...state.fields, ...(out.fields || {}) };
      if (out.suggestedTitle && !state.projectTitle) state.projectTitle = out.suggestedTitle;
      state.chat.push({ role: "assistant", content: out.reply || "（応答なし）" });
      renderRequirements();
      if (out.complete) toast("要件が十分に整いました。アイデア生成に進めます");
    } catch (ex) {
      typing?.remove();
      appendMsg("assistant", "" + ex.message);
      $("#sendBtn").disabled = false;
    }
  };
  $("#sendBtn").onclick = send;
  box.onkeydown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
  };

  $("#toIdeas").onclick = async () => {
    overlay("要件を保存しています…");
    try {
      const { id } = await api("POST", "/api/projects", {
        id: state.projectId,
        title: state.projectTitle || state.goal?.slice(0, 16) || state.fields.customer_problem?.slice(0, 16) || "新しいテーマ",
        persona: state.persona,
        goal: state.goal,
        fields: state.fields,
        chatLog: state.chat,
        status: "ready",
      });
      state.projectId = id;
      hideOverlay();
      navigate("/ideas?p=" + id);
    } catch (ex) {
      hideOverlay();
      toast(ex.message, true);
    }
  };
}

function drawChat() {
  const sc = $("#chatScroll");
  if (!sc) return;
  sc.innerHTML = state.chat
    .map(
      (m) => `<div class="bubble ${m.role}">${esc(m.content).replace(/\n/g, "<br>")}</div>`
    )
    .join("");
  sc.scrollTop = sc.scrollHeight;
}
function appendMsg(role, content) {
  state.chat.push({ role, content });
  drawChat();
}
function appendTyping() {
  const sc = $("#chatScroll");
  const el = document.createElement("div");
  el.className = "bubble assistant typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  sc.appendChild(el);
  sc.scrollTop = sc.scrollHeight;
  return el;
}

// ============================================================
//  ② アイデア生成（10案）＋複数選択
// ============================================================
async function viewIdeas(pid) {
  state.projectId = pid;
  app.innerHTML = `<div class="loading-inline"><div class="spark small"></div></div>`;
  const { ideas } = await api("GET", "/api/ideas?projectId=" + pid);
  renderIdeas(ideas);
}

function renderIdeas(ideas) {
  const selected = ideas.filter((i) => i.selected);
  app.innerHTML = `
  <div class="page-head">
    <div><h1 class="page-title">事業アイデア</h1>
      <p class="page-sub">複数選んで、検証プランをまとめて作成できます</p></div>
    <div class="head-actions">
      <button class="ghost-btn" id="regen">${ideas.length ? "さらに10案を追加生成" : "10案を生成"}</button>
      <button class="ghost-btn" data-go="/requirements?p=${state.projectId}">← 要件へ戻る</button>
    </div>
  </div>

  ${
    ideas.length
      ? `<div class="cards">${ideas.map(ideaCard).join("")}</div>`
      : `<div class="empty big">まだアイデアがありません。<br>「10案を生成」を押すと、AIが要件をもとに事業案を提案します。</div>`
  }

  <div class="select-bar ${selected.length ? "" : "hidden"}" id="selectBar">
    <span><b id="selCount">${selected.length}</b> 件を選択中</span>
    <button class="cta narrow" id="makePlans"><span class="cta-label">選択した案の検証プランを作る →</span></button>
  </div>`;

  app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => navigate(b.dataset.go)));

  $("#regen").onclick = async () => {
    overlay("AIが要件をもとに10案を構想中…（10〜30秒）");
    try {
      await api("POST", "/api/generate", { projectId: state.projectId, count: 10 });
      const { ideas: fresh } = await api("GET", "/api/ideas?projectId=" + state.projectId);
      hideOverlay();
      renderIdeas(fresh);
    } catch (ex) {
      hideOverlay();
      toast(ex.message, true);
    }
  };

  app.querySelectorAll(".idea-check").forEach(
    (cb) =>
      (cb.onchange = async () => {
        const ids = [...app.querySelectorAll(".idea-check:checked")].map((x) => +x.dataset.id);
        await api("POST", "/api/ideas/select", { ids });
        $("#selCount").textContent = ids.length;
        $("#selectBar").classList.toggle("hidden", ids.length === 0);
        cb.closest(".idea-card").classList.toggle("picked", cb.checked);
      })
  );

  const mk = $("#makePlans");
  if (mk)
    mk.onclick = async () => {
      const ids = [...app.querySelectorAll(".idea-check:checked")].map((x) => +x.dataset.id);
      if (!ids.length) return;
      for (let i = 0; i < ids.length; i++) {
        overlay(`検証プランを作成中… (${i + 1}/${ids.length})`);
        try {
          await api("POST", "/api/validate", { ideaId: ids[i] });
        } catch (ex) {
          hideOverlay();
          toast(ex.message, true);
          return;
        }
      }
      hideOverlay();
      toast("検証プランを作成しました");
      navigate("/lab");
    };
}

function ideaCard(i) {
  const tags = (i.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
  return `
  <article class="idea-card ${i.selected ? "picked" : ""}">
    <label class="pick"><input type="checkbox" class="idea-check" data-id="${i.id}" ${i.selected ? "checked" : ""}/><span>選択</span></label>
    <h3 class="idea-title">${esc(i.title)}</h3>
    <div class="idea-catch">${esc(i.catchphrase)}</div>
    <div class="idea-section"><div class="idea-label">課題</div><div class="idea-text">${esc(i.problem)}</div></div>
    <div class="idea-section"><div class="idea-label">ターゲット</div><div class="idea-text">${esc(i.target)}</div></div>
    <div class="idea-section"><div class="idea-label">解決策</div><div class="idea-text">${esc(i.solution)}</div></div>
    <div class="idea-section trend"><div class="idea-label">トレンド / 市場根拠</div><div class="trend-box idea-text">${esc(i.trend)}</div></div>
    ${i.cost_difficulty ? `<div class="cost-chip">${esc(i.cost_difficulty)}</div>` : ""}
    ${tags ? `<div class="tags">${tags}</div>` : ""}
  </article>`;
}

// ============================================================
//  ③④ 検証ラボ（プラン + 進捗 + メンター相談）
// ============================================================
async function viewLab() {
  app.innerHTML = `<div class="loading-inline"><div class="spark small"></div></div>`;
  const { validations } = await api("GET", "/api/validations");
  if (!validations.length) {
    app.innerHTML = `<div class="page-head"><h1 class="page-title">検証ラボ</h1></div>
      <div class="empty big">検証中のアイデアがありません。<br>アイデア画面で案を選び「検証プランを作る」を押してください。
      <div style="margin-top:18px;"><button class="cta narrow" data-go="/dashboard"><span class="cta-label">ダッシュボードへ</span></button></div></div>`;
    app.querySelector("[data-go]").onclick = (e) => navigate(e.target.closest("[data-go]").dataset.go);
    return;
  }
  app.innerHTML = `<div class="page-head"><h1 class="page-title">検証ラボ</h1>
    <button class="ghost-btn" data-go="/dashboard">← ダッシュボード</button></div>
    <div class="lab-list">${validations.map(labCard).join("")}</div>`;
  app.querySelector("[data-go]").onclick = (e) => navigate(e.target.closest("[data-go]").dataset.go);
  bindLab(validations);
}

function labCard(v) {
  const done = v.steps.filter((s) => s.done).length;
  const pct = v.steps.length ? Math.round((done / v.steps.length) * 100) : 0;
  return `
  <div class="card lab-card" data-vid="${v.id}">
    <div class="lab-head">
      <h3>${esc(v.idea_title)}</h3>
      <span class="badge ok">${pct}% 完了</span>
    </div>
    <div class="plan-grid">
      <div><div class="plan-k">中核仮説</div><div class="plan-v">${esc(v.hypothesis)}</div></div>
      <div><div class="plan-k">最も危険な前提</div><div class="plan-v">${esc(v.riskiest_assumption)}</div></div>
      <div><div class="plan-k">主要指標</div><div class="plan-v">${esc(v.metrics)}</div></div>
      <div><div class="plan-k">Go/No-Go 基準</div><div class="plan-v">${esc(v.go_criteria)}</div></div>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="steps">
      ${v.steps
        .map(
          (s) => `
        <label class="step ${s.done ? "done" : ""}">
          <input type="checkbox" class="step-check" data-sid="${s.id}" ${s.done ? "checked" : ""}/>
          <div><div class="step-label">${esc(s.label)}</div><div class="step-detail">${esc(s.detail)}</div></div>
        </label>`
        )
        .join("")}
    </div>
    <button class="mentor-btn" data-mentor="${v.id}">メンターに相談する</button>
  </div>`;
}

function bindLab(validations) {
  app.querySelectorAll(".step-check").forEach(
    (cb) =>
      (cb.onchange = async () => {
        await api("PATCH", "/api/validation-steps/" + cb.dataset.sid, { done: cb.checked });
        cb.closest(".step").classList.toggle("done", cb.checked);
        // update progress bar
        const card = cb.closest(".lab-card");
        const all = card.querySelectorAll(".step-check").length;
        const done = card.querySelectorAll(".step-check:checked").length;
        const pct = Math.round((done / all) * 100);
        card.querySelector(".progress-bar").style.width = pct + "%";
        card.querySelector(".badge").textContent = pct + "% 完了";
      })
  );
  app.querySelectorAll("[data-mentor]").forEach(
    (b) => (b.onclick = () => openMentor(b.dataset.mentor, validations.find((v) => String(v.id) === b.dataset.mentor)))
  );
}

// ---------- メンター用ヘルパー ----------
function mentorAvatar(m, size = 44) {
  const ch = (m.name || "?").trim().charAt(0);
  return `<div class="m-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px;background:${esc(m.color || "#6c5cff")}">${esc(ch)}</div>`;
}

// ---------- メンターモーダル（AI一次対応 + 人メンター相談） ----------
async function openMentor(vid, v) {
  const root = $("#modal-root");
  root.innerHTML = `
  <div class="modal">
    <div class="modal-backdrop" id="mbd"></div>
    <div class="modal-panel mentor-panel">
      <button class="modal-close" id="mClose">✕</button>
      <h3 class="modal-title">メンター相談</h3>
      <p class="modal-sub">${esc(v.idea_title)}</p>
      <div class="mentor-note">まずはAIメンターが一次対応します。下の「人のメンターに相談」から、登録メンターに直接相談することもできます。</div>
      <div class="chat-scroll mentor-scroll" id="mScroll"></div>
      <div id="mPicker" class="m-picker hidden"></div>
      <div class="chat-input">
        <textarea id="mBox" rows="1" placeholder="検証の悩み・相談を入力…"></textarea>
        <button class="send-btn" id="mSend">AIに送信</button>
      </div>
      <button class="human-btn" id="mHuman">人のメンターに相談する</button>
    </div>
  </div>`;
  const close = () => (root.innerHTML = "");
  $("#mbd").onclick = close;
  $("#mClose").onclick = close;

  let msgs = [];
  let mentors = null;
  const bubble = (m) =>
    m.role === "human"
      ? `<div class="bubble human"><div class="human-head">${esc(m.mentor_name || "メンター")}<span>人のメンター</span></div>${esc(m.content).replace(/\n/g, "<br>")}</div>`
      : `<div class="bubble ${m.role === "user" ? "user" : "assistant"}">${esc(m.content).replace(/\n/g, "<br>")}</div>`;
  const draw = () => {
    $("#mScroll").innerHTML = msgs.length
      ? msgs.map(bubble).join("")
      : `<div class="mentor-empty">検証の進め方、顧客の反応の読み方、ピボット判断など、何でも相談してください。</div>`;
    $("#mScroll").scrollTop = $("#mScroll").scrollHeight;
  };
  try {
    const { messages } = await api("GET", "/api/mentor/" + vid);
    msgs = messages;
  } catch {}
  draw();

  const typing = (cls) => {
    const t = document.createElement("div");
    t.className = `bubble ${cls} typing`;
    t.innerHTML = "<span></span><span></span><span></span>";
    $("#mScroll").appendChild(t);
    $("#mScroll").scrollTop = $("#mScroll").scrollHeight;
    return t;
  };

  const sendAI = async () => {
    const text = $("#mBox").value.trim();
    if (!text) return;
    msgs.push({ role: "user", content: text });
    $("#mBox").value = "";
    draw();
    $("#mSend").disabled = true;
    const t = typing("assistant");
    try {
      const { messages } = await api("POST", "/api/mentor/" + vid, { content: text });
      msgs = messages;
      draw();
    } catch (ex) {
      t.remove();
      msgs.push({ role: "ai", content: ex.message });
      draw();
    }
    $("#mSend").disabled = false;
  };
  $("#mSend").onclick = sendAI;
  $("#mBox").onkeydown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendAI();
  };

  // 人メンターのピッカー
  $("#mHuman").onclick = async () => {
    const picker = $("#mPicker");
    if (!picker.classList.contains("hidden")) {
      picker.classList.add("hidden");
      return;
    }
    picker.classList.remove("hidden");
    picker.innerHTML = `<div class="m-picker-loading"><div class="spark small"></div></div>`;
    if (!mentors) {
      try {
        mentors = (await api("GET", "/api/mentors")).mentors;
      } catch {
        mentors = [];
      }
    }
    picker.innerHTML =
      `<div class="m-picker-head">相談したいメンターを選んでください</div>` +
      mentors
        .map(
          (m) => `
      <div class="m-pick-row">
        ${mentorAvatar(m, 38)}
        <div class="m-pick-info"><div class="m-pick-name">${esc(m.name)}</div><div class="m-pick-title">${esc(m.title)}</div></div>
        <button class="m-pick-btn" data-mid="${m.id}">相談</button>
      </div>`
        )
        .join("");
    picker.querySelectorAll(".m-pick-btn").forEach(
      (b) =>
        (b.onclick = async () => {
          const mentorId = +b.dataset.mid;
          const content = $("#mBox").value.trim();
          const chosen = mentors.find((x) => x.id === mentorId);
          picker.classList.add("hidden");
          $("#mBox").value = "";
          msgs.push({ role: "user", content: content || `${chosen?.name}さんに相談したいです。` });
          draw();
          const t = typing("human");
          try {
            const { messages } = await api("POST", "/api/mentor/" + vid + "/human", { mentorId, content });
            msgs = messages;
            draw();
            toast(`${chosen?.name}さんに相談を送りました`);
          } catch (ex) {
            t.remove();
            msgs.push({ role: "ai", content: ex.message });
            draw();
          }
        })
    );
  };
}

// ============================================================
//  ⑤ メンター一覧（プロピッカー風）
// ============================================================
async function viewMentors() {
  app.innerHTML = `<div class="loading-inline"><div class="spark small"></div></div>`;
  let mentors = [];
  try {
    mentors = (await api("GET", "/api/mentors")).mentors;
  } catch {}
  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">メンター</h1>
        <p class="page-sub">各分野のプロに、検証の壁打ちや事業相談ができます</p></div>
      <button class="ghost-btn" data-go="/lab">検証ラボへ →</button>
    </div>
    <div class="mentor-grid">
      ${mentors
        .map(
          (m) => `
      <div class="mentor-card">
        <div class="mentor-card-top">
          ${mentorAvatar(m, 56)}
          <div class="mentor-meta">
            <div class="mentor-name">${esc(m.name)}</div>
            <div class="mentor-title">${esc(m.title)}</div>
          </div>
        </div>
        <div class="mentor-focus">「${esc(m.focus || "")}」</div>
        <p class="mentor-bio">${esc(m.bio || "")}</p>
        <div class="tags">${(m.expertise || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="mentor-foot">
          <span class="mentor-stat">相談 ${m.responses}件</span>
          <span class="mentor-rate">${esc(m.rate || "")}</span>
        </div>
      </div>`
        )
        .join("")}
    </div>
    <p class="mentor-hint">相談するには、検証ラボでアイデアの「メンターに相談」→「人のメンターに相談」を選んでください。</p>`;
  app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => navigate(b.dataset.go)));
}

// ---------- start ----------
render();
