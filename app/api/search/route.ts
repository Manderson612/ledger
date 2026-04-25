import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { question, transactions, categories } = await request.json()

    const txnList = transactions.slice(0, 200).map((t: {
      date: string; description: string; amount: number; type: string; category?: { name: string }
    }) => `${t.date} | ${t.description} | $${t.amount} | ${t.type} | ${t.category?.name || 'Uncategorized'}`
    ).join('\n')

    const prompt = `You are a personal finance assistant. Answer this question about the user's transactions concisely and specifically. Use dollar amounts and counts where relevant. Keep the answer to 2-3 sentences max.

QUESTION: ${question}

TRANSACTIONS:
${txnList}

Answer directly and specifically. If you can't answer from the data, say so briefly.`

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
    const answer = data.content?.[0]?.text || ''
    return NextResponse.json({ answer })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}