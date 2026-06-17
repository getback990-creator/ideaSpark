# ⚡ IdeaSpark

「何かで稼ぎたいけどアイデアが出てこない」人のための、**AI事業アイデア創出プラットフォーム**。
対話で要件を整理 → 10案以上を生成 → 複数選択して検証プラン → メンター相談、までを一気通貫で支援します。

- 対象: 起業家 / 社内新規事業担当者 / 副業したい人
- AI: OpenAI（ChatGPT）API（サーバ側でキー保持）
- 保存: SQLite（Node 組み込みの `node:sqlite`、追加依存なし）

## 主な機能（Phase 1: 個人体験）

1. **アカウント** … 個人/企業の種別付きでサインアップ（Cookieセッション、パスワードは scrypt ハッシュ）
2. **① 対話型 要件整理** … AIと対話しながら「市場ニーズ / 顧客課題 / トレンド / 実現コスト・難易度」を整理ボードに自動で蓄積
3. **② アイデア生成（10案以上）** … 整理した要件をもとにAIが事業案を量産。トレンド根拠・コスト難易度つき
4. **③ 複数選択 → 検証プラン** … 選んだ案ごとにリーンな検証プラン（中核仮説/最も危険な前提/指標/Go基準/検証ステップ）を生成
5. **④ 検証ラボ** … ステップのチェックで進捗を管理。**メンター相談**はAIが一次対応（人間メンターへのエスカレーションは将来拡張）

> Phase 2（企業OI: アイデアの公開・閲覧・購入・協業、モック決済）はDBに `published` / `price` 等の土台を用意済み。

## ローカルで動かす

```bash
cd idea-spark
npm install          # express, dotenv のみ（DB/認証はNode組み込みで依存なし）
cp .env.example .env # 既定は AI_MODE=mock（キー不要・無料で全機能が動く）
npm start            # → http://localhost:3000
```

## AIモード（モック / 本番）

公開デモは **モックAI** で動くため、誰でも・無料・キー不要で全機能を試せます。

| `AI_MODE` | 挙動 |
|---|---|
| `mock`（既定・公開デモ向け） | 常にサンプル応答。OpenAI不要・無料 |
| `auto` | 本物のAPIを試し、quota不足/キー無しなら自動でモックに切替 |
| `live` | 常に本物のAPI（要 `OPENAI_API_KEY` + 課金） |

本番のAI生成を使うときは `.env` に `OPENAI_API_KEY` を入れ、`AI_MODE=auto`（または `live`）に。

## 公開（デプロイ）

誰でも使えるよう、そのままクラウドに載せられます。**モックモードなのでキー不要・無料**で公開できます。

### Render（最も簡単・ワンクリック）
1. このフォルダをGitHubリポジトリにpush
2. [Render](https://render.com) → **New → Blueprint** → リポジトリを選択 → **Apply**
   （`render.yaml` を自動で読み込み、`AI_MODE=mock` で起動します）

### Docker（Railway / Fly.io / Cloud Run など）
```bash
docker build -t idea-spark .
docker run -p 3000:3000 idea-spark        # → http://localhost:3000
# データを永続化したい場合: -v $(pwd)/data:/data
```

### 注意
- 無料プランの多くはディスクが揮発するため、再デプロイで SQLite（`data.db`）が初期化されます。デモ用途では問題ありません。永続化するには `DATA_DIR` を永続ボリュームに向けてください。
- 公開URLはHTTPS（`NODE_ENV=production` で Cookie に `Secure` が付与されます）。

## .env

| 変数 | 必須 | 説明 |
|---|---|---|
| `OPENAI_API_KEY` | ✓ | OpenAI(ChatGPT) の API キー |
| `OPENAI_MODEL` |  | 既定 `gpt-4o`。利用可能な ID に変更可 |
| `PORT` |  | 既定 `3000` |

## 構成

| ファイル | 役割 |
|---|---|
| `server.js` | Express。認証・AI（要件対話/生成/検証/メンター）API |
| `db.js` | `node:sqlite` のスキーマと認証ヘルパー |
| `public/` | フロントエンド（バニラJS SPA、ハッシュルーター） |
| `data.db` | SQLite 本体（gitignore 済み。**削除すれば初期化**） |

## 動作確認用の初期データ

検証用にテストアカウントとサンプルが投入されています:
`taro@example.com` / `test123`（テスト 太郎）。リセットしたい場合は `data.db*` を削除してください。
