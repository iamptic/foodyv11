(() => { console.log('[Foody] merchant app · city manual + profile redirect');
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on = (sel, evt, fn) => { const el = $(sel); if (el) el.addEventListener(evt, fn, { passive:false }); };

  function dtLocalToIso(v){
    if (!v) return null;
    try {
      const [d, t] = v.split(' ');
      const [Y,M,D] = d.split('-').map(x=>parseInt(x,10));
      const [h,m] = (t||'00:00').split(':').map(x=>parseInt(x,10));
      const dt = new Date(Y, (M-1), D, h, m);
      return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16)+':00Z';
    } catch(e){ return null; }
  }

  const state = {
    api: (window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || 'https://foodyback-production.up.railway.app',
    rid: localStorage.getItem('foody_restaurant_id') || '',
    key: localStorage.getItem('foody_key') || '',
  };

  const toastBox = $('#toast');
  const showToast = (msg) => {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  };

  function toggleLogout(visible){
    const btn = $('#logoutBtn'); if (!btn) return;
    btn.style.display = visible ? '' : 'none';
  }

  function updateCreds(){
    const el = $('#creds');
    if (el) el.textContent = JSON.stringify({ restaurant_id: state.rid, api_key: state.key }, null, 2);
  }

  // Tabs
  function activateTab(tab) {
    $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.pane').forEach(p => p.classList.toggle('active', p.id === tab));
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
    activateTab('offers');
    toggleLogout(true);
    return true;
  }
  on('#logoutBtn','click', () => {
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
    let res;
    try {
      res = await fetch(url, { method, headers: h, body });
    } catch (err) {
      throw new Error('Не удалось связаться с сервером. Проверьте соединение или CORS.');
    }
    if (!res.ok) {
      const ct = res.headers.get('content-type')||'';
      let msg = `${res.status} ${res.statusText}`;
      if (ct.includes('application/json')) {
        const j = await res.json().catch(()=>null);
        if (j && (j.detail || j.message)) msg = j.detail || j.message || msg;
      } else {
        const t = await res.text().catch(()=>'');
        if (t) msg += ` — ${t.slice(0,180)}`;
      }
      throw new Error(msg);
    }
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  // ===== AUTH (slider) =====
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
      $('#loginError')?.classList.add('hidden');
      $('#registerError')?.classList.add('hidden');
    }
    if (modeLogin) modeLogin.addEventListener('change', apply);
    if (modeReg) modeReg.addEventListener('change', apply);
    apply();
  }
  bindAuthToggle();

  function showInlineError(id, text){
    const el = $(id); if (!el) { showToast(text); return; }
    el.textContent = text; el.classList.remove('hidden');
    setTimeout(()=> el.classList.add('hidden'), 5000);
  }

  // Helpers
  function normalizePhoneFromLogin(login){
    const digits = String(login||'').replace(/\D+/g,'');
    if (!digits) return '';
    if (digits[0]==='8') return '+7'+digits.slice(1);
    return '+'+digits;
  }
  function attachPhoneFormatter(){
    const ph = document.querySelector('#profileForm input[name="phone"]');
    if (!ph) return;
    ph.addEventListener('blur', () => {
      const digits = ph.value.replace(/\D+/g,'');
      if (!digits) return;
      ph.value = (digits[0]==='8' ? '+7'+digits.slice(1) : ('+'+digits));
    });
  }

  on('#registerForm','submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name')?.toString().trim();
    const login = fd.get('login')?.toString().trim();
    const password = fd.get('password')?.toString().trim();
    const city = (fd.get('city')||'').toString().trim();
    const address = (fd.get('address')||'').toString().trim();

    const payload = { name, login, password, city };
    try {
      const r = await api('/api/v1/merchant/register_public', { method:'POST', body: JSON.stringify(payload) });
      if (!r.restaurant_id || !r.api_key) throw new Error('Неожиданный ответ API');
      state.rid = r.restaurant_id; state.key = r.api_key;
      localStorage.setItem('foody_restaurant_id', state.rid);
      localStorage.setItem('foody_key', state.key);

      // Prefill profile: city/address/phone if логин был телефоном
      try {
        const upd = { restaurant_id: state.rid, city: city || null, address: (address || city) || null };
        const phoneNorm = normalizePhoneFromLogin(login);
        if (phoneNorm.length > 1) upd.phone = phoneNorm;
        await api('/api/v1/merchant/profile', { method:'PUT', body: JSON.stringify(upd) });
      } catch(e){ console.warn('profile prefill failed', e); }
      try { localStorage.setItem('foody_city', city); localStorage.setItem('foody_reg_city', city); } catch(_){}

      // Go to profile and ask to fill it
      activateTab('profile'); showToast('Заполните профиль — добавьте адрес и контакты'); loadProfile();
    } catch (err) {
      const msg = String(err.message||'Ошибка регистрации');
      if (msg.includes('409') || /already exists/i.test(msg)) {
        showInlineError('#registerError','Такой телефон/email уже зарегистрирован.');
      } else if (msg.includes('password')) {
        showInlineError('#registerError','Пароль слишком короткий (мин. 6 символов).');
      } else if (msg.includes('phone') || msg.includes('email')) {
        showInlineError('#registerError','Заполните телефон или email корректно.');
      } else {
        showInlineError('#registerError', msg);
      }
      console.error(err);
    }
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
    } catch (err) {
      const msg = String(err.message||'');
      if (msg.includes('401') || /invalid login or password/i.test(msg)) {
        showInlineError('#loginError', 'Неверный логин или пароль.');
      } else {
        showInlineError('#loginError', msg || 'Ошибка входа');
      }
      console.error(err);
    }
  });

  // ===== PROFILE =====
  async function loadProfile() {
    if (!state.rid || !state.key) return;
    try {
      const p = await api(`/api/v1/merchant/profile?restaurant_id=${encodeURIComponent(state.rid)}`);
      const f = $('#profileForm');
      f.name.value = p.name || ''; f.phone.value = p.phone || '';
      f.address.value = p.address || '';
      try {
        const cityInput = document.getElementById('profileCity') || document.querySelector('#profileForm input[name="city"]');
        if (cityInput) cityInput.value = p.city || localStorage.getItem('foody_city') || localStorage.getItem('foody_reg_city') || '';
        if ((!p.address || String(p.address).trim() === '') && (p.city || localStorage.getItem('foody_reg_city'))) {
          f.address.value = p.city || localStorage.getItem('foody_reg_city');
        }
      } catch(_) {}
      f.close_time.value = (p.close_time || '').slice(0,5);
      attachPhoneFormatter();
      $('#profileDump')?.textContent = JSON.stringify(p, null, 2);
    } catch (err) { console.warn(err); showToast('Не удалось загрузить профиль: ' + err.message); }
  }
  on('#profileForm','submit', async (e) => {
    e.preventDefault();
    if (!state.rid || !state.key) return showToast('Сначала войдите');
    const fd = new FormData(e.currentTarget);
    const city = (fd.get('city')||'').toString().trim();
    const payload = {
      restaurant_id: state.rid,
      name: fd.get('name')?.toString().trim(),
      phone: null, // sanitized below
      address: fd.get('address')?.toString().trim() || null,
      city: city || null,
      close_time: fd.get('close_time') || null,
    };
    // sanitize phone
    const ph = (fd.get('phone')||'').toString().replace(/\D+/g,'');
    if (ph) payload.phone = (ph[0]==='8' ? '+7'+ph.slice(1) : ('+'+ph));
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
    const expiresLocal = fd.get('expires_at');
    const expiresIso = dtLocalToIso(expiresLocal);
    if (!expiresIso) { showToast('Укажите дату и время окончания оффера'); return; }
    const payload = {
      restaurant_id: state.rid,
      title: fd.get('title')?.toString().trim(),
      price: parseFloat(fd.get('price') || '0'),
      original_price: fd.get('original_price') ? parseFloat(fd.get('original_price')) : null,
      qty_total: Number(fd.get('qty_total')) || 1,
      qty_left: Number(fd.get('qty_total')) || 1,
      expires_at: expiresIso,
      image_url: fd.get('image_url')?.toString().trim() || null,
      category: (fd.get('category')||'').toString().trim() || null,
      description: fd.get('description')?.toString().trim() || null,
    };
    try {
      await api('/api/v1/merchant/offers', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Оффер создан ✅'); e.currentTarget.reset(); loadOffers(); activateTab('offers'); $('#offerError')?.classList.add('hidden');
    } catch (err) {
      const msg = String(err.message||'Ошибка создания оффера');
      if (msg.includes('CORS') || /связаться с сервером/i.test(msg)) {
        showInlineError('#offerError','Не удалось отправить запрос. Проверьте соединение.');
      } else if (/expires_at/i.test(msg)) {
        showInlineError('#offerError','Некорректная дата окончания.');
      } else {
        showInlineError('#offerError', msg);
      }
      console.error(err);
    }
  });

  async function loadOffers() {
    if (!state.rid || !state.key) return;
    const root = $('#offerList');
    if (root) root.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const items = await api(`/api/v1/merchant/offers?restaurant_id=${encodeURIComponent(state.rid)}`);
      renderOffers(items || []);
    } catch (err) { console.error(err); if (root) root.innerHTML = '<div class="hint">Не удалось загрузить</div>'; }
  }

  function renderOffers(items){
    const root = $('#offerList'); if (!root) return;
    if (!Array.isArray(items) || items.length === 0) { root.innerHTML = '<div class="hint">Пока нет офферов</div>'; return; }
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

  document.addEventListener('DOMContentLoaded', () => { gate(); attachPhoneFormatter(); });
})();