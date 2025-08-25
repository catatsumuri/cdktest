import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { SecureStringParameter, ValueType } from 'cdk-secure-string-parameter';
import * as crypto from 'crypto';

export interface SsmStackProps extends cdk.StackProps {
    envName: 'dev' | 'prod';
}

export class SsmStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: SsmStackProps) {
        super(scope, id, props);

        new ssm.StringParameter(this, 'DemoParameter', {
            parameterName: `/demo/${props.envName}/message`,
            stringValue: `Hello from CDK (${props.envName})`,
            description: 'A demo parameter created by CDK',
        });

        new SecureStringParameter(this, 'SecureDemoParameter', {
            parameterName: `/demo/${props.envName}/db_password`,
            stringValue: crypto.randomBytes(16).toString('hex'),
            description: 'A secure demo parameter created by CDK',
            valueType: ValueType.PLAINTEXT,
        });
    }
}
