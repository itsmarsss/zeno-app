import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

export const docClient = DynamoDBDocumentClient.from(client)

export const TABLES = {
  USERS: process.env.USERS_TABLE!,
  RATE_LIMITS: process.env.RATE_LIMITS_TABLE!,
  ANALYSIS_REQUESTS: process.env.ANALYSIS_REQUESTS_TABLE!,
}

export { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand }
