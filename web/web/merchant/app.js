
function validateLoginValue(v) {
  if (!v) return 'Введите телефон или email';
  v = v.toString().trim();
  if (v.includes('@')) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'Некорректный email';
  } else {
    const digits = v.replace(/\D/g,''); if (digits.length < 10) return 'Укажите номер телефона (10+ цифр)';
  }
  return '';
}


// --- UX helpers ---
function setLoading(btn, on, textOn) {
  try {
    if (!btn) return;
    if (!btn.dataset) btn.dataset = {};
    if (on) {
      btn.dataset._text = btn.textContent;
      if (textOn) btn.textContent = textOn;
      btn.disabled = true;
    } else {
      if (btn.dataset._text) btn.textContent = btn.dataset._text;
      btn.disabled = false;
    }
  } catch(_) {}
}
(() => { console.log('[Foody] app.js (auth slider) loaded');
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on = (sel, evt, fn) => { const el = $(sel); if (el) el.addEventListener(evt, fn, { passive: false }); };

  function moneyToCents(v){ try { return Math.round(parseFloat(v||'0')*100) } catch(e){ return 0 } }
  function dtLocalToIso(v){
    if (!v) return null;
    try {
      // flatpickr provides 'Y-m-d H:i' local time; treat as local, convert to ISO
      const [d, t] = v.split(' ');
      const [Y,M,D] = d.split('-').map(x=>parseInt(x,10));
      const [h,m] = (t||'00:00').split(':').map(x=>parseInt(x,10));
      const dt = new Date(Y, (M-1), D, h, m);
      return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16)+':00Z';
    } catch(e){ return null; }
  }

  
  // City UI: toggle 'Другой' custom input and remember selection
  function initCityUI(){
    const sel = document.getElementById('citySelect');
    const wrap = document.getElementById('cityCustomWrap');
    const inp = document.getElementById('cityCustom');
    if (!sel) return;
    const apply = () => {
      const isOther = sel.value === 'other';
      if (wrap) wrap.style.display = isOther ? '' : 'none';
      if (inp) inp.required = isOther;
      if (!isOther && inp) { inp.value = ''; inp.required = false; }
    };
    sel.addEventListener('change', apply);
    apply();
  }
const state = {
    api: (window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || 'https://foodyback-production.up.railway.app',
    rid: localStorage.getItem('foody_restaurant_id') || '',
    key: localStorage.getItem('foody_key') || '',
  };

  const toastBox = $('#toast');
  function toggleLogout(visible){
    const btn = $('#logoutBtn'); if (!btn) return;
    btn.style.display = visible ? '' : 'none';
  }

  const showToast = (msg) => {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  };

  // Tabs (segmented + bottom nav)
  function activateTab(tab) {
    $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.pane').forEach(p => p.classList.toggle('active', p.id === tab));
    if (tab === 'dashboard') refreshDashboard();
    if (tab === 'offers') loadOffers();
    if (tab === 'profile') loadProfile();
    if (tab === 'export') updateCreds();
    if (tab === 'create') initCreateTab();
  }
  on('#tabs','click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    if (btn.dataset.tab) activateTab(btn.dataset.tab);
  });
  on('.bottom-nav','click', (e) => {
    const btn = e.target.closest('.nav-btn'); if (!btn) return;
    if (btn.dataset.tab) activateTab(btn.dataset.tab);
  });

  // Auth gating
  function gate() {
    if (!state.rid || !state.key) {
      activateTab('auth');
      const tabs = $('#tabs'); if (tabs) tabs.style.display = 'none';
      const bn = $('.bottom-nav'); if (bn) bn.style.display = 'none';
      toggleLogout(false);
      return false;
    }
    const tabs = $('#tabs'); if (tabs) tabs.style.display = '';
    const bn = $('.bottom-nav'); if (bn) bn.style.display = '';
    activateTab('dashboard');
    return true;
  }
  $('#logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('foody_restaurant_id');
    localStorage.removeItem('foody_key');
    state.rid = ''; state.key = '';
    showToast('Вы вышли');
    gate();
  });

  // API helper
  async function api(path, { method='GET', headers={}, body=null, raw=false } = {}) {
    const url = `${state.api}${path}`;
    const h = { 'Content-Type': 'application/json', ...headers };
    if (state.key) h['X-Foody-Key'] = state.key;
    const res = await fetch(url, { method, headers: h, body });
    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      throw new Error(`${res.status} ${res.statusText} — ${txt}`);
    }
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  // ===== AUTH (slider) =====
  // Toggle forms based on radio
  function bindAuthToggle(){
    const loginForm = $('#loginForm');
    const regForm = $('#registerForm');
    const modeLogin = $('#mode-login');
    const modeReg = $('#mode-register');
    const forms = $('.auth-forms');
    function apply(){
      if (modeLogin && modeLogin.checked) {
        loginForm.style.display='grid'; regForm.style.display='none';
        forms.setAttribute('data-mode','login');
      } else {
        regForm.style.display='grid'; loginForm.style.display='none';
        forms.setAttribute('data-mode','register');
      }
    }
    if (modeLogin) modeLogin.addEventListener('change', apply);
    if (modeReg) modeReg.addEventListener('change', apply);
    apply();
  }
  bindAuthToggle();

  on('#registerForm','submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const _btn = e.currentTarget.querySelector('button[type="submit"]');
    setLoading(_btn, true, 'Регистрируем…');

    const citySel = document.getElementById('citySelect');
    const cityInp = document.getElementById('cityCustom');
    let city = '';
    if (citySel) { city = (citySel.value === 'other') ? (cityInp ? (cityInp.value||'').trim() : '') : (citySel.value||''); }
    if (!city) { try { city = (fd.get('city')||'').toString().trim(); } catch(_) {} }
    if (city) try { localStorage.setItem('foody_reg_city', city); } catch(_) {}
    const address = (fd.get('address') || '').toString().trim();

    const payload = {
      city: city,
      name: fd.get('name')?.toString().trim(),
      login: fd.get('login')?.toString().trim(),
      password: fd.get('password')?.toString().trim()
    };

    if (!payload.password || payload.password.length < 6) { showToast('Пароль: минимум 6 символов'); setLoading(_btn,false); return; }
    const _loginErr = validateLoginValue(payload.login);
    if (_loginErr) { showToast(_loginErr); setLoading(_btn,false); return; }

    try {
      const r = await api('/api/v1/merchant/register_public', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.restaurant_id || !r.api_key) throw new Error('Неожиданный ответ API');
      state.rid = r.restaurant_id; state.key = r.api_key;
      localStorage.setItem('foody_restaurant_id', state.rid);
      localStorage.setItem('foody_key', state.key);

      try {
        await api('/api/v1/merchant/profile', { method: 'PUT', body: JSON.stringify({
          restaurant_id: state.rid,
          city,
          address
        }) });
      } catch (e2) { console.warn('profile sync failed', e2); }

      showToast('Ресторан создан ✅');
      setLoading(_btn,false);
      gate();
      activateTab('profile');
    } catch (err) {
      setLoading(_btn,false);
      console.error(err);
      showToast('Ошибка регистрации: ' + err.message);
    }
  });

  on('#loginForm','submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const _btn = e.currentTarget.querySelector('button[type="submit"]');
    setLoading(_btn, true, 'Входим…');
    const _loginErr = validateLoginValue(fd.get('login'));
    if (_loginErr) { showToast(_loginErr); setLoading(_btn,false); return; }
    const payload = { login: fd.get('login')?.toString().trim(), password: fd.get('password')?.toString().trim() };
    try {
      const r = await api('/api/v1/merchant/login', { method: 'POST', body: JSON.stringify(payload) });
      state.rid = r.restaurant_id; state.key = r.api_key;
      localStorage.setItem('foody_restaurant_id', state.rid);
      localStorage.setItem('foody_key', state.key);
      showToast('Вход выполнен ✅');
      gate();
    } catch (err) { console.error(err); showToast('Ошибка входа: ' + err.message); }
  });

  // ===== PROFILE =====
  async function loadProfile() {
    if (!state.rid || !state.key) return;
    try {
      const p = await api(`/api/v1/merchant/profile?restaurant_id=${encodeURIComponent(state.rid)}`);
      const f = $('#profileForm');
      f.name.value = p.name || ''; f.phone.value = p.phone || '';
      f.address.value = p.address || ''; f.lat.value = p.lat ?? ''; f.lng.value = p.lng ?? '';
      try { if (f.city) f.city.value = p.city || ''; } catch(_) {}
      try { const pc = document.getElementById('profileCity'); if (pc) pc.value = p.city || ''; } catch(_) {}
      try {
        if ((!p.address || String(p.address).trim() === '') && localStorage.getItem('foody_reg_city')) {
          f.address.value = localStorage.getItem('foody_reg_city');
        }
      } catch(_) {}

      f.close_time.value = (p.close_time || '').slice(0,5);
      $('#profileDump').textContent = JSON.stringify(p, null, 2);
    } catch (err) { console.warn(err); showToast('Не удалось загрузить профиль: ' + err.message); }
  }
  on('#profileForm','submit', async (e) => {
    e.preventDefault();
    if (!state.rid || !state.key) return showToast('Сначала войдите');
    const fd = new FormData(e.currentTarget);
    const payload = {
      restaurant_id: state.rid,
      name: fd.get('name')?.trim(),
      phone: fd.get('phone')?.trim(),
      address: fd.get('address')?.trim(),
      city: (fd.get('city')?.trim() || document.getElementById('profileCity')?.value?.trim() || ''),
      close_time: fd.get('close_time') || null,
    };
    try {
      await api('/api/v1/merchant/profile', { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Профиль обновлен ✅'); loadProfile();
    } catch (err) { console.error(err); showToast('Ошибка сохранения: ' + err.message); }
  });

  // ===== CREATE OFFER =====
  function initCreateTab(){
    try {
      if (window.flatpickr && $('#expires_at')) {
        if (window.flatpickr.l10ns && window.flatpickr.l10ns.ru) { flatpickr.localize(flatpickr.l10ns.ru); }
        flatpickr('#expires_at', {
          enableTime: true, time_24hr: true, minuteIncrement: 5,
          dateFormat: 'Y-m-d H:i', altInput: true, altFormat: 'd.m.Y H:i',
          defaultDate: new Date(Date.now() + 60*60*1000), minDate: 'today'
        });
      }
    } catch (e) {}
  }

  on('#offerForm','submit', async (e) => {
    e.preventDefault();
    if (!state.rid || !state.key) return showToast('Сначала войдите');
    const fd = new FormData(e.currentTarget);
    const payload = {
      restaurant_id: state.rid,
      title: fd.get('title')?.trim(),
      price: parseFloat(fd.get('price') || '0'),
      original_price: fd.get('original_price') ? parseFloat(fd.get('original_price')) : null,
      qty_total: Number(fd.get('qty_total')) || 1,
      qty_left: Number(fd.get('qty_total')) || 1,
      expires_at: dtLocalToIso(fd.get('expires_at')),
      image_url: fd.get('image_url')?.trim() || null,
      category: (fd.get('category')||'').trim() || null,
      description: fd.get('description')?.trim() || null,
    };
    try {
      await api('/api/v1/merchant/offers', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Оффер создан ✅');
      e.currentTarget.reset();
      loadOffers();
      activateTab('offers');
    toggleLogout(true);
    } catch (err) { console.error(err); showToast('Ошибка создания: ' + err.message); }
  });

  async function loadOffers() {
    if (!state.rid || !state.key) return;
    const root = $('#offerList');
    root.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const items = await api(`/api/v1/merchant/offers?restaurant_id=${encodeURIComponent(state.rid)}`);
      renderOffers(items || []); updateDashboardStats(items || []);
    } catch (err) { console.error(err); root.innerHTML = '<div class="hint">Не удалось загрузить</div>'; }
  }

  function renderOffers(items){
    const root = $('#offerList');
    if (!Array.isArray(items) || items.length === 0) {
      root.innerHTML = '<div class="hint">Пока нет офферов</div>';
      return;
    }
    const head = `<div class="row head"><div>Название</div><div>Цена</div><div>Скидка</div><div>Остаток</div><div>До</div></div>`;
    const rows = items.map(o => {
      const price = (o.price_cents||0)/100;
      const old = (o.original_price_cents||0)/100;
      const disc = old>0 ? Math.round((1 - price/old)*100) : 0;
      const exp = o.expires_at ? new Date(o.expires_at).toLocaleString() : '—';
      return `<div class="row">
        <div>${o.title || '—'}</div>
        <div>${price.toFixed(2)}</div>
        <div>${disc?`-${disc}%`:'—'}</div>
        <div>${o.qty_left ?? '—'} / ${o.qty_total ?? '—'}</div>
        <div>${exp}</div>
      </div>`;
    }).join('');
    root.innerHTML = head + rows;
  }

  function updateDashboardStats(items){
    const active = items.length;
    const qty = items.reduce((s,x)=> s + (Number(x.qty_left)||0), 0);
    const discs = items.map(o => {
      const p = (o.price_cents||0)/100;
      const old = (o.original_price_cents||0)/100;
      return old>0 ? Math.round((1 - p/old)*100) : 0;
    }).filter(Boolean);
    const avg = discs.length ? Math.round(discs.reduce((a,b)=>a+b,0)/discs.length) : 0;
    $('#statActive').textContent = String(active);
    $('#statQty').textContent = String(qty);
    $('#statDisc').textContent = avg ? `-${avg}%` : '—';
  }

  // Dashboard (reuse offers)
  async function refreshDashboard(){
    await loadOffers();
    const list = $('#offerList').querySelectorAll('.row:not(.head)');
    const box = $('#dashboardOffers');
    if (!list.length) { box.innerHTML = '<div class="hint">Нет активных офферов</div>'; return; }
    box.innerHTML='';
    list.forEach(row => {
      const name = row.children[0]?.textContent || '—';
      const price = row.children[1]?.textContent || '—';
      const left = row.children[3]?.textContent || '—';
      const exp = row.children[4]?.textContent || '—';
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<div class="text"><div class="name">${name}</div><div class="muted">${exp}</div></div><div class="badge">${price} • ${left}</div>`;
      box.appendChild(item);
    });
  }

  // EXPORT
  on('#downloadCsv','click', async () => {
    if (!state.rid || !state.key) return showToast('Сначала войдите');
    try {
      const res = await fetch(`${state.api}/api/v1/merchant/offers/csv?restaurant_id=${encodeURIComponent(state.rid)}`, {
        headers: { 'X-Foody-Key': state.key }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `foody_offers_${state.rid}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      showToast('CSV скачан ✅');
    } catch (err) { console.error(err); showToast('Ошибка экспорта: ' + err.message) }
  });

  // Photo preview (native fallback if FilePond isn't active)
  function bindPhotoPreview(){
    try {
      const el = document.getElementById('photo');
      if (!el || el._previewBound) return;
      el._previewBound = true;
      el.addEventListener('change', () => {
        if (document.querySelector('.filepond--root')) return; // FilePond handles previews
        const f = el.files && el.files[0];
        const wrap = document.getElementById('photoPreviewWrap');
        const img = document.getElementById('photoPreview');
        if (!wrap || !img) return;
        if (f) {
          const reader = new FileReader();
          reader.onload = () => { img.src = reader.result; wrap.classList.remove('hidden'); };
          reader.readAsDataURL(f);
        } else {
          wrap.classList.add('hidden'); img.removeAttribute('src');
        }
      });
    } catch (e) {}
  }
  bindPhotoPreview();

  // Init
    try { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', initCityUI) : initCityUI(); } catch(e) {}

document.addEventListener('DOMContentLoaded', () => {
    gate(); gate();
  });

})();


function initPasswordToggles(scope=document) {
  try {
    const inputs = scope.querySelectorAll('form input[type="password"]');
    inputs.forEach(inp => {
      if (inp.dataset.hasToggle) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle';
      btn.textContent = 'Показать';
      btn.addEventListener('click', () => {
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Скрыть' : 'Показать';
      });
      inp.insertAdjacentElement('afterend', btn);
      inp.dataset.hasToggle = '1';
    });
  } catch(e) { console.warn('pw toggle init failed', e); }
}
document.addEventListener('DOMContentLoaded', () => initPasswordToggles(document));
