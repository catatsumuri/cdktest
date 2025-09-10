# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- このプロジェクトでは **すべての CDK コマンドは `npx cdk` を使用してください**。  
- `cdk` という短縮エイリアスやグローバルインストールは使用禁止です。

## プロジェクト概要

このプロジェクトは AWS CDK v2 を使用した TypeScript プロジェクトです。AWS リソースをコードで定義・デプロイするためのインフラストラクチャ as Code (IaC) プロジェクトです。

## 開発コマンド

### ビルドとコンパイル
```bash
npm run build      # TypeScript を JavaScript にコンパイル
npm run watch      # ファイル変更を監視して自動コンパイル
```

### テスト
```bash
npm test           # Jest 単体テストを実行
```

### CDK 操作
```bash
npx cdk synth      # CloudFormation テンプレートを合成・表示
npx cdk diff       # デプロイ済みスタックと現在の状態を比較
npx cdk deploy     # AWS アカウントにスタックをデプロイ
npx cdk bootstrap  # CDK ブートストラップ（初回デプロイ時のみ必要）
cdk                # CDK コマンドのエイリアス（package.json で定義）
```

## プロジェクト構造

### 重要なファイルとディレクトリ

- **`bin/app.ts`**: CDK アプリケーションのエントリーポイント。スタックをインスタンス化
- **`lib/claude-cdk-stack.ts`**: メインの CDK スタック定義。AWS リソースはここで定義
- **`test/claude-cdk.test.ts`**: Jest 単体テストファイル。CDK Assertions を使用してテスト
- **`cdk.json`**: CDK 設定ファイル。アプリケーションの実行方法を定義
- **`cdk.out/`**: CDK 合成出力ディレクトリ（自動生成）

### 開発ワークフロー

1. **初期セットアップ（新しい環境の場合）**:
   ```bash
   npm install
   npx cdk bootstrap  # AWS アカウント初期化（初回のみ）
   ```

2. **開発サイクル**:
   ```bash
   npm run watch                    # 自動コンパイル開始
   # lib/claude-cdk-stack.ts でリソース定義を編集
   npm test                         # テストを実行
   npx cdk diff                     # 変更内容を確認
   npx cdk deploy                   # AWS にデプロイ
   ```

## アーキテクチャ

### CDK スタック構造
- 単一スタック構成（`ClaudeCdkStack`）
- 現在は基本的なテンプレート状態
- AWS リソースは `lib/claude-cdk-stack.ts` の `constructor` 内で定義

### テスト構造
- Jest + CDK Assertions を使用
- CloudFormation テンプレートの検証が可能
- リソース数や設定値のテストをサポート

## 技術スタック

### 主要な依存関係
- **aws-cdk-lib**: AWS CDK v2 メインライブラリ
- **constructs**: CDK 構築要素ライブラリ
- **typescript**: TypeScript コンパイラ
- **jest**: テストフレームワーク

### TypeScript 設定
- Target: ES2022
- Strict モード有効
- Experimental Decorators 有効
- ソースマップ生成

## 重要な注意点

### AWS 認証
- AWS 認証情報が必要（AWS CLI、環境変数、IAM ロールなど）
- `cdk diff` や `cdk deploy` 実行時に AWS アカウントが必要
- 環境固有の設定は `bin/app.ts` でスタック定義時に指定可能

### CDK 機能フラグ
- `cdk.json` で多数の最新機能フラグが有効化済み
- CDK v2 の最新機能を利用可能

### デプロイメント
- 初回デプロイ前に `cdk bootstrap` が必要
- `cdk diff` で変更内容を確認してからデプロイすることを推奨
