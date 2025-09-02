import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

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
            containerInsights: !isDev,
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
            command: [
                'sh',
                '-c',
                [
                    // タスクごとに異なる識別子（ホスト名＝コンテナID相当 & ランダムUUID）
                    'HOST=$(cat /etc/hostname)',
                    'UUID=$(cat /proc/sys/kernel/random/uuid)',
                    // 適当なHTMLを書き込み
                    'mkdir -p /usr/share/nginx/html',
                    'echo "<html><body style=\'font-family:sans-serif\'>" > /usr/share/nginx/html/index.html',
                    'echo "<h1>Hello from $HOST</h1>" >> /usr/share/nginx/html/index.html',
                    'echo "<p>uuid: $UUID</p>" >> /usr/share/nginx/html/index.html',
                    'echo "</body></html>" >> /usr/share/nginx/html/index.html',
                    // nginx をフォアグラウンドで
                    "nginx -g 'daemon off;'",
                ].join(' && '),
            ],
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

        // サービス（単一タスク、ALBなし、Public直当て）
        const service = new ecs.FargateService(this, 'WebService', {
            cluster: this.cluster,
            taskDefinition: taskDef,
            desiredCount: 2,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            assignPublicIp: true,
            securityGroups: [srvSg],
            enableExecuteCommand: true,
            serviceName: webServiceName, // dev-web / prod-web
        });

        // サービスをターゲットグループに登録（タスクENIのIPが自動でTGに入る）
        service.attachToApplicationTargetGroup(tg);
    }
}
