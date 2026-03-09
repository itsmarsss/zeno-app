output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "users_table_name" {
  description = "DynamoDB Users table name"
  value       = aws_dynamodb_table.users.name
}

output "rate_limits_table_name" {
  description = "DynamoDB Rate Limits table name"
  value       = aws_dynamodb_table.rate_limits.name
}

output "analysis_requests_table_name" {
  description = "DynamoDB Analysis Requests table name"
  value       = aws_dynamodb_table.analysis_requests.name
}

output "lambda_function_names" {
  description = "Lambda function names"
  value = {
    register = aws_lambda_function.register.function_name
    login    = aws_lambda_function.login.function_name
    me       = aws_lambda_function.me.function_name
    analyze  = aws_lambda_function.analyze.function_name
  }
}
