// Preenche nos Termos e na Política os dados da empresa, preço e contatos configurados no servidor.
fetch('/api/v1/plans')
  .then((r) => r.json())
  .then((j) => {
    const set = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
    if (j.company) set('.co', (el) => (el.textContent = j.company));
    if (j.cnpj) set('.cnpj', (el) => (el.textContent = `, CNPJ ${j.cnpj}`));
    if (j.address) set('.addr', (el) => (el.textContent = `, com sede em ${j.address}`));
    const monthly = (j.plans || []).find((p) => p.days <= 31) || (j.plans || [])[0];
    if (monthly) set('.price', (el) => (el.textContent = monthly.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })));
    if (j.graceDays) set('.grace', (el) => (el.textContent = j.graceDays));
    const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const per = (d) => (d >= 360 ? 'por ano' : d >= 175 ? 'a cada 6 meses' : d >= 85 ? 'a cada 3 meses' : 'por mês');
    if ((j.plans || []).length) set('.plans-list', (el) => (el.textContent = j.plans.map((p) => `${p.name} (${brl(p.price)} ${per(p.days)})`).join(', ').replace(/, ([^,]*)$/, ' e $1')));
    if (j.maxDevices) set('.max', (el) => (el.textContent = j.maxDevices));
    if (j.referralPercent) set('.ref-pct', (el) => (el.textContent = j.referralPercent + '%'));
    set('.contact', (el) => {
      el.textContent = '';
      const parts = [];
      if (j.contactEmail) {
        const a = document.createElement('a');
        a.href = 'mailto:' + j.contactEmail;
        a.textContent = j.contactEmail;
        parts.push(a);
      }
      if (j.support) {
        const a = document.createElement('a');
        a.href = 'https://wa.me/' + String(j.support).replace(/\D/g, '');
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'WhatsApp ' + String(j.support).replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
        parts.push(a);
      }
      parts.forEach((p, i) => {
        if (i) el.append(' ou ');
        el.append(p);
      });
    });
  });
