import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

interface VpcStackProps extends cdk.StackProps {
  envName: 'dev' | 'prod';
}

export class VpcStack extends cdk.Stack {
    public readonly vpc: ec2.Vpc;

    constructor(scope: Construct, id: string, props: VpcStackProps) {
        super(scope, id, props);

        // NATなし、パブリックサブネットのみのVPC
        this.vpc = new ec2.Vpc(this, 'MyVpc', {
            maxAzs: 2, // 2つのAZに配置
            natGateways: 0, // NAT Gatewayは作らない
            subnetConfiguration: [
                {
                    subnetType: ec2.SubnetType.PUBLIC,
                    name: 'PublicSubnet',
                    cidrMask: 24,
                },
            ],
        });
        new cdk.CfnOutput(this, 'CurrentEnv', {
            value: props.envName,
            description: 'Current environment name (dev or prod)',
        });

        // ---------------------------------------------------------
        // 提案: 本番環境 (prod) のみ VPC フローログを有効化
        // 理由:
        //   - ネットワークトラブルやセキュリティ調査用の証跡
        //   - REJECT のみ記録にしてコスト削減
        // コメントアウトを外すと有効化されます
        // ---------------------------------------------------------
        /*
        if (props.envName === 'prod') {
            const logGroup = new logs.LogGroup(this, 'VpcFlowLogGroup', {
                retention: logs.RetentionDays.ONE_MONTH,
            });

            new ec2.FlowLog(this, 'VpcFlowLog', {
                resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
                trafficType: ec2.FlowLogTrafficType.REJECT, // ALL にするとコスト増
                destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup),
            });
        }
        */
    }
}
