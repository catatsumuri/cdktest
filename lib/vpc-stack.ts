import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class VpcStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // NATなし、パブリックサブネットのみのVPC
        const vpc = new ec2.Vpc(this, 'MyVpc', {
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
    }
}
