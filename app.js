'use strict';

// ============================================================
// データと共通ヘルパー
// ============================================================
const P = window.PLACES;
const byId = new Map(P.map(p => [p.id, p]));
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = a => a[Math.floor(Math.random() * a.length)];

const REGIONS = [
  { id: 'hokkaido', label: '北海道', prefs: ['北海道'] },
  { id: 'tohoku', label: '東北', prefs: ['青森', '岩手', '宮城', '秋田', '山形', '福島'] },
  { id: 'kanto', label: '関東', prefs: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'] },
  { id: 'chubu', label: '中部', prefs: ['新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知'] },
  { id: 'kinki', label: '近畿', prefs: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'] },
  { id: 'chugoku', label: '中国', prefs: ['鳥取', '島根', '岡山', '広島', '山口'] },
  { id: 'shikoku', label: '四国', prefs: ['徳島', '香川', '愛媛', '高知'] },
  { id: 'kyushu', label: '九州・沖縄', prefs: ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'] },
];
const PREFS = REGIONS.flatMap(r => r.prefs);
const regionOf = Object.fromEntries(REGIONS.flatMap(r => r.prefs.map(p => [p, r.id])));
const prefCode = pref => String(PREFS.indexOf(pref) + 1).padStart(2, '0');
const fullPref = p => (p === '北海道' ? p : p === '東京' ? '東京都' : p === '京都' || p === '大阪' ? `${p}府` : `${p}県`);
const inRegion = (p, id) => !id || id === 'all' || regionOf[p.pref] === id;
const byPref = new Map(PREFS.map(pref => [pref, P.filter(p => p.pref === pref)]));

const LEVELS = [['all', 'すべて'], ['1', 'やさしめ'], ['2', 'ふつう'], ['3', '超難読']];
const KINDS = [['all', 'すべて'], ['muni', '市区町村'], ['area', '町名・駅名など']];
const inLevel = (p, lv) => !lv || lv === 'all' || p.level === +lv;
const inKind = (p, k) => !k || k === 'all' || (k === 'muni' ? !!p.suffix : !p.suffix);

const fullName = p => p.name + p.suffix;
const fullYomi = p => p.yomi + p.sr;
const where = p => `${fullPref(p.pref)}${p.city || ''}`;
const kindLabel = p => (p.suffix ? p.suffix : '町名・地名');
const stars = lv => '★'.repeat(lv) + '☆'.repeat(3 - lv);

// 地名の表示（ruby: 読みがなを上に添える）
function nameHtml(p, ruby = false) {
  if (!ruby) return `<span class="pn">${esc(p.name)}</span>${p.suffix ? `<span class="sfx">${esc(p.suffix)}</span>` : ''}`;
  return `<ruby class="pn">${esc(p.name)}<rt>${esc(p.yomi)}</rt></ruby>${p.suffix ? `<ruby class="sfx">${esc(p.suffix)}<rt>${esc(p.sr)}</rt></ruby>` : ''}`;
}

// 入力答えの表記ゆれを吸収する（カタカナ→ひらがな、小書き文字、ぢ・づ、記号、全角半角）
const LARGE = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ', 'ゕ': 'か', 'ゖ': 'け' };
function kana(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ぁぃぅぇぉっゃゅょゎゕゖ]/g, c => LARGE[c])
    .replace(/ぢ/g, 'じ').replace(/づ/g, 'ず')
    .replace(/[\s・･.．,、'’\-‐－―ー「」]/g, '');
}
// 「おしゃまんべ」でも「おしゃまんべちょう」でも正解にする
function yomiMatches(p, input) {
  const v = kana(input);
  if (!v) return false;
  const bases = [p.yomi, ...(p.alt || [])];
  return bases.some(b => kana(b) === v || kana(b + p.sr) === v);
}

// ============================================================
// 保存データ（覚えた・復習リスト・成績）
// 未ログイン時はこのブラウザだけに保存。ログイン中はアカウントごとに保存し Supabase に同期する
// ============================================================
const GUEST_KEY = 'nandoku-area:v1';
// known: 覚えた地名 {id: 日時}／miss: 間違えた問題 {id:type: {n, at}}／stat: 地名ごとの成績 {id: [解答数, 正解数]}
const emptyState = () => ({ known: {}, miss: {}, stat: {}, total: 0, correct: 0, settings: null, updatedAt: 0 });
const readLocal = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeLocal = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 保存できない環境では何もしない */ } };

let storeKey = GUEST_KEY;
const state = emptyState();

function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, emptyState(), next);
}
function save() {
  state.updatedAt = Date.now();
  writeLocal(storeKey, state);
  scheduleSync();
}
const weakIds = () => new Set(Object.keys(state.miss).map(k => k.split(':')[0]));
const isKnown = id => !!state.known[id];
function setKnown(id, on) {
  if (on) state.known[id] = Date.now();
  else delete state.known[id];
  save();
}

function updateBadge() {
  const n = Object.keys(state.miss).length;
  const b = document.getElementById('miss-badge');
  b.textContent = n;
  b.hidden = n === 0;
}

// 都道府県ごとの成績
function prefStats(pref) {
  const list = byPref.get(pref) || [];
  let known = 0, n = 0, ok = 0;
  for (const p of list) {
    if (state.known[p.id]) known++;
    const s = state.stat[p.id];
    if (s) { n += s[0]; ok += s[1]; }
  }
  return { total: list.length, known, n, ok, pct: list.length ? Math.floor((known / list.length) * 100) : 0 };
}

// 「覚えた」チェックボタン（一覧・カード・詳細で共用）
// チェックの印は CSS で描く（一覧に500件以上並ぶので、SVG を行ごとに入れない）
const knownBtn = (id, label = '覚えた') => `<button class="known-btn" data-known="${esc(id)}" aria-pressed="${isKnown(id)}">${label}</button>`;
const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// どの画面でも、覚えたボタンは押すたびに切り替える
document.addEventListener('click', e => {
  const b = e.target.closest('[data-known]');
  if (!b) return;
  e.stopPropagation();
  const id = b.dataset.known;
  const on = !isKnown(id);
  setKnown(id, on);
  document.querySelectorAll(`[data-known="${CSS.escape(id)}"]`).forEach(x => x.setAttribute('aria-pressed', on));
  document.querySelectorAll(`[data-row="${CSS.escape(id)}"]`).forEach(x => x.classList.toggle('is-known', on));
  if (currentView() === 'map' && mapUI.pref) refreshPrefHead();
}, true);

// ============================================================
// 地名の情報表示（詳細ダイアログ・解説で共用）
// ============================================================
function mapUrl(p) {
  const q = p.lat != null ? `${p.lat},${p.lng}` : `${where(p)}${fullName(p)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
const wikiUrl = p => `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.wiki)}`;

function factsHtml(p) {
  return `<dl class="facts">
    <dt>読み</dt><dd><span class="yomi-big">${esc(p.yomi)}</span>${p.sr ? `<span class="yomi-sfx">${esc(p.sr)}</span>` : ''}${p.alt ? `<small class="alt">（${esc(p.alt.join('・'))} とも）</small>` : ''}</dd>
    <dt>場所</dt><dd>${esc(where(p))}</dd>
    <dt>種類</dt><dd>${esc(kindLabel(p))}</dd>
    <dt>難しさ</dt><dd><span class="stars">${stars(p.level)}</span></dd>
    <dt>読み間違い</dt><dd class="traps">${p.traps.map(t => `<s>${esc(t)}</s>`).join('')}</dd>
  </dl>`;
}

// 同じ字で読みが違う地名・同じ読みで字が違う地名（あわせて覚える用）
function relatedHtml(p) {
  const sameKanji = P.filter(q => q.id !== p.id && q.name === p.name);
  const sameYomi = P.filter(q => q.id !== p.id && q.yomi === p.yomi && q.name !== p.name);
  const chip = q => `<button class="pchip" data-id="${esc(q.id)}"><small>${esc(q.pref)}</small>${esc(fullName(q))}<i>${esc(q.yomi)}</i></button>`;
  const lines = [];
  if (sameKanji.length) lines.push(`<p><b>同じ字の地名</b>${sameKanji.map(chip).join(' ')}</p>`);
  if (sameYomi.length) lines.push(`<p><b>同じ読みの地名</b>${sameYomi.map(chip).join(' ')}</p>`);
  return lines.length ? `<div class="related">${lines.join('')}</div>` : '';
}

const linksHtml = p => `<div class="links">
  <a class="btn small" href="${mapUrl(p)}" target="_blank" rel="noopener">地図で見る</a>
  <a class="btn small ghost" href="${wikiUrl(p)}" target="_blank" rel="noopener">Wikipedia</a>
</div>`;

const dlg = document.getElementById('detail');
function openDetail(id) {
  const p = byId.get(id);
  if (!p) return;
  dlg.innerHTML = `<div class="dlg-body">
    <div class="dlg-top">
      <p class="kicker">${esc(where(p))}</p>
      <button class="close" aria-label="閉じる" data-close>${CLOSE_SVG}</button>
    </div>
    <h2 class="dlg-name">${nameHtml(p, true)}</h2>
    ${factsHtml(p)}
    ${relatedHtml(p)}
    <div class="row dlg-actions">${knownBtn(p.id, 'もう覚えた')}${linksHtml(p)}</div>
  </div>`;
  if (!dlg.open) dlg.showModal();
}
dlg.addEventListener('click', e => {
  if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  const chip = e.target.closest('.pchip[data-id]');
  if (chip) openDetail(chip.dataset.id);
});

// .pchip はどの画面でも詳細を開く
app.addEventListener('click', e => {
  const chip = e.target.closest('.pchip[data-id]');
  if (chip) openDetail(chip.dataset.id);
});

// ============================================================
// 一覧
// ============================================================
// 範囲の選び方（一覧・カード・クイズで共用）：地方を選ぶと、その地方の都道府県も選べる
const inScope = (p, ui) => (ui.pref ? p.pref === ui.pref : inRegion(p, ui.region));
const scopeLabel = ui => (ui.pref ? fullPref(ui.pref) : ui.region === 'all' ? '全国' : REGIONS.find(r => r.id === ui.region).label);

function scopeInner(ui) {
  const rg = REGIONS.find(r => r.id === ui.region);
  const chips = (kind, items, cur) => `<div class="chips scroll-x" data-scope="${kind}">${items.map(([k, v]) =>
    `<button type="button" class="chip" data-v="${k}" aria-pressed="${cur === k}">${esc(v)}</button>`).join('')}</div>`;
  return chips('region', [['all', '全国'], ...REGIONS.map(r => [r.id, r.label])], ui.region) +
    (rg && rg.prefs.length > 1 ? chips('pref', [['', `${rg.label}すべて`], ...rg.prefs.map(x => [x, x])], ui.pref || '') : '');
}

// el の中身を scopeInner で描き直す。onChange は選び直したあとに呼ぶ
function bindScope(el, ui, onChange) {
  el.innerHTML = scopeInner(ui);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    const kind = b && b.parentElement.dataset.scope;
    if (!kind) return;
    e.stopPropagation();
    if (kind === 'region') { ui.region = b.dataset.v; ui.pref = null; }
    else ui.pref = b.dataset.v || null;
    // 横スクロールの位置を保ったまま描き直す
    const sx = el.querySelector('[data-scope="region"]').scrollLeft;
    const px = kind === 'pref' ? el.querySelector('[data-scope="pref"]').scrollLeft : 0;
    el.innerHTML = scopeInner(ui);
    el.querySelector('[data-scope="region"]').scrollLeft = sx;
    const prefRow = el.querySelector('[data-scope="pref"]');
    if (prefRow) prefRow.scrollLeft = px;
    onChange();
  });
}

const listUI = { q: '', region: 'all', pref: null, filter: 'all', hide: false, drawToken: 0 };

function listRowHtml(p, weak) {
  return `<li class="prow ${isKnown(p.id) ? 'is-known' : ''}" data-row="${esc(p.id)}" tabindex="0">
    <div class="p-main">
      <span class="p-name">${weak.has(p.id) ? '<span class="dot" title="復習リストにあり"></span>' : ''}${nameHtml(p)}</span>
      <span class="p-yomi ${listUI.hide ? 'hidden-yomi' : ''}">${esc(p.yomi)}<small>${esc(p.sr)}</small></span>
    </div>
    <div class="p-sub">${p.city ? `<span>${esc(p.city)}</span>` : ''}<span class="stars">${stars(p.level)}</span></div>
    ${knownBtn(p.id)}
  </li>`;
}

function renderList() {
  app.innerHTML = `
    <section class="toolbar">
      <input type="search" id="q" placeholder="地名・読み・都道府県で検索" value="${esc(listUI.q)}">
      <div class="scope" id="l-scope"></div>
      <div class="row" style="justify-content:space-between">
        <div class="chips" id="l-filter">${[['all', 'すべて'], ['todo', 'まだ'], ['known', '覚えた']].map(([k, v]) => `<button class="chip" data-v="${k}" aria-pressed="${listUI.filter === k}">${v}</button>`).join('')}</div>
        <label class="toggle"><input type="checkbox" id="l-hide" ${listUI.hide ? 'checked' : ''}> 読みを隠す</label>
      </div>
    </section>
    <p class="meta" id="list-meta"></p>
    <div id="rows"></div>`;

  const draw = () => {
    const raw = listUI.q.trim();
    const q = kana(raw);
    const weak = weakIds();
    const match = p => !raw || [p.name, fullName(p), p.pref, fullPref(p.pref), p.city || ''].some(v => v.includes(raw)) || (q && kana(p.yomi + p.sr).includes(q));
    const rows = P.filter(p => inScope(p, listUI) && match(p) &&
      (listUI.filter === 'all' || (listUI.filter === 'known') === isKnown(p.id)));
    const blocks = [];
    for (const pref of PREFS) {
      const list = rows.filter(p => p.pref === pref);
      if (!list.length) continue;
      blocks.push({ pref, list });
    }
    const blockHtml = ({ pref, list }) => {
      const st = prefStats(pref);
      return `<section class="pref-block">
        <h3 class="pref-head"><a href="#map/${prefCode(pref)}">${esc(fullPref(pref))}</a><span>${st.known} / ${st.total} 覚えた</span></h3>
        <ul class="plist">${list.map(p => listRowHtml(p, weak)).join('')}</ul>
      </section>`;
    };
    // 全件を一度に描くとスマホで画面の切り替えが重くなるので、最初の数県だけ先に描き、残りは少しずつ足す
    const el = document.getElementById('rows');
    const token = ++listUI.drawToken;
    let i = 0;
    const take = limit => {
      let html = '', n = 0;
      while (i < blocks.length && n < limit) { html += blockHtml(blocks[i]); n += blocks[i].list.length; i++; }
      return html;
    };
    el.innerHTML = take(40) || '<p class="empty">該当する地名がありません</p>';
    const more = () => {
      if (token !== listUI.drawToken || i >= blocks.length || !el.isConnected) return;
      el.insertAdjacentHTML('beforeend', take(80));
      setTimeout(more, 30);
    };
    setTimeout(more, 60);
    document.getElementById('list-meta').textContent = `${rows.length}件の地名・タップで詳しく`;
  };

  document.getElementById('q').addEventListener('input', e => { listUI.q = e.target.value; draw(); });
  const chipGroup = (id, key) => document.getElementById(id).addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    listUI[key] = b.dataset.v;
    b.parentElement.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
    draw();
  });
  bindScope(document.getElementById('l-scope'), listUI, draw);
  chipGroup('l-filter', 'filter');
  document.getElementById('l-hide').addEventListener('change', e => { listUI.hide = e.target.checked; draw(); });
  const rowsEl = document.getElementById('rows');
  rowsEl.addEventListener('click', e => {
    const li = e.target.closest('[data-row]');
    if (li) openDetail(li.dataset.row);
  });
  rowsEl.addEventListener('keydown', e => {
    const li = e.target.closest('[data-row]');
    if (li && e.key === 'Enter') openDetail(li.dataset.row);
  });
  draw();
}

// ============================================================
// 制覇マップ（都道府県別のマスター率）
// ============================================================
// タイル地図の配置 [列, 行]（北海道は2×2）
const TILES = {
  北海道: [10, 0], 青森: [11, 2], 秋田: [10, 3], 岩手: [11, 3],
  石川: [7, 4], 富山: [8, 4], 新潟: [9, 4], 山形: [10, 4], 宮城: [11, 4],
  島根: [2, 5], 鳥取: [3, 5], 兵庫: [4, 5], 京都: [5, 5], 福井: [6, 5], 岐阜: [7, 5], 長野: [8, 5], 群馬: [9, 5], 栃木: [10, 5], 福島: [11, 5],
  山口: [1, 6], 広島: [2, 6], 岡山: [3, 6], 大阪: [4, 6], 奈良: [5, 6], 滋賀: [6, 6], 愛知: [7, 6], 山梨: [8, 6], 埼玉: [9, 6], 茨城: [10, 6],
  佐賀: [0, 7], 福岡: [1, 7], 大分: [2, 7], 和歌山: [5, 7], 三重: [6, 7], 静岡: [7, 7], 神奈川: [8, 7], 東京: [9, 7], 千葉: [10, 7],
  長崎: [0, 8], 熊本: [1, 8], 宮崎: [2, 8], 愛媛: [3, 8], 香川: [4, 8],
  鹿児島: [1, 9], 高知: [3, 9], 徳島: [4, 9],
  沖縄: [0, 10],
};
// マスター率の段階（0%／〜24／〜49／〜74／〜99／100%）
const tier = pct => (pct >= 100 ? 5 : pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : pct > 0 ? 1 : 0);
const mapUI = { pref: null };

function renderMap(param) {
  mapUI.pref = param && PREFS[+param - 1] ? PREFS[+param - 1] : null;
  if (mapUI.pref) return renderPref(mapUI.pref);

  const all = PREFS.map(pref => [pref, prefStats(pref)]);
  const known = all.reduce((s, [, st]) => s + st.known, 0);
  const done = all.filter(([, st]) => st.pct >= 100).length;
  const pct = Math.floor((known / P.length) * 100);
  const rate = state.total ? Math.round((state.correct / state.total) * 100) : 0;

  app.innerHTML = `
    <div class="panel summary">
      <div class="ring" style="--p:${pct}"><div><b>${pct}</b><small>%</small></div></div>
      <div>
        <h2>全国マスター率</h2>
        <div class="stats">
          <span>覚えた <b>${known}</b>/ ${P.length}</span>
          <span>制覇 <b>${done}</b>/ 47都道府県</span>
          <span>正答率 <b>${rate}</b>%</span>
        </div>
        <p class="note">「覚えた」を押した地名の割合です。全部覚えた都道府県は朱色に染まります。</p>
      </div>
    </div>
    <div class="panel map-panel">
      <div class="tilemap" role="list">${all.map(([pref, st]) => {
        const [c, r] = TILES[pref];
        const big = pref === '北海道';
        return `<a role="listitem" class="tile t${tier(st.pct)} ${pref.length > 2 && !big ? 'l3' : ''}" href="#map/${prefCode(pref)}"
          style="grid-column:${c + 1} / span ${big ? 2 : 1}; grid-row:${r + 1} / span ${big ? 2 : 1}"
          title="${esc(fullPref(pref))} ${st.known}/${st.total}（${st.pct}%）">${pref.length > 2 && !big ? `${esc(pref.slice(0, 2))}<br>${esc(pref.slice(2))}` : esc(pref)}</a>`;
      }).join('')}</div>
      <div class="legend">${['0%', '〜24%', '〜49%', '〜74%', '〜99%', '制覇'].map((t, i) => `<span><i class="t${i}"></i>${t}</span>`).join('')}</div>
    </div>
    <div class="regions">${REGIONS.map(rg => `
      <section class="panel region">
        <h3>${esc(rg.label)}</h3>
        <ul class="pref-bars">${rg.prefs.map(pref => {
          const st = prefStats(pref);
          return `<li><a href="#map/${prefCode(pref)}">
            <span class="pb-name">${esc(fullPref(pref))}${st.pct >= 100 ? '<span class="seal">制覇</span>' : ''}</span>
            <span class="pb-num">${st.known}/${st.total}</span>
            <span class="bar"><i class="t${tier(st.pct)}" style="width:${st.pct}%"></i></span>
          </a></li>`;
        }).join('')}</ul>
      </section>`).join('')}
    </div>`;
}

function prefHeadHtml(pref) {
  const st = prefStats(pref);
  const rate = st.n ? Math.round((st.ok / st.n) * 100) : 0;
  return `<div class="ring t${tier(st.pct)}" style="--p:${st.pct}"><div><b>${st.pct}</b><small>%</small></div></div>
    <div>
      ${pref === '北海道' ? '' : `<p class="kicker">${esc(REGIONS.find(r => r.prefs.includes(pref)).label)}地方</p>`}
      <h2>${esc(fullPref(pref))}${st.pct >= 100 ? '<span class="seal">制覇</span>' : ''}</h2>
      <div class="stats">
        <span>覚えた <b>${st.known}</b>/ ${st.total}</span>
        <span>解答 <b>${st.n}</b>問</span>
        <span>正答率 <b>${rate}</b>%</span>
      </div>
    </div>`;
}
function refreshPrefHead() {
  const el = document.getElementById('pref-head');
  if (el) el.innerHTML = prefHeadHtml(mapUI.pref);
}

function renderPref(pref) {
  const list = byPref.get(pref);
  const weak = weakIds();
  app.innerHTML = `
    <p class="crumb"><a href="#map">← 制覇マップ</a></p>
    <div class="panel summary" id="pref-head">${prefHeadHtml(pref)}</div>
    <div class="row" style="margin:14px 0">
      <button class="btn primary" id="p-quiz">この県でクイズ</button>
      <button class="btn" id="p-cards">カードで覚える</button>
    </div>
    <ul class="plist">${list.map(p => listRowHtml(p, weak)).join('')}</ul>`;

  // 出題パターンなどはクイズの設定画面で毎回選べるように、県を選んだ状態で設定画面を開く
  document.getElementById('p-quiz').addEventListener('click', () => {
    Object.assign(settings, { region: regionOf[pref], pref });
    session = null;
    location.hash = '#quiz';
  });
  document.getElementById('p-cards').addEventListener('click', () => {
    Object.assign(cardUI, { region: regionOf[pref], pref, hideKnown: false, weakOnly: false });
    buildCards();
    location.hash = '#cards';
  });
  app.querySelector('.plist').addEventListener('click', e => {
    const li = e.target.closest('[data-row]');
    if (li) openDetail(li.dataset.row);
  });
}

// ============================================================
// 暗記カード
// ============================================================
const cardUI = { front: 'kanji', region: 'all', pref: null, hideKnown: true, weakOnly: false, order: null, i: 0, flipped: false, sides: [] };

function buildCards() {
  const weak = weakIds();
  const list = P.filter(p => inScope(p, cardUI) &&
    (!cardUI.hideKnown || !isKnown(p.id)) && (!cardUI.weakOnly || weak.has(p.id)));
  cardUI.order = shuffle(list.map(p => p.id));
  cardUI.sides = list.map(() => (cardUI.front === 'random' ? pick(['kanji', 'yomi']) : cardUI.front));
  cardUI.i = 0;
  cardUI.flipped = false;
}

// 設定部分は最初に一度だけ描き、めくる・次へではカードの部分だけ描き直す
function renderCards() {
  if (!cardUI.order) buildCards();
  app.innerHTML = `
    <div class="toolbar">
      <div class="row">
        <span class="meta" style="margin:0">表に出すもの</span>
        <div class="chips" id="c-front">
          ${[['kanji', '漢字'], ['yomi', '読み'], ['random', 'ランダム']].map(([k, v]) => `<button class="chip" data-front="${k}" aria-pressed="${cardUI.front === k}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="scope" id="c-scope"></div>
      <div class="row">
        <label class="toggle"><input type="checkbox" id="c-hide" ${cardUI.hideKnown ? 'checked' : ''}> 覚えた地名は出さない</label>
        <label class="toggle"><input type="checkbox" id="c-weak" ${cardUI.weakOnly ? 'checked' : ''}> 復習リストの地名だけ</label>
      </div>
    </div>
    <div class="card-stage" id="card-stage"></div>`;

  const rebuild = () => { buildCards(); drawCard(); };
  document.getElementById('c-front').addEventListener('click', e => {
    const b = e.target.closest('[data-front]');
    if (!b) return;
    cardUI.front = b.dataset.front;
    b.parentElement.querySelectorAll('[data-front]').forEach(x => x.setAttribute('aria-pressed', x === b));
    rebuild();
  });
  bindScope(document.getElementById('c-scope'), cardUI, rebuild);
  document.getElementById('c-hide').addEventListener('change', e => { cardUI.hideKnown = e.target.checked; rebuild(); });
  document.getElementById('c-weak').addEventListener('change', e => { cardUI.weakOnly = e.target.checked; rebuild(); });

  const stage = document.getElementById('card-stage');
  stage.addEventListener('click', e => {
    if (e.target.closest('#card')) flipCard();
    else if (e.target.closest('#c-prev')) cardUI.go(-1);
    else if (e.target.closest('#c-next')) cardUI.go(1);
    else if (e.target.closest('#c-shuffle')) rebuild();
  });
  cardUI.go = d => {
    const n = cardUI.i + d;
    if (n < 0 || n >= cardUI.order.length) return;
    cardUI.i = n;
    cardUI.flipped = false;
    drawCard();
  };
  drawCard();
}

function flipCard() {
  cardUI.flipped = !cardUI.flipped;
  drawCard();
}

function drawCard() {
  const stage = document.getElementById('card-stage');
  if (!stage) return;
  const total = cardUI.order.length;
  const p = byId.get(cardUI.order[cardUI.i]);
  const side = cardUI.sides[cardUI.i];

  let face = '<div class="empty">該当するカードがありません</div>';
  if (p) {
    if (!cardUI.flipped) {
      face = side === 'kanji'
        ? `<div><div class="small">${esc(fullPref(p.pref))}</div><div class="big">${nameHtml(p)}</div><div class="hint">タップでめくる（スペースキー）</div></div>`
        : `<div><div class="small">${esc(fullPref(p.pref))}</div><div class="big kana">${esc(p.yomi)}<small>${esc(p.sr)}</small></div><div class="hint">どんな字？ タップでめくる</div></div>`;
    } else {
      face = `<div style="width:100%">
        <div class="small">${esc(where(p))}</div>
        <div class="big">${nameHtml(p, true)}</div>
        <p class="card-traps">${p.traps.map(t => `<s>${esc(t)}</s>`).join('')}</p>
        ${knownBtn(p.id, 'もう覚えた')}
      </div>`;
    }
  }
  stage.innerHTML = `
    <div class="flashcard ${cardUI.flipped ? 'back' : ''}" id="card" role="button" tabindex="0" aria-label="カードをめくる">${face}</div>
    <div class="card-progress">${esc(scopeLabel(cardUI))}　${total ? cardUI.i + 1 : 0} / ${total}</div>
    <div class="row">
      <button class="btn" id="c-prev" ${cardUI.i <= 0 ? 'disabled' : ''}>← 前へ</button>
      <button class="btn ghost" id="c-shuffle">シャッフル</button>
      <button class="btn primary" id="c-next" ${cardUI.i >= total - 1 ? 'disabled' : ''}>次へ →</button>
    </div>`;
}

// ============================================================
// クイズ：問題の作り方
// ============================================================
const TYPES = {
  yomi: '漢字 → 読み',
  kanji: '読み → 漢字',
  pref: '地名 → 都道府県',
};

// 読み → 漢字 の誤答：同じ都道府県 → 同じ地方 → 全国 の順に、字数の近い地名から選ぶ
function kanjiDistractors(p) {
  const ng = q => q.id === p.id || q.name === p.name || q.yomi === p.yomi;
  const out = [];
  const tiers = [
    P.filter(q => q.pref === p.pref),
    P.filter(q => regionOf[q.pref] === regionOf[p.pref]),
    P,
  ];
  for (const pool of tiers) {
    const cand = shuffle(pool.filter(q => !ng(q) && !out.some(o => o.name === q.name)))
      .sort((a, b) => Math.abs(a.name.length - p.name.length) - Math.abs(b.name.length - p.name.length));
    for (const q of cand) {
      if (out.length >= 3) break;
      if (!out.some(o => o.name === q.name)) out.push(q);
    }
    if (out.length >= 3) break;
  }
  return out.map(fullName);
}

// 地名 → 都道府県 の誤答：同じ地方を優先（同じ字・同じ読みの地名がある県は除く）
function prefDistractors(p) {
  const ng = new Set([p.pref, ...P.filter(q => q.name === p.name && q.yomi === p.yomi).map(q => q.pref)]);
  const near = shuffle(REGIONS.find(r => r.id === regionOf[p.pref]).prefs.filter(x => !ng.has(x)));
  const far = shuffle(PREFS.filter(x => !ng.has(x) && !near.includes(x)));
  return [...near.slice(0, 2), ...far].slice(0, 3).map(fullPref);
}

function makeQuestion(key) {
  const [id, type] = key.split(':');
  const p = byId.get(id);
  if (!p || !TYPES[type]) return null;
  const q = { key, type, p, label: TYPES[type] };

  if (type === 'yomi') {
    return Object.assign(q, {
      prompt: 'この地名、なんと読む？', show: nameHtml(p), sub: where(p),
      answer: p.yomi, choices: [p.yomi, ...p.traps], suffixRead: p.sr,
      check: v => yomiMatches(p, v), hint: 'ひらがなで入力（「ちょう」「し」などは付けても付けなくてもOK）',
    });
  }
  if (type === 'kanji') {
    return Object.assign(q, {
      prompt: '「' + p.yomi + p.sr + '」はどれ？', show: `<span class="kana">${esc(p.yomi)}<small>${esc(p.sr)}</small></span>`, sub: fullPref(p.pref) + (p.city ? `・${p.city}` : ''),
      answer: fullName(p), choices: [fullName(p), ...kanjiDistractors(p)], choiceOnly: true, kanjiChoices: true,
    });
  }
  if (type === 'pref') {
    return Object.assign(q, {
      prompt: 'この地名がある都道府県は？', show: nameHtml(p, true), sub: kindLabel(p),
      answer: fullPref(p.pref), choices: [fullPref(p.pref), ...prefDistractors(p)], choiceOnly: true,
    });
  }
  return null;
}

// ============================================================
// クイズ：画面
// ============================================================
const defaultSettings = { types: ['yomi', 'kanji'], mode: 'choice', region: 'all', pref: null, level: 'all', kind: 'all', todoOnly: false, n: 10, hint: false };
const settings = Object.assign({}, defaultSettings);
let session = null;

// 頭文字ヒント（「おしゃまんべ」なら「お」、小さい文字はひとまとまりにする）
function initialOf(yomi) {
  const m = yomi.match(/^.[ぁぃぅぇぉゃゅょゎ]?/u);
  return m ? m[0] : '';
}

function startSession(keys, { mode = settings.mode, title = 'クイズ', review = false, fromSettings = false } = {}) {
  const qs = keys.map(makeQuestion).filter(Boolean).map(q => Object.assign(q, { choices: shuffle(q.choices) }));
  session = { qs, i: 0, mode, title, review, fromSettings, hint: settings.hint, results: [], answered: null };
}

// 「覚えた」地名は出題確率を 1/5 に下げる（まったく出さないと忘れるので、たまに出す）
const KNOWN_RATE = 0.2;
const keepByKnown = p => !isKnown(p.id) || Math.random() < KNOWN_RATE;

function poolFromSettings() {
  return P.filter(p => inScope(p, settings) && inLevel(p, settings.level) && inKind(p, settings.kind) &&
    (!settings.todoOnly || !isKnown(p.id)));
}

function buildKeysFromSettings() {
  const pool = shuffle(poolFromSettings());
  const keys = new Set();
  for (let i = 0; keys.size < settings.n && i < pool.length * 2; i++) {
    const p = pool[i % pool.length];
    if (i < pool.length && !keepByKnown(p)) continue;
    keys.add(`${p.id}:${pick(settings.types)}`);
  }
  return shuffle([...keys]);
}

function renderQuiz() {
  if (!session) return renderQuizSettings();
  if (session.i >= session.qs.length) return renderQuizResult();
  renderQuestion();
}

function renderQuizSettings() {
  const rate = state.total ? Math.round((state.correct / state.total) * 100) : 0;
  const group = (g, items) => `<div class="chips" data-group="${g}">${items.map(([k, v]) => `<button type="button" class="chip" data-v="${k}" aria-pressed="${String(settings[g]) === String(k)}">${v}</button>`).join('')}</div>`;
  app.innerHTML = `
    <div class="panel">
      <h2>クイズの設定</h2>
      <form class="settings" id="qs-form">
        <fieldset>
          <legend>出題パターン（複数選択可）</legend>
          <div class="checks">${Object.entries(TYPES).map(([k, v]) => `<label class="check"><input type="checkbox" name="types" value="${k}" ${settings.types.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>答え方</legend>
          ${group('mode', [['choice', '4択'], ['input', '入力']])}
          <p class="note" id="mode-note"></p>
          <label class="toggle" style="margin-top:8px"><input type="checkbox" name="hint" ${settings.hint ? 'checked' : ''}> 頭文字と文字数をヒントに出す（入力のとき）</label>
        </fieldset>
        <fieldset>
          <legend>範囲（地方を選ぶと都道府県も選べます）</legend>
          <div class="scope" id="qs-scope"></div>
          <label class="toggle" style="margin-top:10px"><input type="checkbox" name="todoOnly" ${settings.todoOnly ? 'checked' : ''}> まだ覚えていない地名だけ</label>
        </fieldset>
        <fieldset>
          <legend>難しさ</legend>
          ${group('level', LEVELS)}
        </fieldset>
        <fieldset>
          <legend>種類</legend>
          ${group('kind', KINDS)}
        </fieldset>
        <fieldset>
          <legend>問題数</legend>
          ${group('n', [10, 20, 30, 50].map(n => [n, `${n}問`]))}
        </fieldset>
        <p class="meta" id="pool-meta"></p>
        <div class="row" style="justify-content:space-between">
          <div class="stats"><span><b>${state.total}</b>問 解答</span><span>正答率 <b>${rate}</b>%</span><span>覚えた <b>${Object.keys(state.known).length}</b>件</span></div>
          <button class="btn primary" type="submit" id="qs-start">スタート</button>
        </div>
      </form>
    </div>`;

  const form = document.getElementById('qs-form');
  const sync = () => {
    // 入力で答えられるのは「漢字 → 読み」だけなので、それが選ばれていないときは入力を選べなくする
    const canInput = settings.types.includes('yomi');
    if (!canInput) settings.mode = 'choice';
    const inputChip = form.querySelector('[data-group="mode"] [data-v="input"]');
    inputChip.disabled = !canInput;
    form.querySelectorAll('[data-group="mode"] [data-v]').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === settings.mode));
    document.getElementById('mode-note').textContent = canInput
      ? (settings.types.length > 1 ? '入力で答えるのは「漢字 → 読み」だけです（ほかは4択で出ます）。' : '')
      : '入力で答えられるのは「漢字 → 読み」だけです。';
    const n = poolFromSettings().length;
    document.getElementById('pool-meta').textContent = `この条件の地名：${n}件`;
    document.getElementById('qs-start').disabled = settings.types.length === 0 || n === 0;
  };
  form.addEventListener('change', e => {
    if (e.target.name === 'types') settings.types = [...form.querySelectorAll('input[name=types]:checked')].map(i => i.value);
    if (e.target.name === 'hint') settings.hint = e.target.checked;
    if (e.target.name === 'todoOnly') settings.todoOnly = e.target.checked;
    sync();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const g = b.parentElement.dataset.group;
    if (!g || b.disabled) return;
    settings[g] = g === 'n' ? +b.dataset.v : b.dataset.v;
    b.parentElement.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
    sync();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!settings.types.length) return;
    state.settings = settings;
    save();
    startSession(buildKeysFromSettings(), { title: settings.pref || settings.region !== 'all' ? `${scopeLabel(settings)}のクイズ` : 'クイズ', fromSettings: true });
    renderQuiz();
  });
  bindScope(document.getElementById('qs-scope'), settings, sync);
  sync();
}

const nextLabel = () => (session.i + 1 < session.qs.length ? '次へ →' : '結果を見る');

// 問題文の部分（4択・入力で共用）。長い地名は1行に収まるよう字を小さくする
function questionTopHtml(q) {
  const s = session;
  const len = q.type === 'kanji' ? 0 : q.p.name.length + (q.p.suffix ? 0.62 : 0);
  return `<div class="q-head"><span>${esc(s.title)}</span><span>${s.i + 1} / ${s.qs.length}</span></div>
    <div class="q-progress"><i style="width:${(s.i / s.qs.length) * 100}%"></i></div>
    <span class="q-label">${esc(q.label)}</span>
    <p class="q-prompt">${esc(q.prompt)}</p>
    <div class="q-show ${len ? 'fit' : ''}" ${len ? `style="--len:${len}"` : ''}>${q.show}</div>
    <p class="q-sub">${esc(q.sub)}</p>`;
}

const feedbackHtml = q => `<div class="feedback">
    <p class="kicker">${esc(where(q.p))}</p>
    <h3 class="fb-name">${nameHtml(q.p, true)}</h3>
    ${factsHtml(q.p)}
    ${relatedHtml(q.p)}
    ${linksHtml(q.p)}
  </div>`;

function renderQuestion() {
  const q = session.qs[session.i];
  if (session.mode === 'choice' || q.choiceOnly) renderChoiceQuestion(q);
  else renderInputQuestion(q);
}

function renderChoiceQuestion(q) {
  const ans = session.answered;
  let fb = '';
  if (ans) {
    // 判定と「次へ」は答えたすぐ下に出し、解説はその下にまとめる（簡単な問題はスクロールせずに次へ進める）
    const correctText = q.type === 'yomi' ? `正解：${fullYomi(q.p)}` : `正解：${q.answer}`;
    fb = `<div class="verdict-bar ${ans.ok ? 'ok' : 'ng'}">
        <div><p class="verdict">${ans.ok ? 'せいかい！' : 'おしい…！'}</p>${ans.ok ? '' : `<p class="your">${esc(correctText)}</p>`}</div>
        <div class="verdict-actions">
          ${ans.ok ? knownBtn(q.p.id, 'もう覚えた') : ''}
          <button class="btn primary" id="next">${nextLabel()}</button>
        </div>
      </div>
      ${feedbackHtml(q)}`;
  }
  app.innerHTML = `
    <div class="panel" id="q-shell" data-mode="choice">
      ${questionTopHtml(q)}
      <div class="choices ${q.kanjiChoices ? 'kanji' : ''}">${q.choices.map((c, i) => {
        let cls = '';
        if (ans) cls = c === q.answer ? 'correct' : (c === ans.input ? 'wrong' : '');
        return `<button class="choice ${cls}" data-c="${esc(c)}" ${ans ? 'disabled' : ''}><kbd>${i + 1}</kbd><span>${esc(c)}${q.suffixRead ? `<small>${esc(q.suffixRead)}</small>` : ''}</span></button>`;
      }).join('')}</div>
      ${fb}
    </div>
    <div class="row" style="margin-top:12px; justify-content:flex-end">
      <button class="btn ghost small" id="quit">やめる</button>
    </div>`;

  app.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => answer(b.dataset.c)));
  document.getElementById('next')?.addEventListener('click', nextQuestion);
  document.getElementById('quit').addEventListener('click', quitQuiz);
  if (ans) document.getElementById('next').focus({ preventScroll: true });
}

// 入力モード：入力欄は問題が変わっても作り直さない（作り直すとキーボードが閉じて開き直し、画面が上下に動くため）。
// 判定は入力欄の上に出し、「答える」「次へ」はどちらもキーボードの決定キーで押せる
function renderInputQuestion(q) {
  const ans = session.answered;
  let input = document.getElementById('ans');
  if (!input || document.getElementById('q-shell')?.dataset.mode !== 'input') {
    app.innerHTML = `
      <div class="panel" id="q-shell" data-mode="input">
        <div id="q-top"></div>
        <div class="q-slot" id="q-slot"></div>
        <form class="answer-form" id="ans-form" autocomplete="off">
          <input type="text" id="ans" lang="ja" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ひらがなで入力">
          <button class="btn primary" type="submit" id="ans-btn">答える</button>
        </form>
        <div class="row" id="ans-sub" style="justify-content:flex-end; margin-top:6px">
          <button type="button" class="btn ghost small" id="giveup">わからない</button>
        </div>
        <div id="q-fb"></div>
      </div>
      <div class="row" style="margin-top:12px; justify-content:flex-end">
        <button class="btn ghost small" id="quit">やめる</button>
      </div>`;
    input = document.getElementById('ans');
    document.getElementById('ans-form').addEventListener('submit', e => {
      e.preventDefault();
      if (session.answered) return nextQuestion();
      const v = input.value.trim();
      if (v) answer(v);
    });
    document.getElementById('giveup').addEventListener('click', () => answer(''));
    document.getElementById('quit').addEventListener('click', quitQuiz);
    // ボタンを押しても入力欄からフォーカスが外れない（キーボードが閉じない）ようにする
    document.getElementById('q-shell').addEventListener('mousedown', e => {
      if (e.target.closest('#ans-btn, #giveup, #q-slot button')) e.preventDefault();
    });
    input.addEventListener('focus', () => document.body.classList.add('typing'));
    input.addEventListener('blur', () => document.body.classList.remove('typing'));
    input.focus();
    document.getElementById('q-shell').scrollIntoView({ block: 'start' });
  }

  document.getElementById('q-top').innerHTML = questionTopHtml(q);
  const slot = document.getElementById('q-slot');
  if (!ans) {
    slot.className = 'q-slot';
    slot.innerHTML = session.hint
      ? `<p class="q-hint">ヒント：<b>${esc(initialOf(q.p.yomi))}</b> から始まる ${[...q.p.yomi].length}文字</p>`
      : `<p class="slot-note">${esc(q.hint)}</p>`;
    input.value = '';
  } else {
    slot.className = `q-slot ${ans.ok ? 'ok' : 'ng'}`;
    slot.innerHTML = ans.ok
      ? `<div class="slot-text"><p class="verdict">せいかい！</p><p class="slot-ans">${esc(fullYomi(q.p))}</p></div>${knownBtn(q.p.id, '覚えた')}`
      : `<div class="slot-text"><p class="verdict">おしい…</p><p class="slot-ans">正解：${esc(fullYomi(q.p))}</p></div>`;
  }
  input.classList.toggle('ok', !!ans && ans.ok);
  input.classList.toggle('ng', !!ans && !ans.ok);
  document.getElementById('ans-btn').textContent = ans ? nextLabel() : '答える';
  document.getElementById('ans-sub').style.visibility = ans ? 'hidden' : '';
  document.getElementById('q-fb').innerHTML = ans ? feedbackHtml(q) : '';
}

function quitQuiz() {
  session = null;
  document.body.classList.remove('typing');
  renderQuiz();
}

function answer(input) {
  const s = session;
  if (s.answered) return;
  const q = s.qs[s.i];
  const ok = s.mode === 'choice' || q.choiceOnly ? input === q.answer : q.check(input);
  s.answered = { input, ok };
  s.results.push({ key: q.key, ok });
  state.total++;
  const st = state.stat[q.p.id] || [0, 0];
  state.stat[q.p.id] = [st[0] + 1, st[1] + (ok ? 1 : 0)];
  if (ok) {
    state.correct++;
    delete state.miss[q.key];
  } else {
    const m = state.miss[q.key] || { n: 0 };
    state.miss[q.key] = { n: m.n + 1, at: Date.now() };
    delete state.known[q.p.id]; // 覚えたつもりで間違えたら、覚えたを外す
  }
  save();
  updateBadge();
  renderQuestion();
}

function nextQuestion() {
  const wasInput = document.getElementById('q-shell')?.dataset.mode === 'input';
  session.i++;
  session.answered = null;
  renderQuiz();
  // 入力モードで次も入力の問題なら、画面を動かさない
  if (!(wasInput && document.getElementById('q-shell')?.dataset.mode === 'input')) {
    document.body.classList.remove('typing');
    window.scrollTo({ top: 0 });
  }
}

const qText = q => (q.type === 'kanji' ? `${fullYomi(q.p)}（${q.p.pref}）` : fullName(q.p));
const aText = q => (q.type === 'yomi' ? fullYomi(q.p) : q.answer);

function renderQuizResult() {
  const s = session;
  const okN = s.results.filter(r => r.ok).length;
  const wrong = s.results.filter(r => !r.ok).map(r => makeQuestion(r.key)).filter(Boolean);
  app.innerHTML = `
    <div class="panel">
      <p class="meta" style="margin-top:0">${esc(s.title)}の結果</p>
      <p class="score">${okN}<small> / ${s.results.length} 問正解</small></p>
      ${wrong.length ? `<h3>間違えた問題（復習リストに追加済み）</h3>
        <ul class="miss-list">${wrong.map(q => `<li><div><div class="m-q">${esc(q.label)}｜${esc(qText(q))}</div><div class="m-a">${esc(aText(q))}</div></div><button class="pchip" data-id="${esc(q.p.id)}">詳細</button></li>`).join('')}</ul>`
        : '<p>全問正解です！</p>'}
      <div class="row" style="margin-top:18px">
        ${wrong.length ? '<button class="btn primary" id="retry-wrong">間違えた問題をもう一度</button>' : ''}
        <button class="btn" id="again">同じ設定でもう一度</button>
        <button class="btn ghost" id="to-settings">設定に戻る</button>
      </div>
    </div>`;
  document.getElementById('retry-wrong')?.addEventListener('click', () => {
    startSession(shuffle(wrong.map(q => q.key)), { mode: s.mode, title: '間違えた問題', review: true });
    renderQuiz();
  });
  document.getElementById('again').addEventListener('click', () => {
    if (s.fromSettings) startSession(buildKeysFromSettings(), { title: s.title, fromSettings: true });
    else startSession(shuffle(s.qs.map(q => q.key)), { mode: s.mode, title: s.title, review: s.review });
    renderQuiz();
  });
  document.getElementById('to-settings').addEventListener('click', () => { session = null; renderQuiz(); });
}

// ============================================================
// 復習
// ============================================================
const reviewUI = { mode: 'choice' };

function renderReview() {
  const entries = Object.entries(state.miss)
    .map(([key, v]) => ({ key, q: makeQuestion(key), n: v.n, at: v.at }))
    .filter(e => e.q)
    .sort((a, b) => b.n - a.n || b.at - a.at);
  const known = Object.entries(state.known)
    .map(([id, at]) => ({ p: byId.get(id), at }))
    .filter(e => e.p)
    .sort((a, b) => b.at - a.at);

  const missPanel = entries.length ? `
    <div class="panel">
      <h2>復習リスト（${entries.length}件）</h2>
      <p class="lead">間違えた問題だけを出題します。正解するとリストから外れます。</p>
      <div class="row" style="justify-content:space-between">
        <div class="chips" id="rv-mode">
          <button class="chip" data-v="choice" aria-pressed="${reviewUI.mode === 'choice'}">4択</button>
          <button class="chip" data-v="input" aria-pressed="${reviewUI.mode === 'input'}">入力</button>
        </div>
        ${reviewUI.mode === 'input' ? `<label class="toggle"><input type="checkbox" id="rv-hint" ${settings.hint ? 'checked' : ''}> 頭文字ヒント</label>` : ''}
        <button class="btn primary" id="rv-start">復習スタート（${Math.min(entries.length, 20)}問）</button>
      </div>
      <h3>苦手な問題（間違えた回数順）</h3>
      <ul class="miss-list">${entries.map(e => `
        <li>
          <div><div class="m-q">${esc(e.q.label)}｜${esc(qText(e.q))}</div><div class="m-a">${esc(aText(e.q))}</div></div>
          <div class="row"><span class="m-n">×${e.n}</span><button class="btn ghost small" data-del="${esc(e.key)}" aria-label="リストから外す">外す</button></div>
        </li>`).join('')}
      </ul>
      <div class="row" style="margin-top:16px; justify-content:flex-end">
        <button class="btn ghost small" id="rv-clear">リストを全部消す</button>
      </div>
    </div>` : `
    <div class="panel empty">
      <p>復習リストは空です。</p>
      <p style="font-size:13px">クイズで間違えた問題がここにたまります。正解するとリストから外れます。</p>
      <a class="btn primary" href="#quiz">クイズをする</a>
    </div>`;

  const knownPanel = known.length ? `
    <div class="panel" style="margin-top:16px">
      <h2>覚えた地名（${known.length}件）</h2>
      <p class="lead">「覚えた」にした地名は、クイズに出る確率が1/5になります。クイズで間違えると自動で外れます。</p>
      <ul class="miss-list">${known.map(e => `
        <li>
          <div><div class="m-q">${esc(where(e.p))}</div><div class="m-a">${esc(fullName(e.p))}　<span class="m-yomi">${esc(fullYomi(e.p))}</span></div></div>
          <button class="btn ghost small" data-unknown="${esc(e.p.id)}" aria-label="覚えた地名から外す">外す</button>
        </li>`).join('')}
      </ul>
    </div>` : '';

  app.innerHTML = missPanel + knownPanel;

  document.getElementById('rv-mode')?.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    reviewUI.mode = b.dataset.v;
    renderReview();
  });
  document.getElementById('rv-hint')?.addEventListener('change', e => {
    settings.hint = e.target.checked;
    state.settings = settings;
    save();
  });
  document.getElementById('rv-start')?.addEventListener('click', () => {
    // 間違いの多いものを優先しつつ、順番はシャッフル
    startSession(shuffle(entries.slice(0, 20).map(e => e.key)), { mode: reviewUI.mode, title: '復習', review: true });
    location.hash = '#quiz';
  });
  app.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    delete state.miss[b.dataset.del];
    save();
    updateBadge();
    renderReview();
  }));
  app.querySelectorAll('[data-unknown]').forEach(b => b.addEventListener('click', () => {
    setKnown(b.dataset.unknown, false);
    renderReview();
  }));
  document.getElementById('rv-clear')?.addEventListener('click', () => {
    if (!confirm('復習リストを全部消しますか？')) return;
    state.miss = {};
    save();
    updateBadge();
    renderReview();
  });
}

// ============================================================
// キーボード操作・画面切り替え
// ============================================================
document.addEventListener('keydown', e => {
  if (dlg.open || accountDlg.open || document.body.classList.contains('locked') || e.metaKey || e.ctrlKey || e.altKey) return;
  const view = currentView();
  const typing = e.target.matches('input, textarea, select');
  if (view === 'cards' && !typing) {
    if (e.key === ' ') { e.preventDefault(); flipCard(); }
    if (e.key === 'ArrowRight') cardUI.go?.(1);
    if (e.key === 'ArrowLeft') cardUI.go?.(-1);
  }
  if (view === 'quiz' && session && session.i < session.qs.length && !typing) {
    const q = session.qs[session.i];
    if (!session.answered && (session.mode === 'choice' || q.choiceOnly) && /^[1-4]$/.test(e.key)) {
      const c = q.choices[+e.key - 1];
      if (c) answer(c);
    }
  }
});

const VIEWS = { list: renderList, map: renderMap, cards: renderCards, quiz: renderQuiz, review: renderReview };
const hashParts = () => location.hash.slice(1).split('/');
const currentView = () => (hashParts()[0] in VIEWS ? hashParts()[0] : 'list');

function markTab(v) {
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function route() {
  const v = currentView();
  markTab(v);
  document.body.classList.remove('typing');
  if (v !== 'map') mapUI.pref = null;
  VIEWS[v](hashParts()[1]);
  updateBadge();
}

// ============================================================
// アカウント（Supabase）と同期
// ============================================================
const cfg = window.NANDOKU_CONFIG || {};
const sb = window.supabase && cfg.supabaseUrl ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
const TABLE = 'nandoku_progress';
const account = { user: null, status: '' }; // status: saving / saved / error
const accountBtn = document.getElementById('account-btn');
const accountDlg = document.getElementById('account');
let syncTimer = null;

const displayName = u => (u.user_metadata && u.user_metadata.name) || u.email.split('@')[0];
const hasProgress = s => s && (s.total > 0 || Object.keys(s.miss || {}).length > 0 || Object.keys(s.known || {}).length > 0);

function updateAccountBtn() {
  accountBtn.hidden = !account.user;
  if (!account.user) return;
  accountBtn.textContent = displayName(account.user);
  accountBtn.dataset.status = account.status;
}

function scheduleSync() {
  if (!account.user || account.user.guest) return;
  account.status = 'saving';
  updateAccountBtn();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushRemote, 800);
}

async function pushRemote() {
  clearTimeout(syncTimer);
  syncTimer = null;
  if (!account.user || account.user.guest) return;
  const { error } = await sb.from(TABLE).upsert({
    user_id: account.user.id, data: state, updated_at: new Date(state.updatedAt || Date.now()).toISOString(),
  });
  account.status = error ? 'error' : 'saved';
  updateAccountBtn();
}

// 複数端末で同じアカウントを使うので、新しく更新された方を採用する
async function pullRemote() {
  const { data, error } = await sb.from(TABLE).select('data').eq('user_id', account.user.id).maybeSingle();
  if (error) { account.status = 'error'; return; }
  const remote = data && data.data;
  if (remote && (remote.updatedAt || 0) >= (state.updatedAt || 0)) {
    replaceState(remote);
    writeLocal(storeKey, state);
  } else if (hasProgress(state)) {
    await pushRemote();
  }
  account.status = 'saved';
}

async function switchToUser(user) {
  account.user = user;
  storeKey = `${GUEST_KEY}:${user.id}`;
  replaceState(readLocal(storeKey) || {});
  if (!user.guest) await pullRemote();
  Object.assign(settings, defaultSettings, state.settings || {});
  updateAccountBtn();
  unlock();
}

async function logout() {
  if (syncTimer) await pushRemote();
  if (!account.user.guest) await sb.auth.signOut();
  account.user = null;
  account.status = '';
  storeKey = GUEST_KEY;
  replaceState({});
  session = null;
  cardUI.order = null;
  updateAccountBtn();
  lock();
}

// ============================================================
// ログイン画面（未ログインのときはコンテンツを表示しない）
// ============================================================
const gate = document.getElementById('gate');

function lock(message) {
  document.body.classList.add('locked');
  app.innerHTML = '';
  if (dlg.open) dlg.close();
  if (message) {
    gate.innerHTML = `<div class="panel gate-panel"><p class="lead" style="margin:0">${esc(message)}</p></div>`;
    return;
  }
  gate.innerHTML = `<div class="panel gate-panel">
    <h2>ログイン</h2>
    <p class="lead">このアプリは登録したメンバー専用です。</p>
    <form id="login-form" class="settings" style="gap:10px">
      <input type="email" name="email" placeholder="メールアドレス" autocomplete="username" required>
      <input type="password" name="password" placeholder="パスワード" autocomplete="current-password" required>
      <p class="login-error" id="login-error" hidden></p>
      <button class="btn primary" type="submit">ログイン</button>
    </form>
  </div>`;
  const form = gate.querySelector('#login-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = gate.querySelector('#login-error');
    btn.disabled = true;
    err.hidden = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) {
      btn.disabled = false;
      err.textContent = /invalid login credentials/i.test(error.message) ? 'メールアドレスかパスワードが違います' : `ログインできませんでした（${error.message}）`;
      err.hidden = false;
      return;
    }
    await switchToUser(data.user);
  });
  form.email.focus();
}

function unlock() {
  gate.innerHTML = '';
  document.body.classList.remove('locked');
  route();
}

const STATUS_TEXT = { saving: '保存中…', saved: 'クラウドに保存済み', error: '保存に失敗しました（通信を確認してください）' };

function openAccount() {
  if (!account.user) return;
  const guest = account.user.guest;
  accountDlg.innerHTML = `<div class="dlg-body">
    <div class="dlg-top"><h2>${esc(displayName(account.user))}</h2><button class="close" aria-label="閉じる" data-close>${CLOSE_SVG}</button></div>
    <p class="meta">${esc(account.user.email)}</p>
    <p>${esc(guest ? '確認用のお試しモード（このブラウザにだけ保存）' : STATUS_TEXT[account.status] || '')}</p>
    <p class="note">覚えた地名・成績・復習リストはこのアカウントに保存され、ログインしたどの端末でも同じ内容になります。ほかの人には見えません。</p>
    ${guest ? '' : `<details class="pw-change">
      <summary>パスワードを変更する</summary>
      <form id="pw-form" class="settings" style="gap:10px; margin-top:12px">
        <input type="email" name="username" value="${esc(account.user.email)}" autocomplete="username" hidden>
        <input type="password" name="pw1" placeholder="新しいパスワード（6文字以上）" autocomplete="new-password" minlength="6" required>
        <input type="password" name="pw2" placeholder="新しいパスワード（確認）" autocomplete="new-password" minlength="6" required>
        <p class="login-error" id="pw-error" hidden></p>
        <p class="form-ok" id="pw-ok" hidden>パスワードを変更しました。次回からは新しいパスワードでログインしてください。</p>
        <button class="btn primary" type="submit">変更する</button>
      </form>
    </details>`}
    <div class="row" style="margin-top:16px; justify-content:flex-end"><button class="btn" id="logout">ログアウト</button></div>
  </div>`;
  accountDlg.querySelector('#logout').addEventListener('click', async () => { accountDlg.close(); await logout(); });
  const pwForm = accountDlg.querySelector('#pw-form');
  pwForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const err = accountDlg.querySelector('#pw-error');
    const ok = accountDlg.querySelector('#pw-ok');
    const btn = pwForm.querySelector('button[type=submit]');
    err.hidden = true;
    ok.hidden = true;
    if (pwForm.pw1.value !== pwForm.pw2.value) {
      err.textContent = '2つの入力が一致しません';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: pwForm.pw1.value });
    btn.disabled = false;
    if (error) {
      const m = error.message;
      err.textContent = /different from the old/i.test(m) ? '今と同じパスワードです。別のパスワードにしてください'
        : /at least|weak/i.test(m) ? 'パスワードが短すぎるか、簡単すぎます。6文字以上で、推測されにくいものにしてください'
        : /reauthenticat|nonce/i.test(m) ? '本人確認が必要な設定になっています。管理者に連絡してください'
        : `変更できませんでした（${m}）`;
      err.hidden = false;
      return;
    }
    pwForm.reset();
    ok.hidden = false;
  });
  accountDlg.showModal();
}
accountDlg.addEventListener('click', e => {
  if (e.target === accountDlg || e.target.closest('[data-close]')) accountDlg.close();
});
accountBtn.addEventListener('click', openAccount);

// 画面を閉じる・アプリを切り替える前に、未送信の変更を送る
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && syncTimer) pushRemote();
});

// 手元での確認用：localhost で ?guest を付けて開くと、ログインせずにこのブラウザだけで動かせる
const DEV_GUEST = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('guest');

async function initAccount() {
  updateAccountBtn();
  if (DEV_GUEST) return switchToUser({ id: 'guest', email: 'お試しモード', guest: true, user_metadata: { name: 'お試し' } });
  if (!sb) return lock('ログインサービスに接続できませんでした。通信状況を確認して、ページを再読み込みしてください。');
  const { data } = await sb.auth.getSession();
  if (data.session) await switchToUser(data.session.user);
  else lock();
}

document.getElementById('count').textContent = P.length;
// 画面の切り替え：押したタブをすぐ光らせて「読み込み中」を出し、いったん画面に反映させてから描く
// （描くのに時間がかかっても、押したことが分かるように）
window.addEventListener('hashchange', () => {
  if (document.body.classList.contains('locked')) return;
  markTab(currentView());
  document.body.classList.add('busy');
  const hash = location.hash;
  let done = false;
  const go = () => {
    if (done || hash !== location.hash) return;
    done = true;
    route();
    window.scrollTo({ top: 0 });
    document.body.classList.remove('busy');
  };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 120); // 画面が裏にあって requestAnimationFrame が止まっているときの保険
});
initAccount();
