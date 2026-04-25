import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { spending } = await request.json()

    const spendingList = spending
      .map((s: { category: string; avg_monthly: number }) =>
        `- ${s.category}: $${s.avg_monthly}/month average`
      )
      .join('\n')

    const prompt = `You are a personal finance advisor. Based on this person's actual spending over the last 3 months, suggest a realistic monthly budget for each category. Add a small buffer (10-15%) above their average to give flexibility without being unrealistic.

ACTUAL SPENDING (3 month average):
${spendingList}

Rules:
- If average spend is $0, suggest $0 (they may not use that category)
- Round suggestions to nearest $25
- Be realistic, not aspirational
- Return ONLY a JSON array, no markdown, no explanation

Format: [{"category":"name","suggested_budget":amount}]`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const text = data.content?.[0]?.text || '[]'
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()

    let suggestions
    try {
      suggestions = JSON.parse(cleaned)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      suggestions = match ? JSON.parse(match[0]) : []
    }

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Budget suggest error:', error)
    return NextResponse.json({ error: 'Failed to get suggestions' }, { status: 500 })
  }
}