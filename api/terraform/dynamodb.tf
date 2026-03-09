# Users Table
resource "aws_dynamodb_table" "users" {
  name           = "${local.app_name}-users-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }

  tags = merge(local.common_tags, {
    Name = "${local.app_name}-users-${var.environment}"
  })
}

# Rate Limits Table
resource "aws_dynamodb_table" "rate_limits" {
  name           = "${local.app_name}-rate-limits-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "userId"
  range_key      = "windowStart"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "windowStart"
    type = "N"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "${local.app_name}-rate-limits-${var.environment}"
  })
}

# Analysis Requests Table
resource "aws_dynamodb_table" "analysis_requests" {
  name           = "${local.app_name}-analysis-requests-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "N"
  }

  global_secondary_index {
    name            = "UserIdCreatedAtIndex"
    hash_key        = "userId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  tags = merge(local.common_tags, {
    Name = "${local.app_name}-analysis-requests-${var.environment}"
  })
}
