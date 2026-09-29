import 'dotenv/config'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import express from 'express'
import rateLimit from 'express-rate-limit'
import multer from 'multer'

const app = express()
const port = Number(process.env.PORT || 8787)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim())
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
})
const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const authClient = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

const requireSession = async (request, response, next) => {
  if (!authClient) return response.status(503).json({ error: 'Authentication is not configured on the analysis server.' })
  if (!openai) return response.status(503).json({ error: 'AI analysis is not configured yet. Add the server-side OpenAI API key.' })
  const authorization = request.get('authorization')
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!accessToken) return response.status(401).json({ error: 'Sign in before requesting an analysis.' })

  try {
    const { data: { user }, error } = await authClient.auth.getUser(accessToken)
    if (error || !user) return response.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' })
    return next()
  } catch {
    return response.status(503).json({ error: 'Could not verify your session. Please try again.' })
  }
}

app.use(cors({ origin: allowedOrigins?.length ? allowedOrigins : true }))
app.use('/api/analyze', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false }))

app.get('/api/health', (_request, response) => {
  response.json({ authConfigured: Boolean(authClient), analysisConfigured: Boolean(openai) })
})

app.post('/api/analyze', requireSession, upload.fields([{ name: 'front', maxCount: 1 }, { name: 'side', maxCount: 1 }]), async (request, response) => {
  if (request.body?.consent !== 'true' || request.body?.adult !== 'true') {
    return response.status(400).json({ error: 'Confirm that you are 18 or older and consent to AI photo processing.' })
  }

  const files = request.files
  const front = files?.front?.[0]
  const side = files?.side?.[0]
  if (!front || !side) return response.status(400).json({ error: 'Upload both a front-facing photo and a profile photo.' })
  if (![front, side].every((file) => supportedImageTypes.has(file.mimetype))) {
    return response.status(415).json({ error: 'Use JPEG, PNG, or WebP photos.' })
  }

  try {
    const result = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 700,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'portrait_analysis',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              overallScore: { type: 'number' },
              summary: { type: 'string' },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string' },
                    score: { type: 'number' },
                    note: { type: 'string' },
                  },
                  required: ['title', 'score', 'note'],
                },
              },
            },
            required: ['overallScore', 'summary', 'sections'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You provide a subjective portrait-aesthetics reflection, not an objective measure of beauty or human worth. Assess only visible, non-sensitive presentation: facial harmony, feature definition, and photo presence. Do not infer or mention identity, ethnicity, health, personality, or protected traits. Do not make degrading comments or recommend medical or invasive procedures. Give three concise, respectful observations and scores from 1 to 10. Scores are model opinions and may be biased. Return only the requested JSON.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these two photos of the same adult person, one front-facing and one profile. Give a brief, respectful portrait analysis. Focus on visible proportions, feature definition, and how the photos present the face. Keep the summary supportive and non-absolute.' },
            { type: 'image_url', image_url: { url: `data:${front.mimetype};base64,${front.buffer.toString('base64')}`, detail: 'high' } },
            { type: 'image_url', image_url: { url: `data:${side.mimetype};base64,${side.buffer.toString('base64')}`, detail: 'high' } },
          ],
        },
      ],
    })

    const content = result.choices[0]?.message?.content
    if (!content) return response.status(502).json({ error: 'The AI service returned an empty report. Please try again.' })
    const report = JSON.parse(content)
    const validScore = (score) => Number.isFinite(score) && score >= 1 && score <= 10
    const validSections = Array.isArray(report.sections) && report.sections.length === 3 && report.sections.every((section) => (
      typeof section.title === 'string' && section.title.length > 0
      && typeof section.note === 'string' && section.note.length > 0
      && validScore(section.score)
    ))
    if (!validScore(report.overallScore) || typeof report.summary !== 'string' || !report.summary || !validSections) {
      return response.status(502).json({ error: 'The AI service returned an incomplete report. Please try again.' })
    }
    return response.json(report)
  } catch (error) {
    console.error('Portrait analysis failed:', error instanceof Error ? error.message : 'unknown error')
    return response.status(502).json({ error: 'Analysis could not be completed. Please try again later.' })
  }
})

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'Each photo must be smaller than 8 MB.' })
  }
  console.error('API request failed:', error instanceof Error ? error.message : 'unknown error')
  return response.status(500).json({ error: 'Something went wrong. Please try again.' })
})

app.listen(port, () => console.log(`DoYouMog analysis API listening on port ${port}`))