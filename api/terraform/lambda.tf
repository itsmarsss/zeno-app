# IAM Role for Lambda
resource "aws_iam_role" "lambda_exec" {
  name = "${local.app_name}-lambda-exec-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

# IAM Policy for DynamoDB access
resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "${local.app_name}-lambda-dynamodb-${var.environment}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.users.arn,
          "${aws_dynamodb_table.users.arn}/index/*",
          aws_dynamodb_table.otp_codes.arn,
          aws_dynamodb_table.rate_limits.arn,
          "${aws_dynamodb_table.rate_limits.arn}/index/*",
          aws_dynamodb_table.analysis_requests.arn,
          "${aws_dynamodb_table.analysis_requests.arn}/index/*"
        ]
      }
    ]
  })
}

# IAM Policy for SES access
resource "aws_iam_role_policy" "lambda_ses" {
  name = "${local.app_name}-lambda-ses-${var.environment}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      }
    ]
  })
}

# Attach basic Lambda execution role
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Environment variables for Lambda functions
locals {
  lambda_environment = {
    USERS_TABLE              = aws_dynamodb_table.users.name
    OTP_CODES_TABLE          = aws_dynamodb_table.otp_codes.name
    RATE_LIMITS_TABLE        = aws_dynamodb_table.rate_limits.name
    ANALYSIS_REQUESTS_TABLE  = aws_dynamodb_table.analysis_requests.name
    JWT_SECRET               = var.jwt_secret
    ANTHROPIC_API_KEY        = var.anthropic_api_key
    SES_FROM_EMAIL           = var.ses_from_email
    RATE_LIMIT_FREE          = tostring(var.rate_limit_free)
    RATE_LIMIT_PAID          = tostring(var.rate_limit_paid)
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
  }
}

# Lambda functions will be created from deployment artifact
# You'll need to build and zip your code first

# Request OTP Lambda
resource "aws_lambda_function" "request_otp" {
  filename         = "../dist/lambda.zip"
  function_name    = "${local.app_name}-request-otp-${var.environment}"
  role            = aws_iam_role.lambda_exec.arn
  handler         = "handlers/auth.requestOTP"
  source_code_hash = fileexists("../dist/lambda.zip") ? filebase64sha256("../dist/lambda.zip") : ""
  runtime         = "nodejs20.x"
  timeout         = 10
  memory_size     = 256

  environment {
    variables = local.lambda_environment
  }

  tags = local.common_tags

  lifecycle {
    ignore_changes = [source_code_hash]
  }
}

# Verify OTP Lambda
resource "aws_lambda_function" "verify_otp" {
  filename         = "../dist/lambda.zip"
  function_name    = "${local.app_name}-verify-otp-${var.environment}"
  role            = aws_iam_role.lambda_exec.arn
  handler         = "handlers/auth.verifyOTP"
  source_code_hash = fileexists("../dist/lambda.zip") ? filebase64sha256("../dist/lambda.zip") : ""
  runtime         = "nodejs20.x"
  timeout         = 10
  memory_size     = 256

  environment {
    variables = local.lambda_environment
  }

  tags = local.common_tags

  lifecycle {
    ignore_changes = [source_code_hash]
  }
}

# Me Lambda
resource "aws_lambda_function" "me" {
  filename         = "../dist/lambda.zip"
  function_name    = "${local.app_name}-me-${var.environment}"
  role            = aws_iam_role.lambda_exec.arn
  handler         = "handlers/auth.me"
  source_code_hash = fileexists("../dist/lambda.zip") ? filebase64sha256("../dist/lambda.zip") : ""
  runtime         = "nodejs20.x"
  timeout         = 10
  memory_size     = 256

  environment {
    variables = local.lambda_environment
  }

  tags = local.common_tags

  lifecycle {
    ignore_changes = [source_code_hash]
  }
}

# Analyze Lambda
resource "aws_lambda_function" "analyze" {
  filename         = "../dist/lambda.zip"
  function_name    = "${local.app_name}-analyze-${var.environment}"
  role            = aws_iam_role.lambda_exec.arn
  handler         = "handlers/analysis.analyze"
  source_code_hash = fileexists("../dist/lambda.zip") ? filebase64sha256("../dist/lambda.zip") : ""
  runtime         = "nodejs20.x"
  timeout         = 30
  memory_size     = 512

  environment {
    variables = local.lambda_environment
  }

  tags = local.common_tags

  lifecycle {
    ignore_changes = [source_code_hash]
  }
}
