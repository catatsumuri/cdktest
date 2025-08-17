import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';

interface EcsStackProps extends cdk.StackProps {
    envName: 'dev' | 'prod';
    vpc: ec2.IVpc;
}

export class EcsStack extends cdk.Stack {
    public readonly cluster: ecs.Cluster;

    constructor(scope: Construct, id: string, props: EcsStackProps) {
        super(scope, id, props);

        this.cluster = new ecs.Cluster(this, 'EcsCluster', {
            vpc: props.vpc,
            clusterName: `ecs-cluster-${props.envName}`,
            containerInsights: props.envName === 'prod',
        });

        const taskDef = new ecs.FargateTaskDefinition(this, 'NginxTaskDef', {
            cpu: 256, // 最小クラス
            memoryLimitMiB: 512, // 最小メモリ
        });

        taskDef.addContainer('NginxContainer', {
            // image: ecs.ContainerImage.fromRegistry('nginx:latest'), // Docker Hub
            // Docker Hub ではなく Public ECR ミラーを使う
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:stable'),
            portMappings: [{ containerPort: 80 }],
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'nginx' }),
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

        const sg = new ec2.SecurityGroup(this, 'NginxSvcSg', {
            vpc: props.vpc,
            allowAllOutbound: true,
            description: 'Allow HTTP from anywhere for nginx (training only)',
        });
        sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

        // サービス（単一タスク、ALBなし、Public直当て）
        new ecs.FargateService(this, 'NginxService', {
            cluster: this.cluster,
            taskDefinition: taskDef,
            desiredCount: 1,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            assignPublicIp: true,
            securityGroups: [sg],
            enableExecuteCommand: true,
        });
    }
}
