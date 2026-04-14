let db = { categories: [], ingredients: [], inventory: [], favorites: [], shopping: [], nextId: 1 }
let selectedCategory = ''
let openCategories = new Set()
let parsedDishes = []

// ── Util ──────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Expiry helpers ────────────────────────────────────────
function expiryStatus(expiry) {
  if (!expiry) return null
  const diff = (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'expired'
  if (diff <= 3) return 'soon'
  return 'ok'
}

function expiryBadge(expiry) {
  if (!expiry) return ''
  const status = expiryStatus(expiry)
  const label = expiry.slice(5).replace('-', '/')
  if (status === 'expired') return `<span class="expiry expired">期限切れ ${label}</span>`
  if (status === 'soon') return `<span class="expiry soon">あと${Math.ceil((new Date(expiry) - new Date()) / 86400000)}日 ${label}</span>`
  return `<span class="expiry ok">${label}</span>`
}

// ── Data ─────────────────────────────────────────────────
async function fetchData() {
  const res = await fetch('/api/data')
  db = await res.json()
  renderInventory()
}

async function addInventory(name, category, quantity, unit, expiry) {
  const res = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, quantity, unit, expiry: expiry || null })
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
  // 買い物リストが表示中なら更新
  if (!document.getElementById('tab-shopping').classList.contains('hidden')) {
    renderShopping()
  }
}

async function deleteItem(id) {
  await fetch(`/api/inventory/${id}`, { method: 'DELETE' })
  await fetchData()
}

// ── Render Inventory ──────────────────────────────────────
function renderInventory() {
  const container = document.getElementById('inventory-list')

  const grouped = {}
  for (const cat of db.categories) grouped[cat] = []
  for (const item of db.inventory) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  if (db.inventory.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🛒</div>
        <p>まだ食材が登録されていません<br>「＋ 食材を追加」から始めましょう</p>
      </div>`
    return
  }

  // 期限切れ・期限間近を先頭に
  const urgentItems = db.inventory.filter(i => i.expiry && expiryStatus(i.expiry) !== 'ok')
  let html = ''

  if (urgentItems.length > 0) {
    html += `<div class="category-section urgent-section">
      <div class="category-header open-always">
        <span><span class="category-title urgent-title">⚠️ 期限注意</span><span class="category-count">${urgentItems.length}品目</span></span>
      </div>
      <div class="category-body open">
        ${urgentItems.map(item => itemHtml(item)).join('')}
      </div>
    </div>`
  }

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
          ${items.map(item => itemHtml(item)).join('')}
        </div>
      </div>`
  }
  container.innerHTML = html

  container.querySelectorAll('.category-header[data-cat]').forEach(el => {
    el.addEventListener('click', () => {
      const cat = el.dataset.cat
      if (openCategories.has(cat)) openCategories.delete(cat)
      else openCategories.add(cat)
      renderInventory()
    })
  })

  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      updateQty(parseInt(btn.dataset.id), parseFloat(btn.dataset.delta))
    })
  })

  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      if (confirm('削除しますか？')) deleteItem(parseInt(btn.dataset.del))
    })
  })
}

function itemHtml(item) {
  const status = expiryStatus(item.expiry)
  const rowClass = status === 'expired' ? 'inv-item expired-row' : status === 'soon' ? 'inv-item soon-row' : 'inv-item'
  return `
    <div class="${rowClass}">
      <div class="inv-name-wrap">
        <span class="inv-name">${esc(item.name)}</span>
        ${expiryBadge(item.expiry)}
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" data-id="${item.id}" data-delta="-1">−</button>
        <span class="qty-display">${item.quantity}${esc(item.unit)}</span>
        <button class="qty-btn" data-id="${item.id}" data-delta="1">＋</button>
      </div>
      <button class="btn-delete" data-del="${item.id}">✕</button>
    </div>`
}

// ── Modal ─────────────────────────────────────────────────
function openModal() {
  selectedCategory = ''
  document.getElementById('input-name').value = ''
  document.getElementById('input-qty').value = '1'
  document.getElementById('input-unit').value = '個'
  document.getElementById('input-expiry').value = ''
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
  const names = db.ingredients.filter(i => i.category === selectedCategory).map(i => i.name)
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
  const expiry = document.getElementById('input-expiry').value
  if (!name) { alert('食材名を入力してください'); return }
  if (!selectedCategory) { alert('カテゴリを選んでください'); return }
  try {
    await addInventory(name, selectedCategory, qty, unit, expiry)
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
    const tab = btn.dataset.tab
    document.getElementById('tab-' + tab).classList.remove('hidden')
    if (tab === 'favorites') renderFavorites()
    if (tab === 'shopping') renderShopping()
  })
})

// ── Favorites ────────────────────────────────────────────
async function renderFavorites() {
  const container = document.getElementById('favorites-list')
  const res = await fetch('/api/favorites')
  const favs = await res.json()

  if (favs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">❤️</div>
        <p>保存した料理はまだありません<br>「提案」タブで❤️ボタンを押して保存しよう</p>
      </div>`
    return
  }

  container.innerHTML = favs.map(fav => `
    <div class="dish-card">
      <div class="dish-emoji">${fav.emoji}</div>
      <div class="dish-name">${esc(fav.name)}</div>
      ${fav.ingredients ? `
        <div class="dish-section">
          <div class="dish-label">🛒 食材</div>
          <div class="dish-text">${esc(fav.ingredients)}</div>
        </div>` : ''}
      ${fav.steps && fav.steps.length > 0 ? `
        <div class="dish-section">
          <div class="dish-label">👨‍🍳 作り方</div>
          <ol class="dish-steps">${fav.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        </div>` : ''}
      ${fav.tip ? `
        <div class="dish-section dish-tip">
          <div class="dish-label">💡 ポイント</div>
          <div class="dish-text">${esc(fav.tip)}</div>
        </div>` : ''}
      <button class="btn-delete-fav" data-id="${fav.id}">🗑️ 削除</button>
    </div>
  `).join('')

  container.querySelectorAll('.btn-delete-fav').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('削除しますか？')) {
        await fetch(`/api/favorites/${btn.dataset.id}`, { method: 'DELETE' })
        renderFavorites()
      }
    })
  })
}

// ── Shopping ─────────────────────────────────────────────
async function renderShopping() {
  const container = document.getElementById('shopping-list')
  const res = await fetch('/api/shopping')
  const items = await res.json()

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">✅</div>
        <p>買い物リストは空です</p>
      </div>`
    return
  }

  container.innerHTML = `<div class="shopping-list-wrap">
    ${items.map(item => `
      <div class="shopping-item">
        <div class="shopping-info">
          <span class="shopping-cat">${esc(item.category)}</span>
          <span class="shopping-name">${esc(item.name)}</span>
        </div>
        <div class="shopping-actions">
          <button class="btn-purchase" data-id="${item.id}">✓ 購入した</button>
          <button class="btn-remove-shop" data-id="${item.id}">✕</button>
        </div>
      </div>
    `).join('')}
  </div>`

  container.querySelectorAll('.btn-purchase').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/shopping/${btn.dataset.id}/purchase`, { method: 'POST' })
      await fetchData()
      renderShopping()
    })
  })

  container.querySelectorAll('.btn-remove-shop').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/shopping/${btn.dataset.id}`, { method: 'DELETE' })
      renderShopping()
    })
  })
}

// ── Dish card parser ─────────────────────────────────────
function parseDishes(text) {
  parsedDishes = []
  const blocks = text.split(/={3,}/).map(s => s.trim()).filter(s => s.length > 0)
  if (blocks.length === 0) return ''

  const cards = blocks.map((block, idx) => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l)
    if (lines.length === 0) return null

    const firstLine = lines[0]
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
        ingredients = line.slice(3).trim(); mode = ''
      } else if (line.startsWith('作り方：')) {
        mode = 'steps'
        const rest = line.slice(4).trim()
        if (rest) steps.push(rest)
      } else if (line.startsWith('ポイント：')) {
        tip = line.slice(5).trim(); mode = ''
      } else if (mode === 'steps') {
        steps.push(line.replace(/^\d+\.\s*/, ''))
      }
    }

    parsedDishes.push({ emoji, name, ingredients, steps, tip })

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
        <button class="btn-save-dish" data-idx="${idx}">❤️ 保存する</button>
      </div>`
  }).filter(Boolean)

  return cards.join('')
}

function wireSaveButtons(container) {
  container.querySelectorAll('.btn-save-dish').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dish = parsedDishes[parseInt(btn.dataset.idx)]
      if (!dish) return
      btn.disabled = true
      btn.textContent = '保存中...'
      try {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dish)
        })
        const data = await res.json()
        btn.textContent = data.duplicate ? '✓ 保存済み' : '❤️ 保存した！'
      } catch {
        btn.textContent = 'エラー'
        btn.disabled = false
      }
    })
  })
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
          if (parsed.error) resultEl.innerHTML = `<div class="suggest-error">エラー: ${esc(parsed.error)}</div>`
        } catch {}
      }
    }

    const html = parseDishes(accumulated)
    resultEl.innerHTML = html || '<div class="suggest-error">提案を取得できませんでした。もう一度お試しください。</div>'
    wireSaveButtons(resultEl)
  } catch (e) {
    resultEl.innerHTML = `<div class="suggest-error">エラー: ${esc(e.message)}</div>`
  } finally {
    btn.disabled = false
    btn.textContent = '✨ 料理を提案してもらう'
  }
})

// Init
fetchData()
