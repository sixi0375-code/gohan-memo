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
    const initial = { categories: DEFAULT_CATEGORIES, ingredients: [], inventory: [], favorites: [], shopping: [], nextId: 1 }
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2))
    return initial
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
  // Migration: add missing collections
  if (!db.favorites) db.favorites = []
  if (!db.shopping) db.shopping = []
  return db
}

function saveDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2))
}

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── Data ───────────────────────────────────────────────────
app.get('/api/data', (_req, res) => {
  res.json(loadDb())
})

// ── Inventory ──────────────────────────────────────────────
app.post('/api/inventory', (req, res) => {
  const { name, category, quantity, unit, expiry } = req.body
  if (!name || !category) return res.status(400).json({ error: 'name and category required' })
  const db = loadDb()

  if (!db.ingredients.find(i => i.name === name && i.category === category)) {
    db.ingredients.push({ name, category })
  }

  const existing = db.inventory.find(i => i.name === name && i.category === category)
  if (existing) {
    existing.quantity = (existing.quantity || 0) + (parseFloat(quantity) || 1)
    if (expiry) existing.expiry = expiry
    // Remove from shopping if restocked
    db.shopping = db.shopping.filter(s => !(s.name === name && s.category === category))
    saveDb(db)
    return res.json(existing)
  }

  const item = {
    id: db.nextId++,
    name,
    category,
    quantity: parseFloat(quantity) || 1,
    unit: unit || '個',
    expiry: expiry || null
  }
  db.inventory.push(item)
  saveDb(db)
  res.json(item)
})

app.put('/api/inventory/:id', (req, res) => {
  const db = loadDb()
  const item = db.inventory.find(i => i.id === parseInt(req.params.id))
  if (!item) return res.status(404).json({ error: 'not found' })

  const { delta, quantity, unit, expiry } = req.body
  if (delta !== undefined) {
    item.quantity = Math.max(0, (item.quantity || 0) + parseFloat(delta))
  } else if (quantity !== undefined) {
    item.quantity = Math.max(0, parseFloat(quantity) || 0)
  }
  if (unit !== undefined) item.unit = unit
  if (expiry !== undefined) item.expiry = expiry || null

  // Auto-add to shopping list when quantity hits 0
  if (item.quantity === 0) {
    const alreadyInShopping = db.shopping.find(s => s.name === item.name && s.category === item.category)
    if (!alreadyInShopping) {
      db.shopping.push({
        id: db.nextId++,
        name: item.name,
        category: item.category,
        unit: item.unit,
        addedAt: new Date().toISOString()
      })
    }
  }

  saveDb(db)
  res.json(item)
})

app.delete('/api/inventory/:id', (req, res) => {
  const db = loadDb()
  db.inventory = db.inventory.filter(i => i.id !== parseInt(req.params.id))
  saveDb(db)
  res.json({ ok: true })
})

// ── Favorites ──────────────────────────────────────────────
app.get('/api/favorites', (_req, res) => {
  res.json(loadDb().favorites)
})

app.post('/api/favorites', (req, res) => {
  const { emoji, name, ingredients, steps, tip } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  const db = loadDb()
  if (db.favorites.find(f => f.name === name)) {
    return res.json({ duplicate: true })
  }
  const fav = {
    id: db.nextId++,
    emoji: emoji || '🍽️',
    name,
    ingredients: ingredients || '',
    steps: steps || [],
    tip: tip || '',
    savedAt: new Date().toISOString()
  }
  db.favorites.push(fav)
  saveDb(db)
  res.json(fav)
})

app.delete('/api/favorites/:id', (req, res) => {
  const db = loadDb()
  db.favorites = db.favorites.filter(f => f.id !== parseInt(req.params.id))
  saveDb(db)
  res.json({ ok: true })
})

// ── Shopping ───────────────────────────────────────────────
app.get('/api/shopping', (_req, res) => {
  res.json(loadDb().shopping)
})

app.post('/api/shopping', (req, res) => {
  const { name, category, unit } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  const db = loadDb()
  const existing = db.shopping.find(s => s.name === name && s.category === (category || ''))
  if (existing) return res.json(existing)
  const item = {
    id: db.nextId++,
    name,
    category: category || '',
    unit: unit || '個',
    addedAt: new Date().toISOString()
  }
  db.shopping.push(item)
  saveDb(db)
  res.json(item)
})

// 購入済み → 在庫に戻す
app.post('/api/shopping/:id/purchase', (req, res) => {
  const db = loadDb()
  const shopItem = db.shopping.find(s => s.id === parseInt(req.params.id))
  if (!shopItem) return res.status(404).json({ error: 'not found' })

  db.shopping = db.shopping.filter(s => s.id !== parseInt(req.params.id))

  const existing = db.inventory.find(i => i.name === shopItem.name && i.category === shopItem.category)
  if (existing) {
    existing.quantity += 1
  } else {
    db.inventory.push({
      id: db.nextId++,
      name: shopItem.name,
      category: shopItem.category,
      quantity: 1,
      unit: shopItem.unit,
      expiry: null
    })
    if (!db.ingredients.find(i => i.name === shopItem.name && i.category === shopItem.category)) {
      db.ingredients.push({ name: shopItem.name, category: shopItem.category })
    }
  }

  saveDb(db)
  res.json({ ok: true })
})

// リストから削除のみ
app.delete('/api/shopping/:id', (req, res) => {
  const db = loadDb()
  db.shopping = db.shopping.filter(s => s.id !== parseInt(req.params.id))
  saveDb(db)
  res.json({ ok: true })
})

// ── Suggest ────────────────────────────────────────────────
app.post('/api/suggest', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' })

  const db = loadDb()
  const inventory = db.inventory.filter(i => i.quantity > 0)
  if (inventory.length === 0) return res.status(400).json({ error: '在庫が登録されていません' })

  const { request } = req.body
  const today = new Date()

  // 期限順でソート（近いものを先に）
  const sorted = [...inventory].sort((a, b) => {
    const da = a.expiry ? new Date(a.expiry) : new Date('9999-12-31')
    const db2 = b.expiry ? new Date(b.expiry) : new Date('9999-12-31')
    return da - db2
  })

  const inventoryText = sorted.map(i => {
    let line = `- ${i.name}（${i.category}）: ${i.quantity}${i.unit}`
    if (i.expiry) {
      const diff = Math.ceil((new Date(i.expiry) - today) / (1000 * 60 * 60 * 24))
      if (diff < 0) line += ` ※期限切れ`
      else if (diff <= 3) line += ` ※期限まで${diff}日`
    }
    return line
  }).join('\n')

  const expiringItems = inventory.filter(i => {
    if (!i.expiry) return false
    return (new Date(i.expiry) - today) / (1000 * 60 * 60 * 24) <= 3
  })

  const expiryNote = expiringItems.length > 0
    ? `\n⚠️ 特に「${expiringItems.map(i => i.name).join('、')}」は賞味期限が近いので優先的に使ってください。\n`
    : ''

  const prompt = `以下の食材が現在の在庫です：

${inventoryText}
${expiryNote}
${request ? `リクエスト: ${request}\n` : ''}
これらの食材を使って作れる料理を3〜5品提案してください。

必ず以下の形式で出力してください。###や**などのマークダウン記号は絶対に使わないこと。

====
[料理に合ったemoji1文字] [料理名]
食材：[使う在庫食材をカンマ区切り]
作り方：
1. [ステップ1]
2. [ステップ2]
3. [ステップ3]
ポイント：[子供も喜ぶコツやアレンジ]
====

料理と料理の間は必ず「====」のみの行で区切ること。それ以外の記号やマークダウンは一切使わないこと。`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}&alt=sse`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
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
