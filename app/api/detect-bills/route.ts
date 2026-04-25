import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { transactions, existing_bills } = await request.json()

    const txnList = transactions
      .map((t: { description: string; amount: number; date: string }) =>
        `${t.date} | ${t.description} | $${t.amount}`
      )
      .join('\n')

    const prompt = `You are a personal finance assistant. Analyze these transactions and identify recurring bills or subscriptions.

TRANSACTIONS (last 3 months):
${txnList}

ALREADY TRACKED BILLS (ignore these):
${existing_bills.join(', ') || 'None'}

Look for:
- Same merchant appearing monthly with similar amounts
- Subscriptions (Netflix, Spotify, insurance, etc.)
- Regular utility payments
- Loan or mortgage payments

For each recurring bill found, determine the typical due day of month based on transaction dates.

Return ONLY a JSON array, no markdown, no explanation:
[{"name":"bill name","amount":monthly_amount,"due_day":day_of_month}]

If no recurring bills found, return: []`

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

    let detected
    try {
      detected = JSON.parse(cleaned)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      detected = match ? JSON.parse(match[0]) : []
    }

    return NextResponse.json({ detected })
  } catch (error) {
    console.error('Detect bills error:', error)
    return NextResponse.json({ error: 'Detection failed' }, { status: 500 })
  }
}