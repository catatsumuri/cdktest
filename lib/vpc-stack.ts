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
    }
}
