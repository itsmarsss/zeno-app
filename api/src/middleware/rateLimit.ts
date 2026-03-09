import {
  docClient,
  TABLES,
  QueryCommand,
  PutCommand,
  UpdateCommand,
} from '../utils/dynamodb.js'
import { RateLimitRecord } from '../types/index.js'

const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const FREE_TIER_LIMIT = parseInt(process.env.RATE_LIMIT_FREE || '10')
const PAID_TIER_LIMIT = parseInt(process.env.RATE_LIMIT_PAID || '100')

export async function checkRateLimit(
  userId: string,
  subscriptionTier: 'free' | 'paid'
): Promise<{ allowed: boolean; resetIn?: number; limit?: number }> {
  const limit = subscriptionTier === 'paid' ? PAID_TIER_LIMIT : FREE_TIER_LIMIT
  const now = Date.now()
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS

  // Query current window
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.RATE_LIMITS,
      KeyConditionExpression: 'userId = :userId AND windowStart = :windowStart',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':windowStart': windowStart,
      },
    })
  )

  const existingRecord = result.Items?.[0] as RateLimitRecord | undefined

  if (!existingRecord) {
    // Create new window record
    await docClient.send(
      new PutCommand({
        TableName: TABLES.RATE_LIMITS,
        Item: {
          userId,
          windowStart,
          count: 1,
          ttl: Math.floor((windowStart + RATE_LIMIT_WINDOW_MS * 2) / 1000), // 2 windows TTL
        } as RateLimitRecord,
      })
    )
    return { allowed: true }
  }

  // Check if limit exceeded
  if (existingRecord.count >= limit) {
    const resetIn = Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
    return { allowed: false, resetIn, limit }
  }

  // Increment counter
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.RATE_LIMITS,
      Key: { userId, windowStart },
      UpdateExpression: 'SET #count = #count + :inc',
      ExpressionAttributeNames: {
        '#count': 'count',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    })
  )

  return { allowed: true }
}
