# LINE Obsidian Webhook Bot

LINEメッセージを自動でObsidian vaultに保存するサーバーレスWebhookボットです。TypeScriptで書かれ、AWS Lambdaで動作します。

## 概要

LINEでメッセージを送信すると、自動的にObsidian vaultのGitリポジトリに日記形式で記録されます。

### 主な機能

- ✅ LINEメッセージの自動受信・処理
- ✅ Obsidian vault への自動コミット
- ✅ 日付別ファイル管理 (`01_diary/2025/2025-06-25.md`)
- ✅ タイムライン形式でのメッセージ記録
- ✅ TypeScript による型安全性
- ✅ 包括的なテストカバレッジ

## アーキテクチャ

```
LINE メッセージ → AWS Lambda → GitHub Repository → Obsidian 自動同期
```

## 必要な設定

### 1. 環境変数

`.env` ファイルを作成し、以下を設定：

```bash
GH_TOKEN=your_github_personal_access_token
CHANNEL_SECRET=your_line_channel_secret
```

### 2. LINE Bot 設定

1. [LINE Developers Console](https://developers.line.biz/) でチャネル作成
2. Channel Secret を取得
3. デプロイ後に生成されるWebhook URLを設定

### 3. GitHub リポジトリ

- Obsidian vault が Git リポジトリとして設定済み
- Personal Access Token の作成（repo権限必要）

## 開発・デプロイ

### 依存関係のインストール

```bash
npm install
```

### TypeScript

```bash
npm run typecheck    # 型チェック
npm run build        # TypeScriptコンパイル
```

### テスト

```bash
npm test             # テスト実行
npm run test:watch   # テスト監視モード
npm run test:coverage # カバレッジレポート
```

### ローカル開発

```bash
npm run dev          # ローカルエミュレーター起動
```

### デプロイ

```bash
npm run deploy       # 開発環境へデプロイ
npm run deploy:prod  # 本番環境へデプロイ
```

## ファイル構造

```
line-obsidian-webhook/
├── src/
│   └── handler.ts          # メインLambda関数
├── tests/
│   └── handler.test.ts     # テストファイル
├── serverless.yml          # Serverlessフレームワーク設定
├── tsconfig.json          # TypeScript設定
├── jest.config.js         # Jest設定
└── CLAUDE.md             # 開発ガイド
```

## 動作フロー

1. **LINEメッセージ送信** → LINE Platform がWebhookを呼び出し
2. **署名検証** → LINE Channel Secret で署名を検証
3. **メッセージ処理** → テキストメッセージのみを処理
4. **Git操作** → リポジトリをクローン、ファイル作成/追記、コミット・プッシュ
5. **Obsidian同期** → Git同期プラグインで自動更新

## 出力形式

メッセージは以下の形式で保存されます：

```markdown
## Timeline
- 14:30 Hello World
- 15:45 今日は良い天気です
```

ファイルパス：`01_diary/2025/2025-06-25.md`

## トラブルシューティング

### CloudWatch Logs確認

```bash
aws logs get-log-events \
  --log-group-name "/aws/lambda/line-obsidian-webhook-dev-webhook" \
  --log-stream-name "最新のログストリーム名" \
  --profile your-aws-profile
```

### よくある問題

- **Git not found エラー**: Lambda Layer でGitが追加されているか確認
- **署名検証失敗**: CHANNEL_SECRET が正しく設定されているか確認
- **リポジトリアクセス失敗**: GH_TOKEN の権限を確認

## ライセンス

MIT License

## 技術スタック

- **Runtime**: Node.js 20.x
- **Language**: TypeScript
- **Testing**: Jest
- **Deployment**: Serverless Framework
- **Cloud**: AWS Lambda + Function URL
- **Git**: simple-git library
