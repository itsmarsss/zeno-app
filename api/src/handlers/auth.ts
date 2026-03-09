import { APIGatewayProxyHandler } from 'aws-lambda'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import {
  docClient,
  TABLES,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '../utils/dynamodb.js'
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  extractToken,
} from '../utils/auth.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { User } from '../types/index.js'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

// Register handler
export const register: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}')
    const { email, password } = registerSchema.parse(body)

    // Check if user exists using EmailIndex
    const existingUserResult = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USERS,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email,
        },
      })
    )

    if (existingUserResult.Items && existingUserResult.Items.length > 0) {
      return errorResponse('Email already registered', 400)
    }

    // Create user
    const userId = randomUUID()
    const now = Date.now()
    const passwordHash = await hashPassword(password)

    const user: User = {
      id: userId,
      email,
      passwordHash,
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

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      subscriptionTier: user.subscriptionTier,
    })

    return successResponse(
      {
        token,
        user: {
          id: user.id,
          email: user.email,
          subscriptionTier: user.subscriptionTier,
        },
      },
      201
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid input', 400, error.errors)
    }
    console.error('Register error:', error)
    return errorResponse('Internal server error', 500)
  }
}

// Login handler
export const login: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}')
    const { email, password } = loginSchema.parse(body)

    // Find user by email
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USERS,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email,
        },
      })
    )

    const user = result.Items?.[0] as User | undefined

    if (!user) {
      return errorResponse('Invalid credentials', 401)
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash)
    if (!isValid) {
      return errorResponse('Invalid credentials', 401)
    }

    // Generate token
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
    console.error('Login error:', error)
    return errorResponse('Internal server error', 500)
  }
}

// Get current user handler
export const me: APIGatewayProxyHandler = async (event) => {
  try {
    const token = extractToken(event.headers.authorization || event.headers.Authorization)

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
