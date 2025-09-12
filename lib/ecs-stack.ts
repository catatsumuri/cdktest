import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';

interface EcsStackProps extends cdk.StackProps {
    envName: 'dev' | 'prod';
    vpc: ec2.IVpc;
}

export class EcsStack extends cdk.Stack {
    public readonly cluster: ecs.Cluster;

    constructor(scope: Construct, id: string, props: EcsStackProps) {
        super(scope, id, props);

        const isDev = props.envName === 'dev';
        const clusterName = `ecs-cluster-${props.envName}`;
        const webServiceName = `${props.envName}-web`;

        const webLogGroupName = `/aws/ecs/${clusterName}/${webServiceName}`;
        const execLogGroupName = `/aws/ecs/${clusterName}/exec`;

        // Upsert
        new logs.LogRetention(this, 'WebLogRetention', {
            logGroupName: webLogGroupName,
            retention: isDev ? logs.RetentionDays.TWO_WEEKS : logs.RetentionDays.SIX_MONTHS,
        });
        // Exec ログ用 LogGroup を用意（上書き先）
        new logs.LogRetention(this, 'ExecLogRetention', {
            logGroupName: execLogGroupName,
            retention: isDev ? logs.RetentionDays.ONE_WEEK : logs.RetentionDays.ONE_MONTH,
        });

        // 以降は参照のみ（＝CFNが再作成しに行かない）
        const webLogGroup = logs.LogGroup.fromLogGroupName(this, 'WebLogGroupImported', webLogGroupName);
        const execLogGroup = logs.LogGroup.fromLogGroupName(this, 'ExecLogGroupImported', execLogGroupName);

        this.cluster = new ecs.Cluster(this, 'EcsCluster', {
            vpc: props.vpc,
            clusterName,
            // containerInsights: !isDev,
            containerInsights: true,
            executeCommandConfiguration: {
                logging: ecs.ExecuteCommandLogging.OVERRIDE,
                logConfiguration: {
                    cloudWatchLogGroup: execLogGroup,
                    cloudWatchEncryptionEnabled: false,
                },
            },
        });

        const taskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
            cpu: 256, // 最小クラス
            memoryLimitMiB: 512, // 最小メモリ
        });

        const messageParam = ssm.StringParameter.fromStringParameterName(
            this,
            'MessageParam',
            `/demo/${props.envName}/message`,
        );
        const dbPasswordParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'DbPasswordParam', {
            parameterName: `/demo/${props.envName}/db_password`,
            // version: 1, // 必要なら固定
        });
        // 起動時に ECS が取りに行くので executionRole にのみ付与（最小権限）
        const execRole = taskDef.obtainExecutionRole();
        messageParam.grantRead(execRole);
        dbPasswordParam.grantRead(execRole);

        const startupScript = `
set -eu
export DEBIAN_FRONTEND=noninteractive

apt-get -qq update >/dev/null 2>&1
apt-get -qq -y --no-install-recommends install stress-ng procps >/dev/null 2>&1
rm -rf /var/lib/apt/lists/*

HOST="$(cat /etc/hostname)"
UUID="$(cat /proc/sys/kernel/random/uuid)"

BURN_CPUS="${'$'}{BURN_CPUS:-0}"
BURN_SECS=${'$'}{BURN_SECS:-0}

mkdir -p /usr/share/nginx/html
cat > /usr/share/nginx/html/index.html <<HTML
<html>
  <body style="font-family:sans-serif">
    <h1>Hello from $HOST</h1>
    <p>uuid: $UUID</p>
    <p>burn.cpus: $BURN_CPUS</p>
  </body>
</html>
HTML


stress-ng --cpu "$BURN_CPUS" --timeout "$BURN_SECS" &
# フォアグラウンドで nginx を実行
exec nginx -g 'daemon off;'
`;

        taskDef.addContainer('NginxContainer', {
            // image: ecs.ContainerImage.fromRegistry('nginx:latest'), // Docker Hub
            // Docker Hub ではなく Public ECR ミラーを使う
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:stable'),
            portMappings: [{ containerPort: 80 }],
            logging: ecs.LogDrivers.awsLogs({
                logGroup: webLogGroup,
                streamPrefix: 'nginx', // 役割だけをprefixに
            }),
            secrets: {
                APP_MESSAGE: ecs.Secret.fromSsmParameter(messageParam),
                DB_PASSWORD: ecs.Secret.fromSsmParameter(dbPasswordParam),
            },
            environment: isDev
                ? {
                      BURN_CPUS: '2',
                      BURN_SECS: '300',
                  }
                : {},
            command: ['sh', '-c', startupScript],
        });

        // (必須) SSM Messages チャネル用の権限
        taskDef.addToTaskRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    'ssmmessages:CreateControlChannel',
                    'ssmmessages:CreateDataChannel',
                    'ssmmessages:OpenControlChannel',
                    'ssmmessages:OpenDataChannel',
                ],
                resources: ['*'],
            }),
        );

        const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
            vpc: props.vpc,
            allowAllOutbound: true,
            description: 'ALB security group',
        });
        // インターネットから80番だけ開放（HTTPS不要とのことなので443は作らない）
        albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from Internet');

        const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
            vpc: props.vpc,
            internetFacing: true,
            securityGroup: albSg,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        });

        // Target Group（Fargate=IPターゲット）
        const tg = new elbv2.ApplicationTargetGroup(this, 'WebTg', {
            vpc: props.vpc,
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: '/', // 必要に応じて /health へ
                interval: cdk.Duration.seconds(30),
                // 200 だけに縛ると事故りやすい。実運用は 200-399 を推奨
                healthyHttpCodes: '200-399',
            },
        });

        // HTTP/80 リスナーを作って TG へフォワード
        const httpListener = alb.addListener('HttpListener', { port: 80, open: true });
        httpListener.addTargetGroups('DefaultTg', { targetGroups: [tg] });

        const srvSg = new ec2.SecurityGroup(this, 'WebSvcSg', {
            vpc: props.vpc,
            allowAllOutbound: true,
            description: `Allow HTTP only from ALB for web (${isDev ? 'dev' : 'prod'})`,
        });
        srvSg.addIngressRule(albSg, ec2.Port.tcp(80), 'HTTP from ALB');

        // サービス（キャパシティープロバイダー戦略を使用）
        const service = new ecs.FargateService(this, 'WebService', {
            cluster: this.cluster,
            taskDefinition: taskDef,
            desiredCount: 2,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            assignPublicIp: true,
            securityGroups: [srvSg],
            enableExecuteCommand: true,
            serviceName: webServiceName, // dev-web / prod-web
            capacityProviderStrategies: [
                {
                    capacityProvider: 'FARGATE',
                    weight: 1,
                    base: 0,
                },
                {
                    capacityProvider: 'FARGATE_SPOT',
                    weight: 1, 
                    base: 0,
                }
            ],
        });

        // Auto Scaling: CPU 80%を目標（常時100%なので必ず増殖→maxまで）
        const scalable = service.autoScaleTaskCount({
            minCapacity: 2, // 既定 desiredCount と合わせる
            maxCapacity: 3, // 観察用に抑えめ（必要なら増やす）
        });

        scalable.scaleOnCpuUtilization('CPU80', {
            targetUtilizationPercent: 80,
            // 観察が目的なので縮小は遅らせる／拡大は早め
            scaleOutCooldown: cdk.Duration.seconds(30),
            scaleInCooldown: cdk.Duration.minutes(10),
        });

        // サービスをターゲットグループに登録（タスクENIのIPが自動でTGに入る）
        service.attachToApplicationTargetGroup(tg);
    }
}
