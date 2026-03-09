terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Configure this with your S3 bucket for state storage
    # bucket = "zeno-terraform-state"
    # key    = "api/terraform.tfstate"
    # region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "dev"
}

variable "jwt_secret" {
  description = "JWT secret for token signing"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key"
  type        = string
  sensitive   = true
}

variable "rate_limit_free" {
  description = "Rate limit for free tier (requests per minute)"
  type        = number
  default     = 10
}

variable "rate_limit_paid" {
  description = "Rate limit for paid tier (requests per minute)"
  type        = number
  default     = 100
}

variable "ses_from_email" {
  description = "Verified SES email address for sending OTPs"
  type        = string
  default     = "noreply@zeno.app"
}

# Local variables
locals {
  app_name = "zeno-api"
  common_tags = {
    Project     = "Zeno"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}
