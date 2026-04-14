let db = { categories: [], ingredients: [], inventory: [], nextId: 1 }
let selectedCategory = ''
let openCategories = new Set()

// ── Data ─────────────────────────────────────────────────
async function fetchData() {
  const res = await fetch('/api/data')
  db = await res.json()
  renderInventory()
}

async function addInventory(name, category, quantity, unit) {
  const res = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, quantity, unit })
  })
  if (!res.ok) throw new Error('追加失敗')
  await fetchData()
}

async function updateQty(id, delta) {
  await fetch(`/api/inventory/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta })
  })
  await fetchData()
}

async function deleteItem(id) {
  await fetch(`/api/inventory/${id}`, { method: 'DELETE' })
  await fetchData()
}

// ── Render Inventory ──────────────────────────────────────
function renderInventory() {
  const container = document.getElementById('inventory-list')

  // Group by category
  const grouped = {}
  for (const cat of db.categories) grouped[cat] = []
  for (const item of db.inventory) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  const allEmpty = db.inventory.length === 0
  if (allEmpty) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🛒</div>
        <p>まだ食材が登録されていません<br>「＋ 食材を追加」から始めましょう</p>
      </div>`
    return
  }

  let html = ''
  for (const [cat, items] of Object.entries(grouped)) {
    if (items.length === 0) continue
    const isOpen = openCategories.has(cat)
    html += `
      <div class="category-section">
        <div class="category-header" data-cat="${esc(cat)}">
          <span>
            <span class="category-title">${esc(cat)}</span>
            <span class="category-count">${items.length}品目</span>
          </span>
          <span class="category-chevron ${isOpen ? 'open' : ''}">▼</span>
        </div>
        <div class="category-body ${isOpen ? 'open' : ''}">
          ${items.map(item => `
            <div class="inv-item">
              <span class="inv-name">${esc(item.name)}</span>
              <div class="qty-ctrl">
                <button class="qty-btn" data-id="${item.id}" data-delta="-1">−</button>
                <span class="qty-display">${item.quantity}${esc(item.unit)}</span>
                <button class="qty-btn" data-id="${item.id}" data-delta="1">＋</button>
              </div>
              <button class="btn-delete" data-del="${item.id}">✕</button>
            </div>
          `).join('')}
        </div>
      </div>`
  }
  container.innerHTML = html

  // Category toggle
  container.querySelectorAll('.category-header').forEach(el => {
    el.addEventListener('click', () => {
      const cat = el.dataset.cat
      if (openCategories.has(cat)) openCategories.delete(cat)
      else openCategories.add(cat)
      renderInventory()
    })
  })

  // Qty buttons
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      updateQty(parseInt(btn.dataset.id), parseFloat(btn.dataset.delta))
    })
  })

  // Delete buttons
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      if (confirm('削除しますか？')) deleteItem(parseInt(btn.dataset.del))
    })
  })
}

// ── Modal ─────────────────────────────────────────────────
function openModal() {
  selectedCategory = ''
  document.getElementById('input-name').value = ''
  document.getElementById('input-qty').value = '1'
  document.getElementById('input-unit').value = '個'
  renderCategoryChips()
  renderNameChips()
  document.getElementById('modal').classList.remove('hidden')
  document.getElementById('input-name').focus()
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden')
}

function renderCategoryChips() {
  const container = document.getElementById('category-chips')
  container.innerHTML = db.categories.map(cat => `
    <button class="chip ${cat === selectedCategory ? 'selected' : ''}" data-cat="${esc(cat)}">${esc(cat)}</button>
  `).join('')
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedCategory = chip.dataset.cat
      renderCategoryChips()
      renderNameChips()
    })
  })
}

function renderNameChips() {
  const container = document.getElementById('name-chips')
  if (!selectedCategory) { container.innerHTML = ''; return }
  const names = db.ingredients
    .filter(i => i.category === selectedCategory)
    .map(i => i.name)
  if (names.length === 0) { container.innerHTML = ''; return }
  container.innerHTML = names.map(n => `
    <button class="chip" data-name="${esc(n)}">${esc(n)}</button>
  `).join('')
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('input-name').value = chip.dataset.name
    })
  })
}

document.getElementById('btn-add').addEventListener('click', openModal)
document.getElementById('btn-cancel').addEventListener('click', closeModal)
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal()
})

document.getElementById('btn-save').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim()
  const qty = parseFloat(document.getElementById('input-qty').value) || 1
  const unit = document.getElementById('input-unit').value
  if (!name) { alert('食材名を入力してください'); return }
  if (!selectedCategory) { alert('カテゴリを選んでください'); return }
  try {
    await addInventory(name, selectedCategory, qty, unit)
    openCategories.add(selectedCategory)
    closeModal()
  } catch (e) {
    alert(e.message)
  }
})

// ── Tabs ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden')
  })
})

// ── Dish card parser ─────────────────────────────────────
function parseDishes(text) {
  // ====で区切ってブロックを取得
  const blocks = text.split(/={3,}/).map(s => s.trim()).filter(s => s.length > 0)
  if (blocks.length === 0) return ''

  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l)
    if (lines.length === 0) return ''

    // 1行目: emoji + 料理名
    const firstLine = lines[0]
    // 先頭のemoji（非ASCII・非ひらがな・非漢字）と料理名を分離
    const m = firstLine.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u)
    const emoji = m ? m[0] : '🍽️'
    const name = m ? firstLine.slice(emoji.length).trim() : firstLine

    let ingredients = ''
    const steps = []
    let tip = ''
    let mode = ''

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('食材：')) {
        ingredients = line.slice(3).trim()
        mode = ''
      } else if (line.startsWith('作り方：')) {
        mode = 'steps'
        const rest = line.slice(4).trim()
        if (rest) steps.push(rest)
      } else if (line.startsWith('ポイント：')) {
        tip = line.slice(5).trim()
        mode = ''
      } else if (mode === 'steps') {
        steps.push(line.replace(/^\d+\.\s*/, ''))
      }
    }

    return `
      <div class="dish-card">
        <div class="dish-emoji">${emoji}</div>
        <div class="dish-name">${esc(name)}</div>
        ${ingredients ? `
          <div class="dish-section">
            <div class="dish-label">🛒 食材</div>
            <div class="dish-text">${esc(ingredients)}</div>
          </div>` : ''}
        ${steps.length > 0 ? `
          <div class="dish-section">
            <div class="dish-label">👨‍🍳 作り方</div>
            <ol class="dish-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          </div>` : ''}
        ${tip ? `
          <div class="dish-section dish-tip">
            <div class="dish-label">💡 ポイント</div>
            <div class="dish-text">${esc(tip)}</div>
          </div>` : ''}
      </div>`
  }).join('')
}

// ── AI Suggest ────────────────────────────────────────────
document.getElementById('btn-suggest').addEventListener('click', async () => {
  const btn = document.getElementById('btn-suggest')
  const resultEl = document.getElementById('suggest-result')
  const request = document.getElementById('suggest-request').value.trim()

  btn.disabled = true
  btn.textContent = '考え中...'
  resultEl.innerHTML = '<div class="suggest-loading">レシピを考えています...</div>'
  resultEl.classList.remove('hidden')

  let accumulated = ''

  try {
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request })
    })

    if (!res.ok) {
      const err = await res.json()
      resultEl.innerHTML = `<div class="suggest-error">エラー: ${esc(err.error || '不明なエラー')}</div>`
      return
    }

    const reader = res.body.getReader()
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
        if (data === '[DONE]') break
        try {
          const parsed = JSON.parse(data)
          if (parsed.text) accumulated += parsed.text
          if (parsed.error) {
            resultEl.innerHTML = `<div class="suggest-error">エラー: ${esc(parsed.error)}</div>`
          }
        } catch {}
      }
    }

    // ストリーミング完了後にカード描画
    const html = parseDishes(accumulated)
    resultEl.innerHTML = html || '<div class="suggest-error">提案を取得できませんでした。もう一度お試しください。</div>'
  } catch (e) {
    resultEl.innerHTML = `<div class="suggest-error">エラー: ${esc(e.message)}</div>`
  } finally {
    btn.disabled = false
    btn.textContent = '✨ 料理を提案してもらう'
  }
})

// ── Util ──────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Init
fetchData()
