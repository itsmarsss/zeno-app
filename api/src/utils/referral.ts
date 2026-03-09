import { randomBytes } from 'crypto'
import { docClient, TABLES, QueryCommand } from './dynamodb.js'

const REFERRAL_CODE_LENGTH = 8

/**
 * Generate a unique referral code
 * Format: ZENO-XXXX (e.g., ZENO-A7K2)
 */
export async function generateUniqueReferralCode(): Promise<string> {
  let attempts = 0
  const maxAttempts = 10

  while (attempts < maxAttempts) {
    const code = generateReferralCode()

    // Check if code already exists
    const exists = await referralCodeExists(code)
    if (!exists) {
      return code
    }

    attempts++
  }

  // Fallback: use timestamp-based code if all random attempts fail
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4)
  const random = randomBytes(2).toString('hex').toUpperCase()
  return `ZENO-${timestamp}${random}`
}

function generateReferralCode(): string {
  // Generate random 4-character alphanumeric code (excluding confusing chars: 0, O, I, 1)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let code = 'ZENO-'

  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return code
}

async function referralCodeExists(code: string): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.USERS,
      IndexName: 'ReferralCodeIndex',
      KeyConditionExpression: 'referralCode = :code',
      ExpressionAttributeValues: {
        ':code': code,
      },
      Limit: 1,
    })
  )

  return (result.Items?.length ?? 0) > 0
}

export async function validateReferralCode(code: string): Promise<boolean> {
  if (!code || !code.startsWith('ZENO-')) {
    return false
  }

  return await referralCodeExists(code)
}
