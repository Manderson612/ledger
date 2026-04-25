import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { transactions, categories, rules } = await request.json()

    const categoryList = categories
      .map((c: { name: string; id: string }) => `- ${c.name} (id: ${c.id})`)
      .join('\n')

    const ruleList = rules.length > 0
      ? rules.map((r: { pattern: string; category_name: string }) => `- "${r.pattern}" → ${r.category_name}`).join('\n')
      : 'No custom rules defined yet.'

    const txnList = transactions
      .map((t: { id: string; description: string; amount: number; type: string }, i: number) =>
        `${i + 1}. id:${t.id} | ${t.description} | $${t.amount} | ${t.type}`
      )
      .join('\n')

    const prompt = `You are a personal finance categorization assistant. Categorize each transaction into exactly one of the provided categories.

AVAILABLE CATEGORIES:
${categoryList}

USER'S CUSTOM RULES (apply these first, they take priority):
${ruleList}

TRANSACTIONS TO CATEGORIZE:
${txnList}

CATEGORIZATION GUIDELINES:
- Grocery stores (Wegmans, Tops, Aldi, Costco, Trader Joes, Whole Foods) → Groceries
- Restaurants, fast food, coffee shops, bars → Dining Out
- Gas stations (Shell, Kwik Fill, Sunoco, BP, Mobil) → Transportation
- Car payments, auto insurance, parking, tolls → Transportation
- Electric, gas, water, internet, phone bills → Utilities
- Baby stores, childrens clothing, toys, diapers → Baby / Kids
- Doctor, dentist, pharmacy, hospital → Healthcare
- Netflix, Spotify, Apple, Amazon Prime, subscriptions → Subscriptions
- Mortgage, rent → Housing
- Amazon purchases → use context clues, default to Misc / Other if unclear
- Payroll, direct deposit, income → Income
- Credit card payments, loan payments → use the users custom rules
- Transfers between accounts → Misc / Other unless a rule applies

Respond ONLY with a JSON array, no explanation, no markdown, no backticks. Format:
[{"id":"transaction-id","category_id":"category-uuid"}]`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    console.log('STATUS:', response.status)
    console.log('ANTHROPIC RESPONSE:', JSON.stringify(data))
    const text = data.content?.[0]?.text || '[]'

let result
try {
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
  result = JSON.parse(cleaned)
} catch {
  const match = text.match(/\[[\s\S]*\]/)
  result = match ? JSON.parse(match[0]) : []
}

    return NextResponse.json({ categorized: result })
  } catch (error) {
    console.error('Categorize error:', error)
    return NextResponse.json({ error: 'Categorization failed' }, { status: 500 })
  }
}