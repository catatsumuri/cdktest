import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

interface Ec2StackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
}

export class Ec2Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: Ec2StackProps) {
        super(scope, id, props);

        const instance = new ec2.Instance(this, 'WebServer', {
            vpc: props.vpc,
            instanceType: new ec2.InstanceType('t3.micro'),
            machineImage: ec2.MachineImage.latestAmazonLinux2023(),
            keyName: 'your-keypair',
        });

        instance.connections.allowFromAnyIpv4(ec2.Port.tcp(22), 'SSH');
        instance.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'HTTP');
    }
}
