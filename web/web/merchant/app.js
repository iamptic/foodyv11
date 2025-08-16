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
    const form = e.currentTarget;
        const citySel = document.getElementById('citySelect');
  const cityInp = document.getElementById('cityCustom');
  let city = '';
  if (citySel) { city = citySel.value === 'other' ? (cityInp ? (cityInp.value||'').trim() : '') : (citySel.value||''); }
  if (city) try { localStorage.setItem('foody_reg_city', city); } catch(_) {}
  const address = (fd.get('address') || '').toString().trim();
const payload = { city: city,  city: city,
       name: fd.get('name')?.trim(), login: fd.get('login')?.trim(), password: fd.get('password')?.trim() };
    try {
      const r = await api('/api/v1/merchant/register_public', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.restaurant_id || !r.api_key) throw new Error('Неожиданный ответ API');
      state.rid = r.restaurant_id; state.key = r.api_key;
      localStorage.setItem('foody_restaurant_id', state.rid);
      localStorage.setItem('foody_key', state.key);
            try { if (city) { try { localStorage.setItem('foody_city', (fd.get('city')||'').toString().trim()); } catch(_) {}
      await api('/api/v1/merchant/profile', { method: 'PUT', body: JSON.stringify({ restaurant_id: state.rid, address: (address || city), city: city }) }); } } catch(e) { console.warn('city save failed', e); }
      showToast('Ресторан создан ✅');
      gate(); activateTab('profile');
    } catch (err) { console.error(err); showToast('Ошибка регистрации: ' + err.message); }
  });

  on('#loginForm','submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = { login: fd.get('login')?.trim(), password: fd.get('password')?.trim() };
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
      try { form && form.reset && form.reset(); } catch(_) {}
      try { const w=document.getElementById('photoPreviewWrap'); const i=document.getElementById('photoPreview'); const h=document.getElementById('image_url'); if(w) w.classList.add('hidden'); if(i) i.removeAttribute('src'); if(h) h.value=''; } catch(_) {}
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

  // Guard against double-open of file dialog
  try {
    const __photo = document.getElementById('photo');
    if (__photo && !__photo._doubleGuard) {
      __photo._doubleGuard = true;
      let __last = 0;
      __photo.addEventListener('click', (ev) => {
        const now = Date.now();
        if (now - __last < 700) { ev.stopImmediatePropagation(); ev.preventDefault(); return; }
        __last = now;
      }, true);
    }
  } catch(e) { console.warn('photo double-guard failed', e); }


  // Init
    try { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', initCityUI) : initCityUI(); } catch(e) {}

document.addEventListener('DOMContentLoaded', () => {
    gate(); gate();
  });

})();

function dtLocalToIso(v){
  try{
    if(!v) return null;
    // Accepts 'YYYY-MM-DDTHH:mm' OR plain 'HH:mm' combined with today
    if(/^\d{2}:\d{2}$/.test(v)){
      const now=new Date(); const [h,m]=v.split(':').map(Number);
      now.setHours(h,m,0,0);
      return now.toISOString();
    }
    const d=new Date(v);
    return isNaN(d)? null : d.toISOString();
  }catch(_){return null;}
}
function isoToLocalInput(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function addMinutesToIso(iso, mins){
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes()+mins);
  return d.toISOString();
}
function todayAt(hour, min){
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}
function applyCloseTime(){
  try{
    const f=document.querySelector('#profileForm');
    const ct = f ? (f.querySelector('[name="close_time"]')?.value || '') : '';
    if(!ct) { showToast('Укажите время закрытия в профиле'); return null; }
    const [h,m]=ct.split(':').map(Number);
    return todayAt(h||21, m||0);
  }catch(e){ return null; }
}
function initQuickTimeButtons(){
  const exp = document.getElementById('expires_at');
  if(!exp) return;
  const setExp = (iso)=>{ if(!iso) return; exp.value = isoToLocalInput(iso); };
  const b30 = document.getElementById('btnPlus30');
  const b60 = document.getElementById('btnPlus60');
  const b120= document.getElementById('btnPlus120');
  const b2100= document.getElementById('btnToday2100');
  const bClose= document.getElementById('btnCloseTime');
  if(b30 && !b30._bound){ b30._bound=true; b30.addEventListener('click', ()=> setExp(addMinutesToIso(dtLocalToIso(exp.value), 30))); }
  if(b60 && !b60._bound){ b60._bound=true; b60.addEventListener('click', ()=> setExp(addMinutesToIso(dtLocalToIso(exp.value), 60))); }
  if(b120&& !b120._bound){ b120._bound=true; b120.addEventListener('click',()=> setExp(addMinutesToIso(dtLocalToIso(exp.value),120))); }
  if(b2100&& !b2100._bound){ b2100._bound=true; b2100.addEventListener('click',()=> setExp(todayAt(21,0))); }
  if(bClose&& !bClose._bound){ bClose._bound=true; bClose.addEventListener('click',()=> { const iso=applyCloseTime(); if(iso) setExp(iso); }); }
}
document.addEventListener('DOMContentLoaded', initQuickTimeButtons);
