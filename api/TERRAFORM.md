# Terraform Deployment Guide

This guide covers deploying the Zeno API using Terraform for infrastructure as code.

## Prerequisites

1. **Terraform** installed (v1.0+)
   ```bash
   brew install terraform  # macOS
   ```

2. **AWS CLI** configured with credentials
   ```bash
   aws configure
   ```

3. **Node.js** 20+ installed

## Setup

### 1. Install Dependencies

```bash
cd api
npm install
```

### 2. Configure Variables

Create `terraform/terraform.tfvars`:

```hcl
aws_region        = "us-east-1"
environment       = "dev"
jwt_secret        = "your-random-jwt-secret-here"
anthropic_api_key = "sk-ant-your-api-key-here"
rate_limit_free   = 10
rate_limit_paid   = 100
```

**Security Note**: Never commit `terraform.tfvars` to git. It's already in `.gitignore`.

### 3. Configure S3 Backend (Optional but Recommended)

For production, store Terraform state in S3:

1. Create an S3 bucket:
   ```bash
   aws s3 mb s3://zeno-terraform-state --region us-east-1
   ```

2. Enable versioning:
   ```bash
   aws s3api put-bucket-versioning \
     --bucket zeno-terraform-state \
     --versioning-configuration Status=Enabled
   ```

3. Uncomment the backend configuration in `terraform/main.tf`:
   ```hcl
   backend "s3" {
     bucket = "zeno-terraform-state"
     key    = "api/terraform.tfstate"
     region = "us-east-1"
   }
   ```

## Deployment

### Build Lambda Package

```bash
npm run build
```

This will:
1. Compile TypeScript to JavaScript
2. Bundle all dependencies with esbuild
3. Create `dist/lambda.zip` deployment package

### Initialize Terraform

```bash
npm run tf:init
```

Or directly:
```bash
cd terraform
terraform init
```

### Review Infrastructure Plan

```bash
npm run tf:plan
```

This shows what resources will be created:
- 3 DynamoDB tables (Users, RateLimits, AnalysisRequests)
- 4 Lambda functions (register, login, me, analyze)
- API Gateway HTTP API
- IAM roles and policies
- CloudWatch log groups

### Deploy

```bash
npm run tf:apply
```

Or with auto-approve (use carefully):
```bash
cd terraform
terraform apply -auto-approve
```

After deployment completes, Terraform will output your API endpoint:
```
api_endpoint = "https://xxxxx.execute-api.us-east-1.amazonaws.com"
```

## Infrastructure Overview

### DynamoDB Tables

**Users Table**
- Primary Key: `id` (UUID)
- GSI: `EmailIndex` on `email` field
- Billing: Pay-per-request

**RateLimits Table**
- Composite Key: `userId` (hash) + `windowStart` (range)
- TTL enabled on `ttl` attribute (auto-cleanup)
- Billing: Pay-per-request

**AnalysisRequests Table**
- Primary Key: `id` (UUID)
- GSI: `UserIdCreatedAtIndex` on `userId` + `createdAt`
- Billing: Pay-per-request

### Lambda Functions

All functions use:
- Runtime: Node.js 20.x
- Architecture: x86_64
- Memory: 256MB (auth), 512MB (analyze)
- Timeout: 10s (auth), 30s (analyze)

### API Gateway

- Protocol: HTTP API (cheaper than REST API)
- CORS: Enabled for all origins (configure for production)
- Stage: `$default` with auto-deploy
- Logging: CloudWatch Logs (7-day retention)

## Updating Deployment

### Update Code

1. Make changes to TypeScript source
2. Rebuild:
   ```bash
   npm run build
   ```
3. Redeploy:
   ```bash
   npm run tf:apply
   ```

Terraform will detect the code change and update Lambda functions.

### Update Infrastructure

Modify `.tf` files and run:
```bash
npm run tf:plan   # Review changes
npm run tf:apply  # Apply changes
```

## Environments

### Multiple Environments

Deploy separate dev/staging/prod environments:

```bash
# Development
terraform apply -var="environment=dev"

# Staging
terraform apply -var="environment=staging"

# Production
terraform apply -var="environment=prod"
```

Each environment gets isolated resources:
- `zeno-api-users-dev`
- `zeno-api-users-staging`
- `zeno-api-users-prod`

### Workspace Approach

Alternatively, use Terraform workspaces:

```bash
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

terraform workspace select dev
terraform apply
```

## Monitoring

### View Lambda Logs

```bash
aws logs tail /aws/lambda/zeno-api-register-dev --follow
aws logs tail /aws/lambda/zeno-api-analyze-dev --follow
```

### CloudWatch Dashboards

Create a dashboard to monitor:
- Lambda invocations, errors, duration
- DynamoDB read/write capacity
- API Gateway requests, 4xx/5xx errors

### Alarms

Set up CloudWatch alarms for:
- Lambda error rate > 5%
- API Gateway 5xx errors > 1%
- DynamoDB throttled requests

## Cost Estimation

### DynamoDB
- **Pay-per-request**: $1.25 per million writes, $0.25 per million reads
- Typical cost: ~$5-20/month for 10k users

### Lambda
- **Requests**: $0.20 per 1M requests
- **Duration**: $0.0000166667 per GB-second
- Typical cost: ~$10-50/month for 100k requests

### API Gateway
- **HTTP API**: $1.00 per million requests
- Typical cost: ~$1-10/month

### Data Transfer
- First 100 GB/month free
- $0.09/GB after

**Estimated monthly cost**: $20-100 depending on usage

## Security

### Secrets Management

For production, use AWS Secrets Manager:

```hcl
resource "aws_secretsmanager_secret" "api_keys" {
  name = "${local.app_name}-secrets-${var.environment}"
}

resource "aws_secretsmanager_secret_version" "api_keys" {
  secret_id = aws_secretsmanager_secret.api_keys.id
  secret_string = jsonencode({
    jwt_secret        = var.jwt_secret
    anthropic_api_key = var.anthropic_api_key
  })
}
```

Then update Lambda to read from Secrets Manager instead of environment variables.

### IAM Best Practices

- Principle of least privilege (already implemented)
- Lambda functions can only access their specific DynamoDB tables
- No wildcard permissions

### Network Security

For enhanced security, deploy Lambda in VPC:
- Add VPC, subnets, security groups to Terraform
- Configure Lambda VPC settings
- Add VPC endpoints for DynamoDB, Secrets Manager

## Troubleshooting

### Build Errors

```bash
# Clear and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### Terraform State Locked

```bash
# Force unlock (use with caution)
terraform force-unlock <lock-id>
```

### Lambda Deployment Failed

Check Lambda function size limit (50MB zipped, 250MB unzipped):
```bash
ls -lh dist/lambda.zip
```

If too large, exclude unnecessary dependencies in `scripts/bundle.js`.

### DynamoDB Access Denied

Verify IAM permissions in `terraform/lambda.tf`. Check CloudWatch Logs for specific error.

## Cleanup

### Destroy Infrastructure

```bash
npm run tf:destroy
```

Or:
```bash
cd terraform
terraform destroy
```

**Warning**: This permanently deletes all data in DynamoDB tables.

### Selective Destroy

Remove specific resources:
```bash
terraform destroy -target=aws_lambda_function.analyze
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy API

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        working-directory: api
        run: npm ci

      - name: Build Lambda package
        working-directory: api
        run: npm run build

      - uses: hashicorp/setup-terraform@v2

      - name: Terraform Init
        working-directory: api/terraform
        run: terraform init
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      - name: Terraform Apply
        working-directory: api/terraform
        run: terraform apply -auto-approve
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          TF_VAR_jwt_secret: ${{ secrets.JWT_SECRET }}
          TF_VAR_anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Next Steps

1. **Custom Domain**: Add Route53 + ACM certificate
2. **WAF**: Add AWS WAF for DDoS protection
3. **Monitoring**: Set up CloudWatch dashboards and alarms
4. **Backup**: Enable DynamoDB point-in-time recovery
5. **Testing**: Add integration tests with Terraform
