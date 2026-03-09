import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@zeno.app'

export async function sendOTPEmail(email: string, code: string): Promise<void> {
  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: 'Your Zeno login code',
        Charset: 'UTF-8',
      },
      Body: {
        Text: {
          Data: `Your Zeno verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`,
          Charset: 'UTF-8',
        },
        Html: {
          Data: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1a1917; background: #f7f5f2; margin: 0; padding: 20px; }
                .container { max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); }
                h1 { font-family: 'Georgia', serif; font-size: 24px; margin: 0 0 16px; color: #1a1917; }
                .code { font-family: 'Courier New', monospace; font-size: 32px; font-weight: 700; color: #2d6a4f; background: #d8eddf; padding: 16px; border-radius: 8px; text-align: center; letter-spacing: 4px; margin: 24px 0; }
                p { margin: 12px 0; color: #6b6760; font-size: 14px; }
                .footer { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e8e4df; font-size: 12px; color: #a09c97; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Your Zeno login code</h1>
                <p>Use this code to sign in to your Zeno account:</p>
                <div class="code">${code}</div>
                <p>This code will expire in 10 minutes.</p>
                <div class="footer">
                  <p>If you didn't request this code, you can safely ignore this email.</p>
                </div>
              </div>
            </body>
            </html>
          `,
          Charset: 'UTF-8',
        },
      },
    },
  })

  await sesClient.send(command)
}
