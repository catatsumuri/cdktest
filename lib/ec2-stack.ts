import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

interface Ec2StackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
    envName: 'dev' | 'prod';
}

export class Ec2Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: Ec2StackProps) {
        super(scope, id, props);

        const role = new iam.Role(this, 'WebServerRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });
        role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

        const ami = ec2.MachineImage.genericLinux({
            'ap-northeast-1': 'ami-01ff1fcabf5f7572c',
        });

        const userData = ec2.UserData.forLinux();
        userData.addCommands(
            'set -euxo pipefail',
            'export DEBIAN_FRONTEND=noninteractive',
            'apt-get update -y',
            'apt-get install -y apache2',
            'systemctl enable apache2',
            'systemctl start apache2',
        );

        const targetAz = 'ap-northeast-1c';
        const subnetSel = props.vpc.selectSubnets({
            subnetGroupName: 'PublicSubnet',
            availabilityZones: [targetAz],
        });
        if (subnetSel.subnets.length === 0) {
            throw new Error(`PublicSubnet(${targetAz}) が見つかりません。`);
        }
        const primarySubnet = subnetSel.subnets[0];

        const instance = new ec2.Instance(this, 'WebServer', {
            vpc: props.vpc,
            vpcSubnets: { subnets: [primarySubnet] },
            instanceType: new ec2.InstanceType('t3.micro'),
            machineImage: ami,
            role,
            userData,
        });

        instance.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'HTTP');

        let volumeId: string;
        let dataVolume: ec2.CfnVolume | undefined;
        const nameTag = `${this.stackName}/web-data-${props.envName}`;
        if (props.envName === 'prod') {
            // prod: 既存 Volume を Name, AZ, Envタグで検索してアタッチ
            const findVolume = new AwsCustomResource(this, 'FindExistingWebDataVolume', {
                onUpdate: {
                    service: 'EC2',
                    action: 'describeVolumes',
                    parameters: {
                        Filters: [
                            { Name: 'tag:Name', Values: [nameTag] },
                            { Name: 'tag:Env', Values: [props.envName] },
                            { Name: 'availability-zone',  Values: [targetAz] },
                        ],
                    },
                    physicalResourceId: PhysicalResourceId.of(`${this.stackName}-FindWebDataVolume`),
                },
                policy: AwsCustomResourcePolicy.fromStatements([
                    new iam.PolicyStatement({
                        actions: ['ec2:DescribeVolumes'],
                        resources: ['*'],
                    }),
                ]),
            });
            volumeId = findVolume.getResponseField('Volumes.0.VolumeId');


        } else {
            dataVolume = new ec2.CfnVolume(this, 'DataVolume', {
                availabilityZone: instance.instanceAvailabilityZone,
                size: 20, // GiB
                volumeType: 'gp3',
                encrypted: true, // 暗号化
                tags: [
                    {
                        key: 'Name',
                        value: `${this.stackName}/web-data-${props.envName}`, // web-dataという名前を基本軸にしている
                    },
                ],
            });
            dataVolume.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
            volumeId = dataVolume.ref;
        }

        const attachment = new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
            device: '/dev/sdf',
            instanceId: instance.instanceId,
            volumeId,
        });
        // ---- 依存関係を明示して順序保証（インスタンス→Vol解決/作成→アタッチ）
        /*
        const cfnInstance = instance.node.defaultChild as ec2.CfnInstance;
        attachment.node.addDependency(cfnInstance);
        if (props.envName === 'prod') {
            const find = this.node.findChild('FindExistingWebDataVolume') as AwsCustomResource;
            attachment.node.addDependency(find);
        } else if (dataVolume) {
            attachment.node.addDependency(dataVolume);
        }
        */

        userData.addCommands(
            '# ---- EBS 初期化/マウント（Ubuntu向け: /sys/devices/.../nvme*/serial を利用 → UUID/fstab）',
            `TARGET_VOL_ID='${volumeId}'`,
            // Ubuntu環境では serial 値が "vol" プレフィックス付き + ハイフン無し
            'TARGET_VOL_ID_WITH_PREFIX=${TARGET_VOL_ID//-/}',
            'echo "Target EBS Volume: ${TARGET_VOL_ID} (serial match: ${TARGET_VOL_ID_WITH_PREFIX})"',

            'DEV=""',
            '# NVMeコントローラの serial ファイルを直接検索 (Ubuntu仕様)',
            'for SERIAL_PATH in $(find /sys/devices/ -path "*/nvme/nvme*/serial" -type f); do',
            '  S=$(cat "$SERIAL_PATH" 2>/dev/null || true)',
            '  if [ "$S" = "$TARGET_VOL_ID_WITH_PREFIX" ]; then',
            '    NVME_NAME=$(basename "$(dirname "$SERIAL_PATH")")',
            '    DEV="/dev/${NVME_NAME}n1"',
            '    [ -b "${DEV}p1" ] && DEV="${DEV}p1"',
            '    break',
            '  fi',
            'done',

            'if [ -z "$DEV" ]; then echo "ERROR: target NVMe device not found for serial ${TARGET_VOL_ID_WITH_PREFIX}"; exit 1; fi',
            'echo "Resolved device: ${DEV}"',

            '# 未フォーマットなら作成（初回のみ）',
            'if ! blkid "${DEV}" >/dev/null 2>&1; then',
            '  mkfs.ext4 -L DATA "${DEV}"',
            '  tune2fs -m 0 "${DEV}"',
            'fi',

            'UUID=$(blkid -s UUID -o value "${DEV}")',
            'mkdir -p /data',
            'grep -q "^UUID=${UUID} " /etc/fstab || echo "UUID=${UUID} /data ext4 defaults,nofail,noatime 0 2" >> /etc/fstab',
            'mount -a',
            'chown root:root /data',
            'chmod 755 /data',
        );
    }
}
