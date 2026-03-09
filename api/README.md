# Zeno API - AWS Lambda Backend

Serverless authentication and LLM analysis API for the Zeno student focus tracking app.

## Architecture

- **AWS Lambda**: Serverless functions for all endpoints
- **DynamoDB**: NoSQL database for users, rate limits, and analysis requests
- **API Gateway**: HTTP API for routing
- **Anthropic Claude**: LLM for personalized study insights

## Features

- ✅ User registration and authentication (JWT)
- ✅ Rate limiting per user (10/min free, 100/min paid)
- ✅ LLM-powered study analytics
- ✅ Response caching (24hr) to minimize costs
- ✅ Privacy-first: only anonymized session data sent to backend

## Setup

### Prerequisites

- Node.js 20+
- AWS CLI configured with credentials
- Anthropic API key

### Install Dependencies

```bash
cd api
npm install
```

### Configure Environment

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update `.env` with your values:
```env
JWT_SECRET=your-random-secret-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
SES_FROM_EMAIL=noreply@yourdomain.com
RATE_LIMIT_FREE=10
RATE_LIMIT_PAID=100
```

### Configure AWS SES

The API uses AWS SES for sending OTP codes via email. Before deploying:

1. **Verify your sender email** in AWS SES:
```bash
aws ses verify-email-identity --email-address noreply@yourdomain.com
```

2. **Check verification status**:
```bash
aws ses get-identity-verification-attributes --identities noreply@yourdomain.com
```

3. **Request production access** (for production):
   - By default, SES is in sandbox mode (can only send to verified emails)
   - Request production access in AWS Console: SES → Account Dashboard → Request production access
   - This allows sending to any email address

4. **Optional: Verify your domain** (recommended for production):
```bash
aws ses verify-domain-identity --domain yourdomain.com
```

### Local Development

Run API locally using serverless-offline:

```bash
npm run local
```

API will be available at `http://localhost:3000`

## Deployment

### Deploy to AWS

Deploy to development:
```bash
npm run deploy:dev
```

Deploy to production:
```bash
npm run deploy:prod
```

The deployment will:
1. Create DynamoDB tables (Users, RateLimits, AnalysisRequests)
2. Deploy Lambda functions
3. Set up API Gateway HTTP API
4. Configure IAM roles and permissions

After deployment, you'll get API endpoints like:
```
POST https://xxxxx.execute-api.us-east-1.amazonaws.com/auth/register
POST https://xxxxx.execute-api.us-east-1.amazonaws.com/auth/login
GET  https://xxxxx.execute-api.us-east-1.amazonaws.com/auth/me
POST https://xxxxx.execute-api.us-east-1.amazonaws.com/analysis/analyze
```

### View Logs

```bash
npm run logs -- -f register
npm run logs -- -f login
npm run logs -- -f analyze
```

### Remove Deployment

```bash
npm run remove
```

## API Endpoints

### Authentication (Passwordless OTP)

#### Request OTP Code
```bash
POST /auth/request-otp
Content-Type: application/json

{
  "email": "student@example.com"
}

Response:
{
  "message": "Verification code sent to your email",
  "expiresIn": 600
}
```

#### Verify OTP Code
```bash
POST /auth/verify-otp
Content-Type: application/json

{
  "email": "student@example.com",
  "code": "123456"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "student@example.com",
    "subscriptionTier": "free"
  }
}
```

#### Get Current User
```bash
GET /auth/me
Authorization: Bearer <token>

Response:
{
  "user": {
    "id": "uuid",
    "email": "student@example.com",
    "subscriptionTier": "free",
    "createdAt": 1678901234567
  }
}
```

### Analysis

#### Analyze Sessions
```bash
POST /analysis/analyze
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessions": [
    {
      "startTime": "2024-03-09T10:00:00Z",
      "endTime": "2024-03-09T11:30:00Z",
      "durationMinutes": 90,
      "avgStress": 45,
      "avgHeartRate": 72,
      "avgRespiratoryRate": 16,
      "avgPostureScore": 85,
      "quality": 78
    }
  ],
  "personalizedZones": {
    "optimalStress": { "min": 35, "max": 55 },
    "optimalHeartRate": { "min": 65, "max": 80 },
    "optimalDuration": { "min": 60, "max": 90 }
  }
}

Response:
{
  "insights": "# Patterns Identified...",
  "cached": false,
  "tokensUsed": 1250
}
```

Rate limit exceeded response (429):
```json
{
  "error": "Rate limit exceeded",
  "details": {
    "resetIn": 45,
    "limit": 10
  }
}
```

## Database Schema

### Users Table
- **Primary Key**: `id` (String, UUID)
- **GSI**: `EmailIndex` on `email`
- **Attributes**: email, subscriptionTier, createdAt, updatedAt

### OTPCodes Table
- **Primary Key**: `email` (String)
- **TTL**: `expiresAt` (automatic cleanup after expiration)
- **Attributes**: code, attempts, expiresAt, createdAt

### RateLimits Table
- **Primary Key**: `userId` (String)
- **Sort Key**: `windowStart` (Number, timestamp)
- **TTL**: `ttl` (automatic cleanup after 2 minutes)
- **Attributes**: count

### AnalysisRequests Table
- **Primary Key**: `id` (String, UUID)
- **GSI**: `UserIdCreatedAtIndex` on `userId` + `createdAt`
- **Attributes**: userId, sessionCount, tokensUsed, cached, insights, createdAt

## Cost Optimization

1. **Caching**: Analysis results cached for 24hrs (same session count ±10%)
2. **Rate Limiting**: Prevents abuse (10 req/min free, 100 req/min paid)
3. **Pay-per-request**: DynamoDB and Lambda only charge for actual usage
4. **Efficient Prompts**: Optimized Claude prompts to minimize token usage

## Security

- **Passwordless authentication** via email OTP (more secure than passwords)
- OTP codes expire after 10 minutes
- Maximum 5 verification attempts per code
- Single-use codes (deleted after successful verification)
- JWT tokens with 7-day expiration
- Rate limiting per user (prevents brute force)
- CORS enabled for frontend
- API keys stored as environment variables (never exposed to client)
- SES email delivery with HTML templates

## Monitoring

View CloudWatch logs:
```bash
aws logs tail /aws/lambda/zeno-api-dev-register --follow
aws logs tail /aws/lambda/zeno-api-dev-analyze --follow
```

Monitor DynamoDB tables:
```bash
aws dynamodb describe-table --table-name zeno-api-users-dev
```

## Next Steps

1. **Frontend Integration**: Update Tauri app to call these endpoints
2. **Subscription Management**: Integrate Stripe for paid tier
3. **Email Verification**: Add email verification flow
4. **Password Reset**: Implement forgot password functionality
5. **Usage Analytics**: Track token usage per user for billing
