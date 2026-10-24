// Campo de WhatsApp: +55 fixo, DDD escolhido numa lista e o celular com 9 dígitos (começando com 9).
// Uso: <input id="phone" data-tel> — o campo original fica escondido e recebe "DDD+número"
// (ex.: 48999999999), então o resto da página continua lendo .value normalmente.
(function () {
  var DDD = {
    AC: [68], AL: [82], AP: [96], AM: [92, 97], BA: [71, 73, 74, 75, 77], CE: [85, 88], DF: [61], ES: [27, 28],
    GO: [62, 64], MA: [98, 99], MT: [65, 66], MS: [67], MG: [31, 32, 33, 34, 35, 37, 38], PA: [91, 93, 94],
    PB: [83], PR: [41, 42, 43, 44, 45, 46], PE: [81, 87], PI: [86, 89], RJ: [21, 22, 24], RN: [84],
    RS: [51, 53, 54, 55], RO: [69], RR: [95], SC: [47, 48, 49], SP: [11, 12, 13, 14, 15, 16, 17, 18, 19],
    SE: [79], TO: [63],
  };
  var list = [];
  Object.keys(DDD).forEach(function (uf) { DDD[uf].forEach(function (d) { list.push([d, uf]); }); });
  list.sort(function (a, b) { return a[0] - b[0]; });

  var css = document.createElement('style');
  css.textContent =
    '.tel-wrap{display:flex;gap:8px;align-items:stretch}' +
    '.tel-cc{display:flex;align-items:center;padding:0 12px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-weight:700;white-space:nowrap}' +
    '.tel-wrap select{flex:0 0 auto;width:auto;min-width:104px;height:48px;padding:0 10px;border-radius:8px;border:1px solid var(--line,#333);background:#121214;color:var(--text,#fff);font-size:16px;outline:0}' +
    '.tel-wrap select:focus{border-color:var(--brand,#ec0b43)}' +
    '.tel-wrap input{flex:1 1 auto;min-width:0}';
  document.head.appendChild(css);

  function mount(orig) {
    var wrap = document.createElement('div');
    wrap.className = 'tel-wrap';
    var cc = document.createElement('span');
    cc.className = 'tel-cc';
    cc.textContent = '+55';
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', 'DDD');
    sel.innerHTML = '<option value="">DDD</option>' + list.map(function (x) { return '<option value="' + x[0] + '">' + x[0] + ' · ' + x[1] + '</option>'; }).join('');
    var num = document.createElement('input');
    num.type = 'tel';
    num.inputMode = 'numeric';
    num.autocomplete = 'tel-national';
    num.placeholder = '9 9999-9999';
    num.setAttribute('aria-label', 'Celular (9 dígitos)');
    orig.type = 'hidden';
    orig.parentNode.insertBefore(wrap, orig);
    wrap.appendChild(cc);
    wrap.appendChild(sel);
    wrap.appendChild(num);
    wrap.appendChild(orig);

    var fmt = function (d) { return d.replace(/^(\d)(\d{0,4})(\d{0,4}).*/, function (m, a, b, c) { return a + (b ? ' ' + b : '') + (c ? '-' + c : ''); }); };
    var sync = function () { orig.value = sel.value && num.value ? sel.value + num.value.replace(/\D/g, '') : ''; };
    // Preenche a partir de um valor já existente (com ou sem 55 na frente).
    var set = function (v) {
      var d = String(v || '').replace(/\D/g, '');
      if (d.length === 13 && d.indexOf('55') === 0) d = d.slice(2);
      if (d.length >= 10 && DDD_SET[d.slice(0, 2)]) { sel.value = d.slice(0, 2); num.value = fmt(d.slice(2, 11)); }
      sync();
    };
    num.addEventListener('input', function () {
      var d = num.value.replace(/\D/g, '');
      // Digitou ou colou o 55 e/ou o DDD aqui: separa sozinho. "55" seguido de 9 é o DDD 55 (RS);
      // seguido de outro número, é o código do Brasil.
      if (d.length >= 3 && d.indexOf('55') === 0 && d[2] !== '9') d = d.slice(2);
      if (d.length >= 2 && d[0] !== '9' && DDD_SET[d.slice(0, 2)]) { sel.value = d.slice(0, 2); d = d.slice(2); }
      num.value = fmt(d.slice(0, 9));
      sync();
    });
    sel.addEventListener('change', sync);
    if (orig.value) set(orig.value);
    orig.telSet = set;
    // Validação no próprio aparelho antes de enviar.
    orig.telError = function () {
      if (!sel.value) return 'Escolha o DDD.';
      var d = num.value.replace(/\D/g, '');
      if (d.length !== 9 || d[0] !== '9') return 'O celular tem 9 dígitos e começa com 9 (sem o DDD).';
      return '';
    };
    if (orig.id) { sel.id = orig.id + '-ddd'; num.id = orig.id + '-num'; }
  }
  var DDD_SET = {};
  list.forEach(function (x) { DDD_SET[x[0]] = 1; });
  window.mountTel = mount;
  Array.prototype.forEach.call(document.querySelectorAll('input[data-tel]'), mount);
})();
