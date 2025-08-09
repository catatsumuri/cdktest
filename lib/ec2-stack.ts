import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

interface Ec2StackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
}

export class Ec2Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: Ec2StackProps) {
        super(scope, id, props);

        const role = new iam.Role(this, 'WebServerRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });
        role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        );

        const ami = ec2.MachineImage.genericLinux({
            'ap-northeast-1': 'ami-01ff1fcabf5f7572c',
        });

        const instance = new ec2.Instance(this, 'WebServer', {
            vpc: props.vpc,
            instanceType: new ec2.InstanceType('t3.micro'),
            machineImage: ami,
            role,
        });

        instance.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'HTTP');
    }
}
