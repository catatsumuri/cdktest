import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

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

        const messageParam = ssm.StringParameter.fromStringParameterName(
            this,
            'MessageParam',
            `/demo/${props.envName}/message`,
        );
        const dbPasswordParam = ssm.StringParameter.fromSecureStringParameterAttributes(
            this,
            'DbPasswordParam',
            {
                parameterName: `/demo/${props.envName}/db_password`,
                // version: 1, // 必要なら固定
            },
        );
        // 起動時に ECS が取りに行くので executionRole にのみ付与（最小権限）
        const execRole = taskDef.obtainExecutionRole();
        messageParam.grantRead(execRole);
        dbPasswordParam.grantRead(execRole);

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

        const sg = new ec2.SecurityGroup(this, 'WebSvcSg', {
            vpc: props.vpc,
            allowAllOutbound: true,
            description: `Allow HTTP from anywhere for web (${isDev ? 'dev' : 'prod'})`,
        });
        sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

        // サービス（単一タスク、ALBなし、Public直当て）
        new ecs.FargateService(this, 'WebService', {
            cluster: this.cluster,
            taskDefinition: taskDef,
            desiredCount: 1,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            assignPublicIp: true,
            securityGroups: [sg],
            enableExecuteCommand: true,
            serviceName: webServiceName, // dev-web / prod-web
        });
    }
}
