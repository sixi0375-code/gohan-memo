const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3002

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const dbPath = path.join(dataDir, 'db.json')

const DEFAULT_CATEGORIES = ['野菜', '肉・魚', '乳製品', '卵', '調味料', '穀物・粉', '缶詰・乾物', 'その他']

function loadDb() {
  if (!fs.existsSync(dbPath)) {
    const initial = { categories: DEFAULT_CATEGORIES, ingredients: [], inventory: [], nextId: 1 }
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2))
    return initial
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
}

function saveDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2))
}

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// GET /api/data — all data
app.get('/api/data', (_req, res) => {
  res.json(loadDb())
})

// POST /api/inventory — add ingredient to inventory
app.post('/api/inventory', (req, res) => {
  const { name, category, quantity, unit } = req.body
  if (!name || !category) return res.status(400).json({ error: 'name and category required' })
  const db = loadDb()

  // Add to ingredient master if new
  if (!db.ingredients.find(i => i.name === name && i.category === category)) {
    db.ingredients.push({ name, category })
  }

  // Check if already in inventory
  const existing = db.inventory.find(i => i.name === name && i.category === category)
  if (existing) {
    existing.quantity = (existing.quantity || 0) + (parseFloat(quantity) || 1)
    saveDb(db)
    return res.json(existing)
  }

  const item = {
    id: db.nextId++,
    name,
    category,
    quantity: parseFloat(quantity) || 1,
    unit: unit || '個'
  }
  db.inventory.push(item)
  saveDb(db)
  res.json(item)
})

// PUT /api/inventory/:id — update quantity
app.put('/api/inventory/:id', (req, res) => {
  const db = loadDb()
  const item = db.inventory.find(i => i.id === parseInt(req.params.id))
  if (!item) return res.status(404).json({ error: 'not found' })

  const { delta, quantity, unit } = req.body
  if (delta !== undefined) {
    item.quantity = Math.max(0, (item.quantity || 0) + parseFloat(delta))
  } else if (quantity !== undefined) {
    item.quantity = Math.max(0, parseFloat(quantity) || 0)
  }
  if (unit !== undefined) item.unit = unit

  saveDb(db)
  res.json(item)
})

// DELETE /api/inventory/:id
app.delete('/api/inventory/:id', (req, res) => {
  const db = loadDb()
  db.inventory = db.inventory.filter(i => i.id !== parseInt(req.params.id))
  saveDb(db)
  res.json({ ok: true })
})

// POST /api/suggest — SSE streaming from Gemini
app.post('/api/suggest', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set' })
  }

  const db = loadDb()
  const inventory = db.inventory.filter(i => i.quantity > 0)

  if (inventory.length === 0) {
    return res.status(400).json({ error: '在庫が登録されていません' })
  }

  const { request } = req.body
  const inventoryText = inventory
    .map(i => `- ${i.name}（${i.category}）: ${i.quantity}${i.unit}`)
    .join('\n')

  const prompt = `以下の食材が現在の在庫です：

${inventoryText}

${request ? `リクエスト: ${request}\n\n` : ''}これらの食材を使って作れる料理を3〜5品提案してください。各料理について：
1. 料理名
2. 使用する在庫食材
3. 簡単な作り方（3〜5ステップ）
4. ポイントやアレンジのコツ

家族向けの食事として、バランスよく提案してください。

出力形式：
- 各料理名の先頭には料理に合ったemoji絵文字をつけてください（例：🍜 ラーメン）
- 料理名は「### 」で始めてください
- セクション（使用食材・作り方・ポイント）は「**セクション名：**」の形式にしてください
- 作り方は番号付きリスト（1. 2. 3.）で記述してください`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}&alt=sse`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    })

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      console.error('Gemini error:', errText)
      res.write(`data: ${JSON.stringify({ error: `Gemini API error: ${geminiRes.status}` })}\n\n`)
      return res.end()
    }

    const reader = geminiRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
        } catch {}
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('Gemini error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🍚 ごはんメモ サーバー起動`)
  console.log(`   http://localhost:${PORT}\n`)
})
