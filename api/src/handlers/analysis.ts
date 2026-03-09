import { APIGatewayProxyHandler } from 'aws-lambda'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import {
  docClient,
  TABLES,
  PutCommand,
  QueryCommand,
} from '../utils/dynamodb.js'
import { verifyToken, extractToken } from '../utils/auth.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { checkRateLimit } from '../middleware/rateLimit.js'
import { SessionData, AnalysisRequest } from '../types/index.js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const sessionSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number(),
  avgStress: z.number(),
  avgHeartRate: z.number().nullable(),
  avgRespiratoryRate: z.number().nullable(),
  avgPostureScore: z.number(),
  quality: z.number(),
})

const analyzeSchema = z.object({
  sessions: z.array(sessionSchema).min(1).max(100),
  personalizedZones: z
    .object({
      optimalStress: z.object({ min: z.number(), max: z.number() }),
      optimalHeartRate: z.object({ min: z.number(), max: z.number() }),
      optimalDuration: z.object({ min: z.number(), max: z.number() }),
    })
    .optional(),
})

// Check if we have cached analysis for similar data
async function getCachedAnalysis(
  userId: string,
  sessionCount: number
): Promise<string | null> {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.ANALYSIS_REQUESTS,
      IndexName: 'UserIdCreatedAtIndex',
      KeyConditionExpression: 'userId = :userId AND createdAt > :oneDayAgo',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':oneDayAgo': oneDayAgo,
      },
      Limit: 1,
      ScanIndexForward: false, // Most recent first
    })
  )

  const recentAnalysis = result.Items?.[0] as AnalysisRequest | undefined

  // Return cached if session count is similar (within 10%)
  if (
    recentAnalysis &&
    Math.abs(recentAnalysis.sessionCount - sessionCount) / sessionCount < 0.1
  ) {
    return recentAnalysis.insights
  }

  return null
}

// Generate insights using Claude
async function generateInsights(
  sessions: SessionData[],
  personalizedZones?: any
): Promise<{ insights: string; tokensUsed: number }> {
  const prompt = `You are an AI study coach analyzing a student's focus session data. Your goal is to provide personalized, actionable insights.

Session Data (${sessions.length} sessions):
${JSON.stringify(sessions, null, 2)}

${
  personalizedZones
    ? `Personalized Optimal Zones (learned from top 25% sessions):
${JSON.stringify(personalizedZones, null, 2)}`
    : ''
}

Please analyze this data and provide:
1. **Patterns Identified**: What trends do you notice in their study habits? (e.g., time of day effects, session duration sweet spots, stress patterns)
2. **Strengths**: What is this student doing well? Be specific and encouraging.
3. **Areas for Growth**: What could be improved? Focus on 1-2 key suggestions.
4. **Actionable Recommendations**: Provide 2-3 concrete, specific actions they can take to optimize their study sessions.

Keep your response concise (under 300 words), encouraging, and focused on actionable insights. Use a friendly, supportive tone.`

  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const insights = message.content[0].type === 'text' ? message.content[0].text : ''
  const tokensUsed = message.usage.input_tokens + message.usage.output_tokens

  return { insights, tokensUsed }
}

// Analyze handler
export const analyze: APIGatewayProxyHandler = async (event) => {
  try {
    // Authenticate
    const token = extractToken(event.headers.authorization || event.headers.Authorization)
    if (!token) {
      return errorResponse('Access token required', 401)
    }

    const payload = verifyToken(token)

    // Check rate limit
    const rateLimitCheck = await checkRateLimit(
      payload.userId,
      payload.subscriptionTier as 'free' | 'paid'
    )

    if (!rateLimitCheck.allowed) {
      return errorResponse(
        'Rate limit exceeded',
        429,
        {
          resetIn: rateLimitCheck.resetIn,
          limit: rateLimitCheck.limit,
        }
      )
    }

    // Validate input
    const body = JSON.parse(event.body || '{}')
    const { sessions, personalizedZones } = analyzeSchema.parse(body)

    // Check for cached analysis
    const cached = await getCachedAnalysis(payload.userId, sessions.length)
    if (cached) {
      return successResponse({
        insights: cached,
        cached: true,
      })
    }

    // Generate new insights
    const { insights, tokensUsed } = await generateInsights(
      sessions,
      personalizedZones
    )

    // Store analysis request
    const analysisRequest: AnalysisRequest = {
      id: randomUUID(),
      userId: payload.userId,
      sessionCount: sessions.length,
      tokensUsed,
      cached: false,
      insights,
      createdAt: Date.now(),
    }

    await docClient.send(
      new PutCommand({
        TableName: TABLES.ANALYSIS_REQUESTS,
        Item: analysisRequest,
      })
    )

    return successResponse({
      insights,
      cached: false,
      tokensUsed,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid input', 400, error.errors)
    }
    console.error('Analysis error:', error)
    return errorResponse('Internal server error', 500)
  }
}
