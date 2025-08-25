#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
// import { Ec2Stack } from '../lib/ec2-stack';
import { EcsStack } from '../lib/ecs-stack';
import { SsmStack } from '../lib/ssm-stack';

const app = new cdk.App();
const envName = app.node.tryGetContext('env') || 'dev';

// 共通タグ
cdk.Tags.of(app).add('Env', envName);

// スタック名にenvを含めてdev/prod共存可能に
const vpcStack = new VpcStack(app, `VpcStack-${envName}`, {
  envName,
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

// new Ec2Stack(app, `Ec2Stack-${envName}`, {
//   vpc: vpcStack.vpc,
//   envName,
//   // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
// });

const ecsStack = new EcsStack(app, `EcsStack-${envName}`, {
  envName,
  vpc: vpcStack.vpc,
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

const ssmStack = new SsmStack(app, `SsmStack-${envName}`, {
  envName,
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
ecsStack.addDependency(ssmStack);
