import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { reportData } = await request.json()

    const prompt = `You are a personal finance advisor. Write a friendly, concise 3-4 sentence summary of this person's finances for ${reportData.month}. Be specific with numbers. Note what went well and one area to watch.

Data:
- Income: $${reportData.totalIncome}
- Expenses: $${reportData.totalExpenses}
- Net savings: $${reportData.netSavings}
- Savings rate: ${reportData.savingsRate}%
- Top categories: ${reportData.topCategories.map((c: { name: string; amount: number }) => `${c.name} $${c.amount}`).join(', ')}
- Total transactions: ${reportData.transactionCount}

Write in second person ("You saved..."). Be encouraging but honest. No bullet points, just prose.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const summary = data.content?.[0]?.text || ''
    return NextResponse.json({ summary })
  } catch (error) {
    console.error('Monthly summary error:', error)
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 })
  }
}