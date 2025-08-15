
(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const state = {
    api: (window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || 'https://foodyback-production.up.railway.app',
    key: localStorage.getItem('foody_key') || '',
  };

  function fallbackPreview(input){
    const wrap = $('#photoPreviewWrap'); const img = $('#photoPreview');
    if (!input || !input.files || !input.files[0] || !wrap || !img) return;
    const url = URL.createObjectURL(input.files[0]);
    img.src = url; wrap.classList.remove('hidden');
  }

  function initFilePond(){
    try {
      if (!window.FilePond || !$('#photo')) return false;
      const pond = FilePond.create($('#photo'), {
        allowMultiple: false,
        allowRevert: false,
        acceptedFileTypes: ['image/*'],
        labelIdle: 'Перетащите фото или нажмите',
        server: {
          process: (fieldName, file, metadata, load, error, progress, abort) => {
            const fd = new FormData(); fd.append('file', file, file.name);
            const ctrl = new AbortController();
            fetch(`${state.api}/api/v1/upload`, {
              method: 'POST',
              body: fd,
              signal: ctrl.signal,
              headers: state.key ? { 'X-Foody-Key': state.key } : {}
            }).then(r => r.json()).then(j => {
              if (j && j.url){
                const hid = document.getElementById('image_url');
                if (hid) hid.value = j.url;
                const wrap = document.getElementById('photoPreviewWrap');
                const img = document.getElementById('photoPreview');
                if (wrap && img){ img.src = j.url; wrap.classList.remove('hidden'); }
                load(j.url);
              } else { error('Upload failed'); }
            }).catch(err => error(err.message));
            return { abort: () => { ctrl.abort(); abort(); } };
          }
        }
      });
      return true;
    } catch (e) { return false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!initFilePond()) {
      const input = $('#photo');
      if (input) input.addEventListener('change', () => fallbackPreview(input));
    }
  });
})();
