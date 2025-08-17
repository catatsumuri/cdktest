# CDK TypeScript Project

このリポジトリは AWS CDK を用いた TypeScript プロジェクトである。`cdk.json` は CDK Toolkit にアプリの実行方法を指示する。

## Useful commands

* `npm run build`   TypeScript をコンパイルして JS を生成
* `npm run watch`   ファイル変更を監視し自動コンパイル
* `npm run test`    Jest によるユニットテストを実行
* `npx cdk deploy`  スタックをデプロイ
* `npx cdk diff`    現在の状態とデプロイ済みとの差分を比較
* `npx cdk synth`   CloudFormation テンプレートを生成


### タスクへ接続するコマンド例

```sh
aws ecs execute-command \
  --region ap-northeast-1 \
  --cluster <CLUSTER_NAME> \
  --task <TASK_ID> \
  --container <CONTAINER_NAME> \
  --interactive \
  --command "/bin/sh"
```

この設定により、稼働中のタスクに直接シェルで接続できるようになる。
