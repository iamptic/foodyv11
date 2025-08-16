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

  
  // City UI: simple prefill from localStorage
  function initCityUI(){
    try {
      const regCity = document.getElementById('cityInput');
      const profCity = document.getElementById('profileCity');
      const saved = localStorage.getItem('foody_city') || localStorage.getItem('foody_reg_city');
      if (saved && regCity && !regCity.value) regCity.value = saved;
      if (saved && profCity && !profCity.value) profCity.value = saved;
    } catch(e) {}
  }
  try { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', initCityUI) : initCityUI(); } catch(e) {}
document.addEventListener('DOMContentLoaded', () => {
    gate(); gate();
  });

})();
