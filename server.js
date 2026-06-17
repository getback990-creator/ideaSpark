import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, hashPassword, verifyPassword, newToken } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const API_KEY = process.env.OPENAI_API_KEY;
// 利用するAI提供元のエンドポイント。OpenAI互換ならGroq等もそのまま使える
// OpenAI:  https://api.openai.com/v1 （既定）
// Groq:    https://api.groq.com/openai/v1  （無料・カード不要、モデル例: llama-3.3-70b-versatile）
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
// auto: 本物のAPIを試し、quota/キー不足ならモックに自動フォールバック
// mock: 常にサンプル応答（公開デモ向け・無料）  live: 常に本物
const AI_MODE = (process.env.AI_MODE || (API_KEY ? "auto" : "mock")).toLowerCase();
const TODAY = new Date().toISOString().slice(0, 10);

/* ============================================================
 *  OpenAI 呼び出し
 * ========================================================== */
async function callOpenAI({ system, user, temperature = 0.8 }) {
  if (!API_KEY) {
    throw Object.assign(new Error("OPENAI_API_KEY が未設定です。.env を確認してください。"), { status: 500 });
  }
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `OpenAI APIエラー (${res.status})`;
    if (res.status === 429) msg = "OpenAIの利用枠(quota)が不足しています。platform.openai.com の Billing でクレジット/支払い方法を確認してください。";
    else if (res.status === 401) msg = "OpenAI APIキーが無効です。.env を確認してください。";
    throw Object.assign(new Error(msg), { status: res.status, detail: text });
  }
  const data = await res.json();
  try {
    return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw Object.assign(new Error("AIの応答をJSONとして解釈できませんでした。"), { status: 502 });
  }
}

/* ============================================================
 *  AI 呼び出し（モック自動フォールバック付き）
 * ========================================================== */
async function complete({ system, user, temperature, mock }) {
  if (AI_MODE === "mock") return mock();
  try {
    return await callOpenAI({ system, user, temperature });
  } catch (e) {
    const fallbackable = e.status === 429 || e.status === 401 || /API_KEY/.test(e.message);
    if (AI_MODE === "auto" && fallbackable) return mock();
    throw e;
  }
}

/* ---------- モック生成（公開デモ用のサンプル応答） ---------- */
const BIG_GOAL_RE = /億|バイアウト|売却|スケール|上場|ipo|exit|m&a|大きく|大型|ユニコーン|急成長/i;

function mockRequirements(messages, fields, goal = "") {
  const userMsgs = messages.filter((m) => m.role === "user");
  const last = userMsgs.at(-1)?.content || "";
  const f = { ...fields };
  const order = ["market_need", "customer_problem", "trend", "cost_difficulty"];
  const topic = (last.slice(0, 24) || "その領域").trim();
  const big = BIG_GOAL_RE.test(goal);
  const fillers = {
    market_need: `${topic}に関する需要は拡大傾向。${big ? "短期で大きく伸ばすなら、市場規模が大きく拡大の速い領域を狙いたい。" : "手間やコストを下げたい、不安を減らしたいという声が強い。"}`,
    customer_problem: `${topic}では、時間がかかる・分かりにくい・任せられる相手がいない、といった痛みが残っている。`,
    trend: `デジタル化と生成AIの普及で、個人や小さなチームでも素早く始めて検証できる環境が整ってきた。${big ? "とくにAI・データ領域は資金が集まりやすく、出口（M&A/上場）も見込みやすい。" : ""}`,
    cost_difficulty: big
      ? "短期での大型イグジットを狙うなら、再現性とスケール性が鍵。初期は小さく検証しつつ、仕組みで伸びる設計にする。"
      : "初期はノーコードや既存サービス連携で低コストに検証可能。難易度は中程度で、運用の磨き込みが差別化の鍵になる。",
  };
  const firstEmpty = order.find((k) => !f[k]);
  if (firstEmpty) f[firstEmpty] = fillers[firstEmpty];
  const nextEmpty = order.find((k) => !f[k]);
  const questions = {
    market_need: "なるほど。その分野で「お金を払ってでも解決したい」と感じている人は、具体的に誰だと思いますか？",
    customer_problem: "その人たちが今いちばん困っていること・不便に感じていることは何でしょう？",
    trend: "なぜ「今」それが伸びると思いますか？最近の変化や追い風があれば教えてください（お任せでもOK）。",
    cost_difficulty: "実現にあたって、使える時間やお金の感覚はどれくらいですか？（ざっくりでOK）",
  };
  const complete = !nextEmpty;
  return {
    reply: complete
      ? "ありがとうございます。4つの観点が整いました。右の「この要件でアイデア10案を生成」に進みましょう。"
      : questions[nextEmpty],
    fields: f,
    complete,
    suggestedTitle: last.slice(0, 16) || "新規事業テーマ",
  };
}

function mockGenerate(p, count) {
  const need = (p.market_need || "対象領域の需要が拡大している").replace(/[。.]\s*$/, "");
  const problem = (p.customer_problem || "日々の手間や不安が残っている").replace(/[。.]\s*$/, "");
  const persona = p.persona || "";
  const big = BIG_GOAL_RE.test(p.goal || "");
  const baseAud = big
    ? "拡大余地の大きい市場の初期顧客（横展開しやすいセグメント）"
    : persona.includes("副業")
      ? "副業として小さく始めたい個人"
      : persona.includes("社内")
        ? "自社の顧客基盤を活かせる事業部門"
        : "課題感が強く、先行して動くアーリーアダプター";
  let concepts = [
    { t: "オンデマンド・マッチング", c: "必要なときだけ、必要な分だけつなぐ", m: "需要が発生した瞬間に供給側とマッチングし、遊休リソースを収益化する", who: "スポットで頼みたい利用者と、空き時間を活かしたい供給者", tr: "所有から利用へのシフトと、スポット需要のオンデマンド化", cd: "低コスト/中難度", tg: ["マッチング", "オンデマンド"] },
    { t: "継続支援サブスク", c: "売り切りから、続く関係へ", m: "単発提供をやめ、月額で継続的に伴走するモデルへ転換する", who: "一度きりでは解決しない悩みを抱える層", tr: "本当に役立つ継続課金の定着と、LTV重視への移行", cd: "低コスト/低難度", tg: ["サブスク", "LTV"] },
    { t: "特化型AIアシスタント", c: "その業務だけ、誰よりも賢く", m: "特定業務に絞ったAIアシスタントで、汎用AIでは届かない精度と手間削減を出す", who: "反復的で専門的な作業に時間を奪われている人", tr: "汎用LLMの普及で、縦に深い特化AIへ価値が移行", cd: "中コスト/中難度", tg: ["生成AI", "特化SaaS"] },
    { t: "おまかせ代行", c: "面倒は、まるごと預ける", m: "やりたくない作業を人＋AIのハイブリッドで巻き取る代行サービス", who: "コア業務に集中したいが手が回らない人", tr: "省人化ニーズと外注文化の浸透による代行市場の拡大", cd: "低コスト/低難度", tg: ["代行", "省人化"] },
    { t: "診断・レコメンド", c: "迷いを、最短で答えに", m: "数問の質問から最適な選択肢を提示し、意思決定を肩代わりする", who: "選択肢が多すぎて選べない・比較に疲れた人", tr: "情報過多のなか『選んでくれる』体験への需要増", cd: "低コスト/低難度", tg: ["診断", "レコメンド"] },
    { t: "当事者コミュニティ", c: "同じ悩みは、仲間と越える", m: "同じ課題を持つ人を集め、相互支援と限定情報で会費を得る", who: "孤独に課題と向き合っている当事者", tr: "コミュニティ経済の成熟と『共助』志向の高まり", cd: "低コスト/低難度", tg: ["コミュニティ", "会員制"] },
    { t: "実践型ミニ講座", c: "つまずきを、最短で乗り越える", m: "つまずきポイントに絞った実践型の学習プログラムを届ける", who: "独学では続かず成果が出ない学習者", tr: "リスキリング需要と、結果に直結する学びへの回帰", cd: "低コスト/中難度", tg: ["教育", "リスキリング"] },
    { t: "予兆見守り", c: "異変に、いちばん早く気づく", m: "データやIoTで状態を見守り、異変の予兆を関係者へ通知する", who: "離れた対象の状態を把握したい家族・管理者", tr: "高齢化と省人化を背景にした予防・予兆検知の価値上昇", cd: "中コスト/中難度", tg: ["IoT", "予兆検知"] },
    { t: "スキル/資産シェア", c: "眠っている価値を、収益に", m: "遊休のスキルやモノを必要な人へ仲介し、双方の余剰を活かす", who: "使われていない資産・時間を持つ供給側", tr: "シェアリングの定着と、副業解禁による供給の増加", cd: "低コスト/中難度", tg: ["シェアリング", "副業"] },
    { t: "一次データ・レポート", c: "勘ではなく、根拠で動く", m: "独自に集めたデータを定期レポートやダッシュボードで提供する", who: "判断材料となる一次データを欲しい事業者", tr: "データドリブン経営の浸透と、一次情報の希少化", cd: "低コスト/中難度", tg: ["データ", "BtoB"] },
    { t: "体験デザイン", c: "オンラインでは得られない時間を", m: "リアル/オンラインの体験を企画し、参加費とスポンサーで収益化する", who: "つながりや実体験に飢えている層", tr: "コト消費・ローカル回帰と、体験価値の見直し", cd: "低コスト/低難度", tg: ["体験", "ローカル"] },
    { t: "エシカル・プロダクト", c: "選ぶだけで、社会に効く", m: "環境・社会配慮を組み込んだ商品/サービスで、共感を購買につなげる", who: "価値観で選びたいエシカル志向の生活者", tr: "脱炭素・エシカル消費の主流化と、企業の調達基準の変化", cd: "中コスト/中難度", tg: ["サステナ", "D2C"] },
  ];
  // 毎回の生成で並びを変えて多様性を出す（同じ案ばかりにならないように）
  for (let i = concepts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [concepts[i], concepts[j]] = [concepts[j], concepts[i]];
  }
  // ゴールが大型イグジット志向なら、スケール性の高い案を前に寄せる（順序はシャッフル済みなので毎回変わる）
  if (big) {
    const priority = ["特化型AIアシスタント", "一次データ・レポート", "オンデマンド・マッチング", "継続支援サブスク", "診断・レコメンド", "スキル/資産シェア"];
    const isPri = (t) => priority.includes(t);
    concepts = [...concepts.filter((c) => isPri(c.t)), ...concepts.filter((c) => !isPri(c.t))];
  }
  return {
    ideas: concepts.slice(0, count).map((x) => ({
      title: x.t,
      catchphrase: x.c,
      problem: `${problem}。とくに${x.who}にとって、手間・コスト・情報不足のいずれかが障壁になっている。`,
      target: `${baseAud}。具体的には${x.who}。`,
      solution: `${x.m}。「${need}」という追い風を踏まえ、まず小さく検証しながら磨き込む。${big ? "横展開しやすい仕組みにし、数年での大型化（M&A/上場）も狙える設計に。" : ""}`,
      trend: `${x.tr}。なぜ今かというと、この潮流が需要側・供給側の双方で同時に進んでいるため。`,
      costDifficulty: x.cd,
      tags: big ? [...x.tg, "スケール"].slice(0, 3) : x.tg,
    })),
  };
}

function mockValidate(idea) {
  return {
    hypothesis: `${idea.target || "想定顧客"}は「${(idea.problem || "課題").slice(0, 22)}」の解決に対価を払う`,
    riskiestAssumption: "そもそも顧客がこの課題を「お金を払ってでも解決したい」と思っているか",
    metrics: "課題インタビューでの強い共感率、LP事前登録CVR",
    timeline: "2週間",
    goCriteria: "インタビュー15名中9名以上が強く共感し、LP登録CVR 5%以上",
    steps: [
      { label: "課題インタビュー", detail: "想定顧客15名に現状の課題と対処法をヒアリングし、共感度を測る" },
      { label: "価値仮説LP", detail: "解決策を1枚のLPにし、事前登録ボタンのCVRを計測する" },
      { label: "競合・代替の調査", detail: "既存の代替手段と比べた優位性を整理する" },
      { label: "最小プロトタイプ", detail: "手動オペでもよいので価値提供を1件試し、反応を観察する" },
      { label: "課金意向テスト", detail: "想定価格を提示し、支払い意向を確認する" },
    ],
  };
}

function mockMentor(idea, v, lastUser) {
  return {
    reply: `いい問いですね。「${(lastUser || "").slice(0, 28)}」については、まず最も危険な前提（${v.riskiest_assumption || "顧客が本当に困っているか"}）を最小コストで確かめるのが先決です。\n次の一手:\n・対象顧客5名に15分インタビューし、課題の切実さを生の言葉で確認\n・「お金を払ってでも解決したいか」を直接聞く\n・反応が弱ければ対象セグメントを変えてピボットを検討\nまず今日中に1件、話を聞いてみましょう。`,
  };
}

function mockHumanMentor(mentor, idea, content) {
  const exp = (() => { try { return JSON.parse(mentor.expertise || "[]"); } catch { return []; } })();
  return {
    reply: `${mentor.name}です。ご相談ありがとうございます。「${idea?.title || "この事業"}」、面白いですね。\n私の経験（${exp.slice(0, 2).join("・") || mentor.title}）から一点だけ。「${(content || "").slice(0, 30) || "今の論点"}」については、まず一番不確実なところを“安く速く”当てにいくのが定石です。具体的には、想定顧客に直接5件ヒアリングして、課題の切実さと支払い意思をその場で確かめてみてください。\nもう少し詳しく壁打ちしたければ、日程を合わせてオンラインでお話ししましょう。応援しています。`,
  };
}

const CONSULTANT = `あなたは一流の戦略コンサルタント兼新規事業プロデューサーです。
起業家・社内新規事業担当者・副業を始めたい人を支援します。今日は ${TODAY} です。
直近〜今後数年で伸びるトレンド（生成AI/AIエージェント、高齢化・シニア、ヘルスケア・メンタル、サステナビリティ・脱炭素、リスキリング、地方創生、クリエイターエコノミー、無人化・省人化など）を踏まえ「なぜ今伸びるのか」を必ず根拠で示すこと。
抽象論を避け、明日から検討できる解像度に。出力は必ず日本語で、指定されたJSON構造のみを返すこと。`;

/* ============================================================
 *  認証ミドルウェア
 * ========================================================== */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}

function auth(req, res, next) {
  const token = parseCookies(req).sid;
  if (token) {
    const row = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
    if (row) {
      req.user = db.prepare("SELECT id, email, name, type, company_name FROM users WHERE id = ?").get(row.user_id);
    }
  }
  next();
}
app.use(auth);

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "ログインが必要です" });
  next();
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err.message);
    res.status(err.status || 500).json({ error: err.message });
  });

/* ============================================================
 *  認証 API
 * ========================================================== */
app.post("/api/auth/signup", wrap(async (req, res) => {
  const { email, password, name, type = "individual", companyName = "" } = req.body || {};
  if (!email || !password || !name) throw Object.assign(new Error("メール・パスワード・氏名は必須です"), { status: 400 });
  if (password.length < 6) throw Object.assign(new Error("パスワードは6文字以上にしてください"), { status: 400 });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) throw Object.assign(new Error("このメールは既に登録されています"), { status: 409 });

  const info = db
    .prepare("INSERT INTO users (email, password, name, type, company_name) VALUES (?, ?, ?, ?, ?)")
    .run(email, hashPassword(password), name, type, companyName);
  startSession(res, info.lastInsertRowid);
  res.json({ user: { id: info.lastInsertRowid, email, name, type, company_name: companyName } });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email || "");
  if (!user || !verifyPassword(password || "", user.password))
    throw Object.assign(new Error("メールまたはパスワードが違います"), { status: 401 });
  startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name, type: user.type, company_name: user.company_name } });
}));

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => res.json({ user: req.user || null }));

// 登録不要のゲスト体験（公開デモ向け）
app.post("/api/auth/guest", wrap(async (req, res) => {
  const email = `guest_${Date.now()}_${Math.floor(Math.random() * 1e6)}@guest.local`;
  const info = db
    .prepare("INSERT INTO users (email, password, name, type) VALUES (?, ?, ?, 'individual')")
    .run(email, hashPassword(newToken()), "ゲスト");
  startSession(res, info.lastInsertRowid);
  res.json({ user: { id: info.lastInsertRowid, email, name: "ゲスト", type: "individual" } });
}));

function startSession(res, userId) {
  const token = newToken();
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly;${secure} Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
}

/* ============================================================
 *  ① 対話型 要件整理
 * ========================================================== */
app.post("/api/requirements/chat", requireAuth, wrap(async (req, res) => {
  const { messages = [], fields = {}, goal = "" } = req.body || {};
  const convo = messages.map((m) => `${m.role === "user" ? "ユーザー" : "コンサル"}: ${m.content}`).join("\n");

  const user = `あなたは新規事業のアイデア要件を、対話を通じて一緒に整理するコンサルタントです。
次の4つの観点を、ユーザーとの対話で順に明確化します（1ターンに1つだけ質問する）。
1. market_need（市場ニーズ：どんな需要が伸びているか）
2. customer_problem（顧客課題：誰のどんな痛みを解くか）
3. trend（トレンド：なぜ今か。具体的潮流）
4. cost_difficulty（実現コスト/難易度：必要リソース・参入障壁）

# ユーザーのオープンな要望・ゴール（最優先で尊重する）
${goal || "（特になし。テーマ・志向は自由に提案してよい）"}

# これまでの会話
${convo || "（まだ会話なし。最初の問いかけから始める）"}

# 現在埋まっている情報
${JSON.stringify(fields, null, 2)}

# 指示
- 上の「要望・ゴール」を最優先で尊重する。テーマが自由なら、ゴール（例：数年で大型バイアウト＝高成長・スケール性・出口を重視／月数万円の副業＝低リスク・低コスト）に沿って各観点を方向づける。
- ユーザーの直近の回答を踏まえ、まだ曖昧な観点について、深掘りする質問を1つだけ返す。
- ユーザーが「わからない/お任せ」と言ったら、ゴールに沿った仮説候補を提示して合意を取りにいく。
- 各観点の現時点の要約を fields に反映（推測でも可、簡潔に）。
- 4観点が十分に具体化できたら complete=true、suggestedTitle にテーマ名を入れる。

# 出力JSON
{
  "reply": "ユーザーへの返答・次の質問（親しみやすく簡潔に）",
  "fields": { "market_need": "", "customer_problem": "", "trend": "", "cost_difficulty": "" },
  "complete": false,
  "suggestedTitle": ""
}`;

  const out = await complete({ system: CONSULTANT, user, temperature: 0.7, mock: () => mockRequirements(messages, fields, goal) });
  res.json(out);
}));

app.post("/api/projects", requireAuth, wrap(async (req, res) => {
  const { id, title, persona, goal, fields = {}, chatLog = [], status = "ready" } = req.body || {};
  const f = fields || {};
  // node:sqlite は undefined をバインドできないため null/"" に正規化
  const vals = [
    title || "無題のテーマ",
    persona ?? "",
    goal ?? "",
    f.market_need ?? "",
    f.customer_problem ?? "",
    f.trend ?? "",
    f.cost_difficulty ?? "",
    JSON.stringify(chatLog || []),
    status || "ready",
  ];
  if (id) {
    db.prepare(
      `UPDATE projects SET title=?, persona=?, goal=?, market_need=?, customer_problem=?, trend=?, cost_difficulty=?, chat_log=?, status=?
       WHERE id=? AND user_id=?`
    ).run(...vals, id, req.user.id);
    return res.json({ id });
  }
  const info = db
    .prepare(
      `INSERT INTO projects (user_id, title, persona, goal, market_need, customer_problem, trend, cost_difficulty, chat_log, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, ...vals);
  res.json({ id: info.lastInsertRowid });
}));

app.get("/api/projects", requireAuth, wrap(async (req, res) => {
  const rows = db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  res.json({ projects: rows });
}));

/* ============================================================
 *  ② アイデア生成（10案以上）
 * ========================================================== */
app.post("/api/generate", requireAuth, wrap(async (req, res) => {
  const { projectId, count = 10 } = req.body || {};
  const p = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, req.user.id);
  if (!p) throw Object.assign(new Error("テーマが見つかりません"), { status: 404 });

  const user = `次の要件整理に基づき、事業アイデアを${count}案、JSONで提案してください。

# 要件整理
- 対象タイプ: ${p.persona || "指定なし"}
- ユーザーの要望・ゴール（最優先で反映）: ${p.goal || "特になし（テーマ自由。妥当な範囲で提案）"}
- 市場ニーズ: ${p.market_need || "未整理"}
- 顧客課題: ${p.customer_problem || "未整理"}
- トレンド: ${p.trend || "未整理"}
- 実現コスト/難易度の前提: ${p.cost_difficulty || "未整理"}

# 出力JSON
{
  "ideas": [
    {
      "title": "事業名(15文字程度)",
      "catchphrase": "一言キャッチ(30文字程度)",
      "problem": "解決する課題(2〜3文)",
      "target": "ターゲット顧客(具体的に)",
      "solution": "解決策・提供価値(2〜3文)",
      "trend": "トレンド/市場根拠(具体的潮流を挙げ なぜ今か)",
      "costDifficulty": "実現コスト・難易度(初期費用感と参入障壁を一言で。例: 低コスト/中難度)",
      "tags": ["トレンドタグ", "最大3個"]
    }
  ]
}

# 条件
- 必ず${count}案。切り口(ビジネスモデル/対象/技術)を変え、似通わせないこと。
- 「ユーザーの要望・ゴール」を最優先で反映する（例：数年で大型バイアウトを望むなら、スケール性・再現性・出口(M&A/上場)の見込める案を優先。月数万円の副業志向なら低リスク・低コストを優先）。
- 上記の実現コスト前提に現実的に合う規模にすること。
- 各案は具体的な提供価値にし、「AIで効率化」程度の薄い一般論や抽象語は避ける。
- problem は「誰の・どんな場面で・何が」痛いのかを具体的に書く。target は属性まで絞る。
- trend は案ごとに異なる具体的な潮流を挙げ、全案で同じ説明を使い回さない。
- solution は最初に出す最小プロダクト/サービスが想像できる粒度にする。
- catchphrase は短く、各案で語り口を変える(同じ言い回しの繰り返しを避ける)。`;

  const out = await complete({ system: CONSULTANT, user, temperature: 0.9, mock: () => mockGenerate(p, count) });
  const ideas = Array.isArray(out.ideas) ? out.ideas : [];

  const insert = db.prepare(
    `INSERT INTO ideas (user_id, project_id, title, catchphrase, problem, target, solution, trend, cost_difficulty, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const saved = ideas.map((i) => {
    const info = insert.run(req.user.id, projectId, i.title || "無題", i.catchphrase || "", i.problem || "", i.target || "", i.solution || "", i.trend || "", i.costDifficulty || "", JSON.stringify(i.tags || []));
    return { ...i, id: info.lastInsertRowid, selected: 0, tags: i.tags || [] };
  });
  res.json({ ideas: saved });
}));

app.get("/api/ideas", requireAuth, wrap(async (req, res) => {
  const { projectId } = req.query;
  const rows = projectId
    ? db.prepare("SELECT * FROM ideas WHERE user_id = ? AND project_id = ? ORDER BY id DESC").all(req.user.id, projectId)
    : db.prepare("SELECT * FROM ideas WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  res.json({ ideas: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") })) });
}));

app.post("/api/ideas/select", requireAuth, wrap(async (req, res) => {
  const { ids = [] } = req.body || {};
  db.prepare("UPDATE ideas SET selected = 0 WHERE user_id = ?").run(req.user.id);
  const set = db.prepare("UPDATE ideas SET selected = 1 WHERE id = ? AND user_id = ?");
  ids.forEach((id) => set.run(id, req.user.id));
  res.json({ ok: true });
}));

/* ============================================================
 *  ③ 検証プラン生成（選択した複数アイデア）
 * ========================================================== */
app.post("/api/validate", requireAuth, wrap(async (req, res) => {
  const { ideaId } = req.body || {};
  const idea = db.prepare("SELECT * FROM ideas WHERE id = ? AND user_id = ?").get(ideaId, req.user.id);
  if (!idea) throw Object.assign(new Error("アイデアが見つかりません"), { status: 404 });

  const existing = db.prepare("SELECT * FROM validations WHERE idea_id = ? AND user_id = ?").get(ideaId, req.user.id);
  if (existing) {
    const steps = db.prepare("SELECT * FROM validation_steps WHERE validation_id = ? ORDER BY sort").all(existing.id);
    return res.json({ validation: { ...existing, plan: JSON.parse(existing.plan_json || "{}"), steps } });
  }

  const user = `次の事業アイデアの「検証プラン」をJSONで作成してください。リーンスタートアップの考え方で、最小の労力で最大の学びを得る計画にすること。

# アイデア
タイトル: ${idea.title}
課題: ${idea.problem}
ターゲット: ${idea.target}
解決策: ${idea.solution}
トレンド根拠: ${idea.trend}

# 出力JSON
{
  "hypothesis": "中核仮説(この事業が成立する前提を1文で)",
  "riskiestAssumption": "最も危険な前提(外れたら事業が崩れるもの)",
  "metrics": "検証で見る主要指標(例: 事前登録CVR, インタビュー◯件中の課題共感率)",
  "timeline": "想定検証期間(例: 2週間)",
  "goCriteria": "Go/No-Goの判断基準(定量で)",
  "steps": [
    { "label": "検証ステップ名(短く)", "detail": "具体的に何をするか・どう測るか(1〜2文)" }
  ]
}
steps は 4〜6個。最初は顧客課題インタビュー等の低コスト検証から、徐々にプロトタイプ/事前登録など。`;

  const plan = await complete({ system: CONSULTANT, user, temperature: 0.6, mock: () => mockValidate(idea) });
  const info = db
    .prepare(
      `INSERT INTO validations (idea_id, user_id, hypothesis, riskiest_assumption, metrics, timeline, go_criteria, plan_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ideaId, req.user.id, plan.hypothesis || "", plan.riskiestAssumption || "", plan.metrics || "", plan.timeline || "", plan.goCriteria || "", JSON.stringify(plan));

  const stepInsert = db.prepare("INSERT INTO validation_steps (validation_id, label, detail, sort) VALUES (?, ?, ?, ?)");
  (plan.steps || []).forEach((s, i) => stepInsert.run(info.lastInsertRowid, s.label || `ステップ${i + 1}`, s.detail || "", i));
  const steps = db.prepare("SELECT * FROM validation_steps WHERE validation_id = ? ORDER BY sort").all(info.lastInsertRowid);
  const validation = db.prepare("SELECT * FROM validations WHERE id = ?").get(info.lastInsertRowid);
  res.json({ validation: { ...validation, plan, steps } });
}));

app.get("/api/validations", requireAuth, wrap(async (req, res) => {
  const rows = db
    .prepare(
      `SELECT v.*, i.title AS idea_title FROM validations v JOIN ideas i ON i.id = v.idea_id WHERE v.user_id = ? ORDER BY v.id DESC`
    )
    .all(req.user.id);
  const withSteps = rows.map((v) => {
    const steps = db.prepare("SELECT * FROM validation_steps WHERE validation_id = ? ORDER BY sort").all(v.id);
    return { ...v, plan: JSON.parse(v.plan_json || "{}"), steps };
  });
  res.json({ validations: withSteps });
}));

app.patch("/api/validation-steps/:id", requireAuth, wrap(async (req, res) => {
  const { done } = req.body || {};
  // 所有者チェック
  const step = db
    .prepare(
      `SELECT s.id FROM validation_steps s JOIN validations v ON v.id = s.validation_id WHERE s.id = ? AND v.user_id = ?`
    )
    .get(req.params.id, req.user.id);
  if (!step) throw Object.assign(new Error("not found"), { status: 404 });
  db.prepare("UPDATE validation_steps SET done = ? WHERE id = ?").run(done ? 1 : 0, req.params.id);
  res.json({ ok: true });
}));

/* ============================================================
 *  ④ メンター相談（AIが一次対応）
 * ========================================================== */
app.get("/api/mentor/:validationId", requireAuth, wrap(async (req, res) => {
  const msgs = db
    .prepare("SELECT * FROM mentor_messages WHERE validation_id = ? AND user_id = ? ORDER BY id")
    .all(req.params.validationId, req.user.id);
  res.json({ messages: msgs });
}));

app.post("/api/mentor/:validationId", requireAuth, wrap(async (req, res) => {
  const { content } = req.body || {};
  const vId = req.params.validationId;
  const v = db.prepare("SELECT * FROM validations WHERE id = ? AND user_id = ?").get(vId, req.user.id);
  if (!v) throw Object.assign(new Error("検証が見つかりません"), { status: 404 });
  const idea = db.prepare("SELECT * FROM ideas WHERE id = ?").get(v.idea_id);
  const steps = db.prepare("SELECT * FROM validation_steps WHERE validation_id = ? ORDER BY sort").all(vId);

  db.prepare("INSERT INTO mentor_messages (validation_id, user_id, role, content) VALUES (?, ?, 'user', ?)").run(vId, req.user.id, content);
  const history = db.prepare("SELECT role, content FROM mentor_messages WHERE validation_id = ? ORDER BY id").all(vId);

  const progress = steps.map((s) => `${s.done ? "✓" : "□"} ${s.label}`).join(" / ");
  const user = `あなたは新規事業のメンターです。相談者の検証を前に進めるため、具体的で実行可能な助言を返してください。

# 対象アイデア
${idea?.title}: ${idea?.solution}
中核仮説: ${v.hypothesis}
最も危険な前提: ${v.riskiest_assumption}
検証の進捗: ${progress || "未着手"}

# これまでの相談
${history.map((m) => `${m.role === "user" ? "相談者" : "メンター"}: ${m.content}`).join("\n")}

# 出力JSON
{ "reply": "メンターとしての助言(具体的・前向き・200字程度。必要なら次の一手を箇条書きで)" }`;

  const out = await complete({ system: CONSULTANT, user, temperature: 0.7, mock: () => mockMentor(idea, v, content) });
  db.prepare("INSERT INTO mentor_messages (validation_id, user_id, role, content) VALUES (?, ?, 'ai', ?)").run(vId, req.user.id, out.reply || "");
  const messages = db.prepare("SELECT * FROM mentor_messages WHERE validation_id = ? ORDER BY id").all(vId);
  res.json({ messages });
}));

/* ============================================================
 *  ⑤ 登録メンター（プロピッカー）＋ 人メンターへの相談
 * ========================================================== */
app.get("/api/mentors", wrap(async (req, res) => {
  const rows = db.prepare("SELECT * FROM mentors ORDER BY responses DESC").all();
  res.json({ mentors: rows.map((m) => ({ ...m, expertise: JSON.parse(m.expertise || "[]") })) });
}));

// 人メンターに相談（依頼を記録し、そのメンターからの一次返信を返す）
app.post("/api/mentor/:validationId/human", requireAuth, wrap(async (req, res) => {
  const { mentorId, content } = req.body || {};
  const vId = req.params.validationId;
  const v = db.prepare("SELECT * FROM validations WHERE id = ? AND user_id = ?").get(vId, req.user.id);
  if (!v) throw Object.assign(new Error("検証が見つかりません"), { status: 404 });
  const mentor = db.prepare("SELECT * FROM mentors WHERE id = ?").get(mentorId);
  if (!mentor) throw Object.assign(new Error("メンターが見つかりません"), { status: 404 });
  const idea = db.prepare("SELECT * FROM ideas WHERE id = ?").get(v.idea_id);

  const msg = content || `「${idea?.title || "この事業"}」について相談させてください。`;
  db.prepare("INSERT INTO mentor_messages (validation_id, user_id, role, content) VALUES (?, ?, 'user', ?)").run(vId, req.user.id, msg);
  db.prepare("INSERT INTO consultations (validation_id, user_id, mentor_id, message) VALUES (?, ?, ?, ?)").run(vId, req.user.id, mentorId, msg);
  db.prepare("UPDATE mentors SET responses = responses + 1 WHERE id = ?").run(mentorId);

  const expertise = JSON.parse(mentor.expertise || "[]");
  const userPrompt = `あなたは実在のメンター「${mentor.name}（${mentor.title}）」として、相談者に人として親身に一次返信します。
あなたの専門: ${expertise.join("、")}
あなたの経歴: ${mentor.bio}

# 相談対象の事業
${idea?.title}: ${idea?.solution}
中核仮説: ${v.hypothesis}

# 相談内容
${msg}

# 出力JSON
{ "reply": "${mentor.name}としての返信（自己紹介を一言添え、専門を踏まえた具体的助言と次の一手。250字程度。最後に必要なら面談を提案）" }`;

  const out = await complete({ system: CONSULTANT, user: userPrompt, temperature: 0.75, mock: () => mockHumanMentor(mentor, idea, msg) });
  db.prepare(
    "INSERT INTO mentor_messages (validation_id, user_id, role, content, mentor_id, mentor_name) VALUES (?, ?, 'human', ?, ?, ?)"
  ).run(vId, req.user.id, out.reply || "", mentorId, mentor.name);

  const messages = db.prepare("SELECT * FROM mentor_messages WHERE validation_id = ? ORDER BY id").all(vId);
  res.json({ messages, mentor: { ...mentor, expertise } });
}));

/* ============================================================ */
app.get("/api/health", (req, res) => res.json({ ok: true, model: MODEL, mode: AI_MODE, keyConfigured: Boolean(API_KEY) }));

app.listen(PORT, () => {
  console.log(`\n  IdeaSpark 起動: http://localhost:${PORT}`);
  console.log(`     モデル: ${MODEL} / AIモード: ${AI_MODE} / APIキー: ${API_KEY ? "設定済み ✓" : "未設定 ✗"}\n`);
});
