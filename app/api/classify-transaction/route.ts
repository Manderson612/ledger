import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  try {
    const { transactions, categories } = await req.json()

    if (!transactions?.length) {
      return NextResponse.json({ classified: [] })
    }

    const systemPrompt = `You are a financial transaction classifier for a family budget tracker. Classify each transaction with precision using the account context provided.

ACCOUNT CONTEXT:
- Capital One Checking (5398): main household account. Receives payroll from ADP TOTALSOURCE (Matt, semi-monthly on 7th and 22nd) and Molina Healthcare (Megan/wife, bi-weekly).
- Capital One Quicksilver credit card (cards 9043 and 1555 — two physical cards on same account): everyday purchases for both spouses
- Capital One Savor credit card (card 0017): subscriptions and entertainment
- Apple Card: various purchases

TYPE RULES:
1. TRANSFER: CAPITAL ONE MOBILE PMT, APPLECARD GSBANK PAYMENT, NIAGARA WHEATFIELD FCU, NIAGARA'S CHOICE PAYMENT, Withdrawal to Meg-Expenses, Zelle money sent, PAYPAL to MEGAN FARNHAM, rawBankType=Credit on credit cards, rawBankType=Payment on Apple Card
2. INCOME: ADP TOTALSOURCE PAYROLL, Molina Healthca PAYROLL, any PAYROLL, Monthly Interest Paid, Check Deposit
3. EXPENSE: everything else

Return ONLY a valid JSON array. No markdown, no code blocks, no explanation.`

    const userPrompt = `Classify these transactions.

Available expense categories (use EXACTLY these names): ${categories.join(', ')}
For income use: Salary, Commission, Interest, Refund, Other income
For transfers use null for category.

TRANSACTIONS:
${JSON.stringify(transactions, null, 2)}

Return JSON array:
[{"id":"...","type":"income|expense|transfer","category":"name or null","confidence":0.00,"isRecurring":true,"recurringPeriod":"monthly|semi-monthly|bi-weekly|weekly|annual|null","reasoning":"one sentence"}]`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    const classified = JSON.parse(cleaned)

    return NextResponse.json({ classified })
  } catch (err) {
    console.error('classify-transaction error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
