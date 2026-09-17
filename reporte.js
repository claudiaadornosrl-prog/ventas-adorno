// ═══════════════════════════════════════════════════════════════════════
//  Ventas Adorno · reporte.js — Reporte semanal/mensual (overlay, SOLO admin)
//  Lee ventas_reportes (pre-cocinado en PC de JP por generar_reporte_ventas.py).
//  Comparativos: período anterior + mismo período año anterior (semana: -364d).
//  🚨 Regla viva: si cambia el generador o este render, actualizar manual.js.
// ═══════════════════════════════════════════════════════════════════════

function _rEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const _rFmt = v => '$' + Math.round(v || 0).toLocaleString('es-AR');
const _rFmtK = v => {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return '$' + (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M';
  if (a >= 1e3) return '$' + Math.round(v / 1e3).toLocaleString('es-AR') + 'K';
  return '$' + Math.round(v || 0);
};
function _rDelta(act, prev) {
  if (!prev || !act) return '<span class="r-flat">—</span>';
  const d = (act / prev - 1) * 100;
  const cls = d >= 0 ? 'r-up' : 'r-down';
  return `<span class="${cls}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%</span>`;
}

let _repPeriodos = { semanal: [], mensual: [] };
let _repSel = { tipo: 'semanal', periodo: null, local: 'consolidado' };
let _repCache = {};

async function _repFetch(tipo, periodo, local) {
  const k = `${tipo}|${periodo}|${local}`;
  if (_repCache[k] !== undefined) return _repCache[k];
  const { data } = await sb.from('ventas_reportes').select('payload')
    .eq('tipo', tipo).eq('periodo', periodo).eq('local', local).maybeSingle();
  _repCache[k] = data ? data.payload : null;
  return _repCache[k];
}

function _repPeriodoAnterior(tipo, periodo) {
  const d = new Date(periodo + 'T12:00:00');
  if (tipo === 'semanal') { d.setDate(d.getDate() - 7); }
  else { d.setMonth(d.getMonth() - 1); }
  return d.toISOString().slice(0, 10);
}
function _repPeriodoAA(tipo, periodo) {
  const d = new Date(periodo + 'T12:00:00');
  if (tipo === 'semanal') { d.setDate(d.getDate() - 364); }  // mismo día de semana
  else { d.setFullYear(d.getFullYear() - 1); }
  return d.toISOString().slice(0, 10);
}

function _repEtiqueta(tipo, periodo) {
  const d = new Date(periodo + 'T12:00:00');
  const M = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  if (tipo === 'mensual') return `${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][d.getMonth()]} ${d.getFullYear()}`;
  const h = new Date(d); h.setDate(h.getDate() + 6);
  return `${d.getDate()} ${M[d.getMonth()]} – ${h.getDate()} ${M[h.getMonth()]} ${h.getFullYear()}`;
}

async function abrirReporteVentas() {
  if (document.getElementById('reporte-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'reporte-overlay';
  ov.innerHTML = `
    <div class="r-box">
      <div class="r-head">
        <span style="font-size:20px;">📊</span>
        <div style="font-weight:700;">Reporte de ventas</div>
        <select id="r-tipo"><option value="semanal">Semanal</option><option value="mensual">Mensual</option></select>
        <select id="r-periodo"></select>
        <select id="r-local">
          <option value="consolidado">Consolidado</option><option value="alcorta">Alcorta</option>
          <option value="unicenter">Unicenter</option><option value="oficina">Oficina</option>
          <option value="el_solar">El Solar (hist.)</option>
        </select>
        <span style="flex:1"></span>
        <button class="r-close" onclick="cerrarReporteVentas()">✕</button>
      </div>
      <div id="r-body"><div class="r-loading">Cargando…</div></div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) cerrarReporteVentas(); });
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';

  if (!_repPeriodos.semanal.length) {
    const { data } = await sb.from('ventas_reportes').select('tipo, periodo')
      .eq('local', 'consolidado').order('periodo', { ascending: false }).limit(2000);
    for (const r of (data || [])) {
      if (!_repPeriodos[r.tipo].includes(r.periodo)) _repPeriodos[r.tipo].push(r.periodo);
    }
  }
  document.getElementById('r-tipo').onchange = () => { _repSel.tipo = document.getElementById('r-tipo').value; _repLlenarPeriodos(); };
  document.getElementById('r-periodo').onchange = () => { _repSel.periodo = document.getElementById('r-periodo').value; _repRender(); };
  document.getElementById('r-local').onchange = () => { _repSel.local = document.getElementById('r-local').value; _repRender(); };
  _repLlenarPeriodos();
}

function _repLlenarPeriodos() {
  const sel = document.getElementById('r-periodo');
  const lista = _repPeriodos[_repSel.tipo] || [];
  sel.innerHTML = lista.map(p => `<option value="${p}">${_repEtiqueta(_repSel.tipo, p)}</option>`).join('');
  _repSel.periodo = lista[0] || null;
  _repRender();
}

function cerrarReporteVentas() {
  const ov = document.getElementById('reporte-overlay');
  if (ov) ov.remove();
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarReporteVentas(); });

// UPT = unidades por ticket. El dato ya venía en el payload (unidades + tickets);
// solo faltaba la división. Es el KPI del análisis semanal que no se veía.
function _upt(k) {
  if (!k || !k.tickets) return 0;
  return Math.round((k.unidades || 0) / k.tickets * 100) / 100;
}

// Día más fuerte y más flojo del período — lo pide el análisis semanal y sale
// de por_dia, que ya está en el payload.
function _diaFuerteDebil(porDia) {
  const dias = (porDia || []).filter(d => (d.monto || 0) > 0);
  if (dias.length < 2) return '';
  const orden = [...dias].sort((a, b) => b.monto - a.monto);
  const f = orden[0], d = orden[orden.length - 1];
  const nombre = (iso) => {
    const [y, m, dd] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    return dt.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };
  return `<span class="r-muted" style="font-weight:400;"> · 🔝 ${nombre(f.fecha)} ${_rFmtK(f.monto)}`
       + ` · 🔻 ${nombre(d.fecha)} ${_rFmtK(d.monto)}</span>`;
}

// El análisis del lunes viene en texto con estructura (títulos con ##, viñetas
// con -). Se renderiza como tal en vez de un párrafo plano: el diagnóstico y las
// acciones son lo que se lee primero, no un bloque de texto corrido.
// Si alguien escribe texto pelado, igual se ve — solo queda sin subtítulos.
function _repNarrativa(txt) {
  if (!txt || !String(txt).trim()) return '';
  const lineas = String(txt).replace(/\r/g, '').split('\n');
  const negrita = (t) => _rEsc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  let html = '', enLista = false;
  const cerrarLista = () => { if (enLista) { html += '</ul>'; enLista = false; } };
  for (const ln of lineas) {
    const t = ln.trim();
    if (!t) { cerrarLista(); continue; }
    const tit = t.match(/^#{1,6}\s+(.*)$/);
    const item = t.match(/^[-*•]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
    if (tit) { cerrarLista(); html += `<div class="r-reco-h">${negrita(tit[1])}</div>`; }
    else if (item) {
      if (!enLista) { html += '<ul class="r-reco-ul">'; enLista = true; }
      html += `<li>${negrita(item[1])}</li>`;
    } else { cerrarLista(); html += `<p class="r-reco-p">${negrita(t)}</p>`; }
  }
  cerrarLista();
  return `<div class="r-reco"><div class="r-reco-t">💬 Análisis de la semana</div>${html}</div>`;
}

async function _repRender() {
  const body = document.getElementById('r-body');
  if (!body || !_repSel.periodo) { if (body) body.innerHTML = '<div class="r-loading">Sin reportes generados todavía.</div>'; return; }
  body.innerHTML = '<div class="r-loading">Cargando…</div>';
  const { tipo, periodo, local } = _repSel;
  const [act, ant, aa] = await Promise.all([
    _repFetch(tipo, periodo, local),
    _repFetch(tipo, _repPeriodoAnterior(tipo, periodo), local),
    _repFetch(tipo, _repPeriodoAA(tipo, periodo), local),
  ]);
  if (!act) { body.innerHTML = '<div class="r-loading">No hay reporte para ese período/local.</div>'; return; }
  const k = act.kpis, ka = ant?.kpis, ky = aa?.kpis;

  const kpi = (lbl, val, vAnt, vAA, esMonto = true) => `
    <div class="r-kpi"><div class="r-kpi-l">${lbl}</div>
      <div class="r-kpi-v">${esMonto ? _rFmtK(val) : (val ?? 0).toLocaleString('es-AR')}</div>
      <div class="r-kpi-d">${_rDelta(val, vAnt)} ant · ${_rDelta(val, vAA)} A/A</div></div>`;

  // ── categorías: árbol g → s → c ──
  const arbol = {};
  for (const c of (act.categorias || [])) {
    const g = arbol[c.g] = arbol[c.g] || { monto: 0, cant: 0, subs: {} };
    g.monto += c.monto; g.cant += c.cant;
    const s = g.subs[c.s] = g.subs[c.s] || { monto: 0, cant: 0, clas: [] };
    s.monto += c.monto; s.cant += c.cant;
    s.clas.push(c);
  }
  const aaGrupos = {};
  for (const c of (aa?.categorias || [])) aaGrupos[c.g] = (aaGrupos[c.g] || 0) + c.monto;
  const totalCat = Object.values(arbol).reduce((a, g) => a + g.monto, 0) || 1;
  let gi = 0;
  const filasCat = Object.entries(arbol).sort((a, b) => b[1].monto - a[1].monto).map(([gn, g]) => {
    const gid = 'rg' + (gi++);
    const subs = Object.entries(g.subs).sort((a, b) => b[1].monto - a[1].monto).map(([sn, s], si) => {
      const sid = gid + 's' + si;
      const cls = s.clas.sort((a, b) => b.monto - a.monto).map(c => `
        <tr class="r-n3 ${sid}" style="display:none;"><td></td><td>${_rEsc(c.c)}</td>
          <td class="r-num">${_rFmtK(c.monto)}</td><td class="r-num">${c.cant.toLocaleString('es-AR')}</td><td class="r-num r-muted">${(c.monto / totalCat * 100).toFixed(1)}%</td><td></td></tr>`).join('');
      return `
        <tr class="r-n2 ${gid}" style="display:none;cursor:pointer;" onclick="_repToggle('${sid}', this)"><td class="r-tog">▸</td><td>${_rEsc(sn)}</td>
          <td class="r-num">${_rFmtK(s.monto)}</td><td class="r-num">${s.cant.toLocaleString('es-AR')}</td><td class="r-num r-muted">${(s.monto / totalCat * 100).toFixed(1)}%</td><td></td></tr>${cls}`;
    }).join('');
    return `
      <tr class="r-n1" style="cursor:pointer;" onclick="_repToggle('${gid}', this)"><td class="r-tog">▸</td><td><b>${_rEsc(gn)}</b></td>
        <td class="r-num"><b>${_rFmtK(g.monto)}</b></td><td class="r-num">${g.cant.toLocaleString('es-AR')}</td>
        <td class="r-num r-muted">${(g.monto / totalCat * 100).toFixed(1)}%</td><td class="r-num">${_rDelta(g.monto, aaGrupos[gn])}</td></tr>${subs}`;
  }).join('');

  // ── venta por día (barras css) ──
  const dias = act.por_dia || [];
  const maxDia = Math.max(1, ...dias.map(d => d.monto));
  const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const barras = dias.map(d => {
    const dd = new Date(d.fecha + 'T12:00:00');
    const lbl = tipo === 'semanal' ? DIAS_ES[dd.getDay()] : dd.getDate();
    return `<div class="r-bar-w" title="${d.fecha} · ${_rFmt(d.monto)} · ${d.tickets} tickets">
      <div class="r-bar" style="height:${Math.round(d.monto / maxDia * 100)}%"></div><div class="r-bar-l">${lbl}</div></div>`;
  }).join('');

  // ── heatmap día×hora ──
  const hm = {}; let hmMax = 1;
  for (const h of (act.heatmap || [])) { hm[`${h.d}-${h.h}`] = h.m; hmMax = Math.max(hmMax, h.m); }
  const DIAS_L = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const horas = []; for (let h = 9; h <= 22; h++) horas.push(h);
  const heat = `<div class="r-heat" style="grid-template-columns:38px repeat(${horas.length},1fr);">
    <div></div>${horas.map(h => `<div class="r-heat-lb">${h}</div>`).join('')}
    ${DIAS_L.map((dn, di) => `<div class="r-heat-lb">${dn}</div>` + horas.map(h => {
      const v = hm[`${di}-${h}`] || 0;
      return `<div class="r-heat-c" title="${dn} ${h}hs · ${_rFmt(v)}" style="background:rgba(22,163,74,${v ? (0.12 + v / hmMax * 0.82).toFixed(2) : 0.04});"></div>`;
    }).join('')).join('')}</div>`;

  // ── medios de pago (agrupar JJCO) ──
  const MP_LBL = [[/^0/, 'Efectivo'], [/^TJ/, 'Tarjeta'], [/^(QR|MP)/, 'Mercado Pago'], [/^VC/, 'Vales'], [/^TRANS/, 'Transferencia'], [/^C$/, 'Cta. Cte.']];
  const mp = {};
  for (const m of (act.medios_pago || [])) {
    const lbl = (MP_LBL.find(([re]) => re.test(m.co)) || [null, m.co || 'Otros'])[1];
    mp[lbl] = (mp[lbl] || 0) + m.monto;
  }
  const mpTot = Object.values(mp).reduce((a, b) => a + b, 0) || 1;
  const mpHtml = Object.entries(mp).sort((a, b) => b[1] - a[1]).map(([l, m]) => `
    <div class="r-mp-row"><span>${_rEsc(l)}</span><span class="r-num">${_rFmtK(m)} · ${(m / mpTot * 100).toFixed(1)}%</span></div>
    <div class="r-mp-bar"><div style="width:${(m / mpTot * 100).toFixed(1)}%"></div></div>`).join('');

  const lista = (items, fm) => (items || []).map(fm).join('') || '<div class="r-muted" style="padding:8px;">Sin datos</div>';

  body.innerHTML = `
    ${_repNarrativa(act.recomendacion)}
    <div class="r-kpis">
      ${kpi('Venta', k.venta, ka?.venta, ky?.venta)}
      ${kpi('Tickets', k.tickets, ka?.tickets, ky?.tickets, false)}
      ${kpi('Ticket promedio', k.ticket_prom, ka?.ticket_prom, ky?.ticket_prom)}
      ${kpi('Unidades', k.unidades, ka?.unidades, ky?.unidades, false)}
      ${kpi('UPT (unid./ticket)', _upt(k), _upt(ka), _upt(ky), false)}
      ${kpi('Venta prom./día', k.venta_prom_dia, ka?.venta_prom_dia, ky?.venta_prom_dia)}
      ${kpi('SKUs vendidos', k.skus, ka?.skus, ky?.skus, false)}
      ${kpi('Ticket máximo', k.ticket_max, ka?.ticket_max, ky?.ticket_max)}
      <div class="r-kpi"><div class="r-kpi-l">Venta blue</div><div class="r-kpi-v">${k.blue_pct}%</div>
        <div class="r-kpi-d r-muted">${ka ? 'ant: ' + ka.blue_pct + '%' : ''} ${ky ? '· A/A: ' + ky.blue_pct + '%' : ''}</div></div>
    </div>
    <div class="r-card"><div class="r-ct">Venta por día ${_diaFuerteDebil(act.por_dia)}</div><div class="r-bars">${barras}</div></div>
    <div class="r-card"><div class="r-ct">Categorías <span class="r-muted">(tocá para expandir · Δ vs mismo período año anterior)</span></div>
      <table class="r-tbl"><thead><tr><th></th><th>Categoría</th><th class="r-num">Monto</th><th class="r-num">Unid.</th><th class="r-num">%</th><th class="r-num">A/A</th></tr></thead>
      <tbody>${filasCat}</tbody></table></div>
    <div class="r-2col">
      <div class="r-card"><div class="r-ct">Top artículos por monto</div>
        ${lista(act.top_articulos_monto?.slice(0, 12), a => `<div class="r-mp-row"><span title="${_rEsc(a.sku)}">${_rEsc(a.descr || a.sku)}</span><span class="r-num">${_rFmtK(a.monto)}</span></div>`)}</div>
      <div class="r-card"><div class="r-ct">Top artículos por cantidad</div>
        ${lista(act.top_articulos_cant?.slice(0, 12), a => `<div class="r-mp-row"><span title="${_rEsc(a.sku)}">${_rEsc(a.descr || a.sku)}</span><span class="r-num">${(a.cant || 0).toLocaleString('es-AR')} u.</span></div>`)}</div>
    </div>
    <div class="r-2col">
      <div class="r-card"><div class="r-ct">Top proveedores</div>
        ${lista(act.proveedores, p => `<div class="r-mp-row"><span>${_rEsc(p.nombre)}</span><span class="r-num">${_rFmtK(p.monto)}</span></div>`)}</div>
      <div class="r-card"><div class="r-ct">Top clientes</div>
        ${lista(act.clientes, c => `<div class="r-mp-row"><span>${_rEsc(c.nombre)}</span><span class="r-num">${_rFmtK(c.monto)}</span></div>`)}</div>
    </div>
    <div class="r-2col">
      <div class="r-card"><div class="r-ct">Mapa de calor · día × hora</div>${heat}</div>
      <div class="r-card"><div class="r-ct">Medios de pago</div>${mpHtml}</div>
    </div>
    <div class="r-muted" style="text-align:center;padding:8px 0 14px;">
      Período: ${act.periodo?.desde || ''} → ${act.periodo?.hasta || ''} · generado por el reporte nocturno de la PC de JP</div>`;
}

function _repToggle(cls, row) {
  const filas = document.querySelectorAll('.' + cls);
  const abrir = filas.length && filas[0].style.display === 'none';
  filas.forEach(f => {
    f.style.display = abrir ? '' : 'none';
    if (!abrir) {  // al cerrar un nivel, cerrar también los hijos
      const tog = f.querySelector('.r-tog');
      if (tog && tog.textContent === '▾') tog.click();
    }
  });
  const t = row.querySelector('.r-tog');
  if (t) t.textContent = abrir ? '▾' : '▸';
}

(function _repInit() {
  const css = document.createElement('style');
  css.textContent = `
    #reporte-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9998;display:flex;align-items:flex-start;justify-content:center;padding:14px 8px;overflow-y:auto;-webkit-overflow-scrolling:touch;}
    #reporte-overlay .r-box{background:#f8fafc;border-radius:14px;max-width:900px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);padding-bottom:4px;}
    #reporte-overlay .r-head{position:sticky;top:0;background:#16a34a;color:#fff;padding:10px 14px;border-radius:14px 14px 0 0;display:flex;align-items:center;gap:8px;z-index:2;flex-wrap:wrap;}
    #reporte-overlay .r-head select{border:none;border-radius:7px;padding:6px 8px;font-size:13px;}
    #reporte-overlay .r-close{background:rgba(255,255,255,.18);border:none;color:#fff;font-size:15px;border-radius:8px;padding:5px 10px;cursor:pointer;}
    #reporte-overlay .r-loading{padding:50px;text-align:center;color:#64748b;}
    #reporte-overlay .r-reco{margin:12px 12px 0;background:#ecfdf5;border-left:4px solid #16a34a;border-radius:10px;padding:12px 16px;font-size:13.5px;line-height:1.6;color:#064e3b;}
    #reporte-overlay .r-reco-t{font-weight:700;margin-bottom:4px;}
    #reporte-overlay .r-reco-h{font-weight:800;font-size:13px;margin:10px 0 4px;}
    #reporte-overlay .r-reco-h:first-child{margin-top:0;}
    #reporte-overlay .r-reco-p{margin:0 0 6px;line-height:1.45;}
    #reporte-overlay .r-reco-ul{margin:0 0 8px;padding-left:18px;line-height:1.45;}
    #reporte-overlay .r-reco-ul li{margin-bottom:3px;}
    #reporte-overlay .r-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px;}
    @media (max-width:640px){#reporte-overlay .r-kpis{grid-template-columns:repeat(2,1fr);}}
    #reporte-overlay .r-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;}
    #reporte-overlay .r-kpi-l{font-size:11px;color:#64748b;}
    #reporte-overlay .r-kpi-v{font-size:19px;font-weight:700;margin:2px 0;}
    #reporte-overlay .r-kpi-d{font-size:11px;}
    #reporte-overlay .r-up{color:#16a34a;font-weight:600;} #reporte-overlay .r-down{color:#dc2626;font-weight:600;} #reporte-overlay .r-flat{color:#94a3b8;}
    #reporte-overlay .r-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin:0 12px 12px;padding:12px 14px;overflow-x:auto;}
    #reporte-overlay .r-ct{font-size:13px;font-weight:700;color:#334155;margin-bottom:8px;}
    #reporte-overlay .r-2col{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 12px 0;}
    @media (max-width:700px){#reporte-overlay .r-2col{grid-template-columns:1fr;margin:0 12px;}}
    #reporte-overlay .r-2col .r-card{margin:0 0 12px;}
    #reporte-overlay .r-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}
    #reporte-overlay .r-tbl th{text-align:left;color:#64748b;font-weight:600;padding:4px 6px;border-bottom:1px solid #e2e8f0;}
    #reporte-overlay .r-tbl td{padding:5px 6px;border-bottom:1px solid #f1f5f9;}
    #reporte-overlay .r-n2 td:nth-child(2){padding-left:20px;} #reporte-overlay .r-n3 td:nth-child(2){padding-left:40px;color:#64748b;}
    #reporte-overlay .r-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
    #reporte-overlay .r-muted{color:#94a3b8;font-weight:400;font-size:11.5px;}
    #reporte-overlay .r-tog{width:16px;color:#94a3b8;}
    #reporte-overlay .r-bars{display:flex;align-items:flex-end;gap:3px;height:110px;}
    #reporte-overlay .r-bar-w{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;}
    #reporte-overlay .r-bar{width:100%;background:#16a34a;border-radius:3px 3px 0 0;min-height:2px;}
    #reporte-overlay .r-bar-l{font-size:9px;color:#94a3b8;margin-top:2px;}
    #reporte-overlay .r-heat{display:grid;gap:2px;font-size:10px;}
    #reporte-overlay .r-heat-lb{color:#94a3b8;font-size:9.5px;display:flex;align-items:center;justify-content:center;}
    #reporte-overlay .r-heat-c{height:16px;border-radius:2px;}
    #reporte-overlay .r-mp-row{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;gap:8px;}
    #reporte-overlay .r-mp-row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #reporte-overlay .r-mp-bar{background:#f1f5f9;border-radius:4px;height:6px;margin-bottom:6px;}
    #reporte-overlay .r-mp-bar div{background:#16a34a;height:6px;border-radius:4px;}`;
  document.head.appendChild(css);

  // botón en el kebab, solo admin (esperar a que session esté lista)
  let intentos = 0;
  const timer = setInterval(() => {
    intentos++;
    if (typeof session !== 'undefined' && session?.isAdmin) {
      clearInterval(timer);
      const kebab = document.getElementById('kebab-menu');
      if (kebab && !document.getElementById('btn-reporte-ventas')) {
        const b = document.createElement('button');
        b.id = 'btn-reporte-ventas';
        b.textContent = '📊 Reporte semanal/mensual';
        b.onclick = () => { if (typeof cerrarKebab === 'function') cerrarKebab(); abrirReporteVentas(); };
        kebab.insertBefore(b, kebab.firstChild);
      }
    } else if (intentos > 40) clearInterval(timer);
  }, 500);
})();
