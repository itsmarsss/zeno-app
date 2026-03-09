import { APIGatewayProxyHandler } from 'aws-lambda'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import {
  docClient,
  TABLES,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '../utils/dynamodb.js'
import { generateToken, verifyToken, extractToken } from '../utils/auth.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { sendOTPEmail } from '../utils/ses.js'
import {
  generateOTP,
  getOTPExpiry,
  isOTPExpired,
  hasExceededAttempts,
} from '../utils/otp.js'
import { User, OTPCode } from '../types/index.js'

const requestOTPSchema = z.object({
  email: z.string().email(),
})

const verifyOTPSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
})

// Request OTP handler
export const requestOTP: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}')
    const { email } = requestOTPSchema.parse(body)

    // Generate OTP
    const code = generateOTP()
    const expiresAt = getOTPExpiry()

    // Store OTP in DynamoDB
    const otpRecord: OTPCode = {
      email: email.toLowerCase(),
      code,
      attempts: 0,
      expiresAt,
      createdAt: Date.now(),
    }

    await docClient.send(
      new PutCommand({
        TableName: TABLES.OTP_CODES,
        Item: otpRecord,
      })
    )

    // Send OTP email via SES
    await sendOTPEmail(email, code)

    return successResponse({
      message: 'Verification code sent to your email',
      expiresIn: 600, // 10 minutes in seconds
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid input', 400, error.errors)
    }
    console.error('Request OTP error:', error)
    return errorResponse('Failed to send verification code', 500)
  }
}

// Verify OTP handler
export const verifyOTP: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}')
    const { email, code } = verifyOTPSchema.parse(body)

    const normalizedEmail = email.toLowerCase()

    // Get OTP record
    const otpResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.OTP_CODES,
        Key: { email: normalizedEmail },
      })
    )

    const otpRecord = otpResult.Item as OTPCode | undefined

    if (!otpRecord) {
      return errorResponse('Invalid or expired code', 401)
    }

    // Check if code is expired
    if (isOTPExpired(otpRecord.expiresAt)) {
      return errorResponse('Code has expired', 401)
    }

    // Check if max attempts exceeded
    if (hasExceededAttempts(otpRecord.attempts)) {
      return errorResponse('Too many failed attempts. Request a new code.', 401)
    }

    // Verify code
    if (otpRecord.code !== code) {
      // Increment attempts
      await docClient.send(
        new UpdateCommand({
          TableName: TABLES.OTP_CODES,
          Key: { email: normalizedEmail },
          UpdateExpression: 'SET attempts = attempts + :inc',
          ExpressionAttributeValues: {
            ':inc': 1,
          },
        })
      )
      return errorResponse('Invalid code', 401)
    }

    // Code is valid - check if user exists
    const userResult = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USERS,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': normalizedEmail,
        },
      })
    )

    let user = userResult.Items?.[0] as User | undefined

    // Create user if doesn't exist
    if (!user) {
      const userId = randomUUID()
      const now = Date.now()

      user = {
        id: userId,
        email: normalizedEmail,
        subscriptionTier: 'free',
        createdAt: now,
        updatedAt: now,
      }

      await docClient.send(
        new PutCommand({
          TableName: TABLES.USERS,
          Item: user,
        })
      )
    }

    // Delete OTP record (single use)
    await docClient.send(
      new PutCommand({
        TableName: TABLES.OTP_CODES,
        Item: {
          ...otpRecord,
          expiresAt: Math.floor(Date.now() / 1000) - 1, // Expire immediately
        },
      })
    )

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      subscriptionTier: user.subscriptionTier,
    })

    return successResponse({
      token,
      user: {
        id: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid input', 400, error.errors)
    }
    console.error('Verify OTP error:', error)
    return errorResponse('Authentication failed', 500)
  }
}

// Get current user handler
export const me: APIGatewayProxyHandler = async (event) => {
  try {
    const token = extractToken(
      event.headers.authorization || event.headers.Authorization
    )

    if (!token) {
      return errorResponse('Access token required', 401)
    }

    const payload = verifyToken(token)

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLES.USERS,
        Key: { id: payload.userId },
      })
    )

    const user = result.Item as User | undefined

    if (!user) {
      return errorResponse('User not found', 404)
    }

    return successResponse({
      user: {
        id: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    console.error('Me error:', error)
    return errorResponse('Invalid or expired token', 403)
  }
}
