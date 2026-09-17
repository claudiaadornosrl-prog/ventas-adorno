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

const REP_TIPOS = ['semanal', 'mensual', 'trimestral', 'anual'];
let _repPeriodos = { semanal: [], mensual: [], trimestral: [], anual: [] };
let _repSel = { tipo: 'semanal', periodo: null, local: 'consolidado', real: false };
let _repCache = {};

// ── IPC ────────────────────────────────────────────────────────────────────
// Coeficiente por mes para llevar pesos viejos a pesos de hoy. Se pide una vez
// por sesión. 🚨 Los meses que el INDEC todavía no publicó vienen con coef 1 y
// sin_ipc=true: no se estima nada, se avisa.
let _repIpc = null;      // { '2026-07': {coef, sin} }
let _repIpcBase = null;  // último mes con IPC publicado

async function _repCargarIpc() {
  if (_repIpc) return _repIpc;
  _repIpc = {};
  const { data, error } = await sb.rpc('ventas_ipc_coef');
  if (error) { console.warn('IPC no disponible:', error.message); return _repIpc; }
  for (const r of (data || [])) {
    const k = String(r.mes).slice(0, 7);
    _repIpc[k] = { coef: Number(r.coef) || 1, sin: !!r.sin_ipc };
    if (!r.sin_ipc) _repIpcBase = k;
  }
  return _repIpc;
}

// Coeficiente EFECTIVO de un período: se pondera por cuánto se vendió cada mes,
// no se toma el del primer día. En un trimestre o un año la venta no está
// repartida pareja y usar un solo mes desplazaría el número.
function _repCoef(payload) {
  if (!_repIpc) return { coef: 1, sin: false };
  const dias = payload?.por_dia || [];
  let num = 0, den = 0, sin = false;
  for (const d of dias) {
    const m = _repIpc[String(d.fecha).slice(0, 7)];
    const c = m ? m.coef : 1;
    if (!m || m.sin) sin = true;
    num += (d.monto || 0) * c; den += (d.monto || 0);
  }
  if (!den) {
    const m = _repIpc[String(payload?.periodo?.desde || '').slice(0, 7)];
    return { coef: m ? m.coef : 1, sin: !m || m.sin };
  }
  return { coef: num / den, sin };
}

async function _repFetch(tipo, periodo, local) {
  const k = `${tipo}|${periodo}|${local}`;
  if (_repCache[k] !== undefined) return _repCache[k];
  const { data } = await sb.from('ventas_reportes').select('payload')
    .eq('tipo', tipo).eq('periodo', periodo).eq('local', local).maybeSingle();
  _repCache[k] = data ? data.payload : null;
  return _repCache[k];
}

const _REP_SALTO = { semanal: 0, mensual: 1, trimestral: 3, anual: 12 };  // meses

function _repPeriodoAnterior(tipo, periodo) {
  const d = new Date(periodo + 'T12:00:00');
  if (tipo === 'semanal') d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - _REP_SALTO[tipo]);
  return d.toISOString().slice(0, 10);
}
function _repPeriodoAA(tipo, periodo) {
  // En el ANUAL el período anterior YA es el año anterior: no hay un segundo
  // comparativo que agregue algo, así que devuelve null y la fila no se dibuja.
  if (tipo === 'anual') return null;
  const d = new Date(periodo + 'T12:00:00');
  if (tipo === 'semanal') d.setDate(d.getDate() - 364);  // mismo día de semana
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

const _MES_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const _MES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
                'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function _repEtiqueta(tipo, periodo) {
  const d = new Date(periodo + 'T12:00:00');
  if (tipo === 'anual') return String(d.getFullYear());
  if (tipo === 'trimestral') return `${Math.floor(d.getMonth() / 3) + 1}° trim. ${d.getFullYear()}`;
  if (tipo === 'mensual') return `${_MES_L[d.getMonth()]} ${d.getFullYear()}`;
  const h = new Date(d); h.setDate(h.getDate() + 6);
  return `${d.getDate()} ${_MES_C[d.getMonth()]} – ${h.getDate()} ${_MES_C[h.getMonth()]} ${h.getFullYear()}`;
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
        <select id="r-tipo">
          <option value="semanal">Semanal</option><option value="mensual">Mensual</option>
          <option value="trimestral">Trimestral</option><option value="anual">Anual</option>
          <option value="interanual">Últimos 5 años</option>
        </select>
        <select id="r-periodo"></select>
        <select id="r-local">
          <option value="consolidado">Consolidado</option><option value="alcorta">Alcorta</option>
          <option value="unicenter">Unicenter</option><option value="oficina">Oficina</option>
          <option value="el_solar">El Solar (hist.)</option>
        </select>
        <span style="flex:1"></span>
        <button id="r-real" class="r-toggle" title="Reexpresar los pesos de cada período a pesos de hoy usando el IPC">$ nominal</button>
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
  document.getElementById('r-tipo').onchange = () => {
    _repSel.tipo = document.getElementById('r-tipo').value;
    _repLlenarPeriodos();
  };
  document.getElementById('r-periodo').onchange = () => { _repSel.periodo = document.getElementById('r-periodo').value; _repRender(); };
  document.getElementById('r-local').onchange = () => { _repSel.local = document.getElementById('r-local').value; _repRender(); };
  document.getElementById('r-real').onclick = () => { _repSel.real = !_repSel.real; _repRender(); };
  _repLlenarPeriodos();
}

function _repLlenarPeriodos() {
  const sel = document.getElementById('r-periodo');
  const loc = document.getElementById('r-local');
  // El interanual no elige período ni local: es la serie completa, consolidada.
  const esIA = _repSel.tipo === 'interanual';
  sel.style.display = esIA ? 'none' : '';
  loc.style.display = esIA ? 'none' : '';
  if (esIA) { _repRender(); return; }
  const lista = _repPeriodos[_repSel.tipo] || [];
  sel.innerHTML = lista.map(p => `<option value="${p}">${_repEtiqueta(_repSel.tipo, p)}</option>`).join('');
  _repSel.periodo = lista[0] || null;
  _repRender();
}

// El botón del interruptor refleja en qué moneda se está mirando.
function _repPintarToggle(sinIpc) {
  const b = document.getElementById('r-real');
  if (!b) return;
  b.textContent = _repSel.real ? `$ de ${_repIpcBase ? _repFmtMesCorto(_repIpcBase) : 'hoy'}` : '$ nominal';
  b.classList.toggle('on', _repSel.real);
  b.title = _repSel.real
    ? 'Mostrando todo reexpresado a pesos del último IPC publicado. Tocá para volver a los pesos de cada momento.'
    : 'Mostrando los pesos tal cual se facturaron. Tocá para llevarlos a pesos de hoy y poder comparar.';
  if (_repSel.real && sinIpc) b.title += ' ⚠ Hay meses sin IPC publicado: esos van sin ajustar.';
}
function _repFmtMesCorto(k) {
  const [y, m] = k.split('-').map(Number);
  return `${_MES_C[m - 1]}-${String(y).slice(2)}`;
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
function _diaFuerteDebil(porDia, factor = 1) {
  const dias = (porDia || []).filter(d => (d.monto || 0) > 0);
  if (dias.length < 2) return '';
  const orden = [...dias].sort((a, b) => b.monto - a.monto);
  const f = orden[0], d = orden[orden.length - 1];
  const nombre = (iso) => {
    const [y, m, dd] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    return dt.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };
  return `<span class="r-muted" style="font-weight:400;"> · 🔝 ${nombre(f.fecha)} ${_rFmtK(f.monto * factor)}`
       + ` · 🔻 ${nombre(d.fecha)} ${_rFmtK(d.monto * factor)}</span>`;
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
  if (!body) return;
  if (_repSel.tipo === 'interanual') return _repRenderInteranual();
  if (!_repSel.periodo) { body.innerHTML = '<div class="r-loading">Sin reportes generados todavía.</div>'; return; }
  body.innerHTML = '<div class="r-loading">Cargando…</div>';
  const { tipo, periodo, local } = _repSel;
  const pAA = _repPeriodoAA(tipo, periodo);
  const [act, ant, aa] = await Promise.all([
    _repFetch(tipo, periodo, local),
    _repFetch(tipo, _repPeriodoAnterior(tipo, periodo), local),
    pAA ? _repFetch(tipo, pAA, local) : Promise.resolve(null),
    _repCargarIpc(),
  ]);
  if (!act) { body.innerHTML = '<div class="r-loading">No hay reporte para ese período/local.</div>'; return; }
  const k = act.kpis, ka = ant?.kpis, ky = aa?.kpis;

  // Reexpresión: cada período con SU coeficiente, para que el delta compare
  // poder de compra y no inflación.
  const aj = _repSel.real;
  const cA = _repCoef(act), cB = ant ? _repCoef(ant) : { coef: 1 }, cY = aa ? _repCoef(aa) : { coef: 1 };
  _repPintarToggle(cA.sin || cB.sin || cY.sin);
  const $A = v => aj ? (v || 0) * cA.coef : (v || 0);
  const $B = v => aj ? (v || 0) * cB.coef : (v || 0);
  const $Y = v => aj ? (v || 0) * cY.coef : (v || 0);

  const kpi = (lbl, val, vAnt, vAA, esMonto = true) => {
    const a_ = esMonto ? $A(val) : (val ?? 0);
    const b_ = esMonto ? $B(vAnt) : vAnt;
    const y_ = esMonto ? $Y(vAA) : vAA;
    return `
    <div class="r-kpi"><div class="r-kpi-l">${lbl}</div>
      <div class="r-kpi-v">${esMonto ? _rFmtK(a_) : (a_ ?? 0).toLocaleString('es-AR')}</div>
      <div class="r-kpi-d">${_rDelta(a_, b_)} ant${pAA ? ` · ${_rDelta(a_, y_)} A/A` : ''}</div></div>`;
  };

  // ── categorías: árbol g → s → c ──
  const arbol = {};
  for (const c of (act.categorias || [])) {
    const g = arbol[c.g] = arbol[c.g] || { monto: 0, cant: 0, subs: {} };
    g.monto += c.monto; g.cant += c.cant;
    const s = g.subs[c.s] = g.subs[c.s] || { monto: 0, cant: 0, clas: [] };
    s.monto += c.monto; s.cant += c.cant;
    s.clas.push(c);
  }
  // Contra qué se compara la columna de categorías: normalmente el mismo período
  // del año pasado, pero en el ANUAL ese comparativo ES el período anterior, así
  // que se usa ese y la columna se renombra — antes quedaba una columna de "—".
  const cmpCat = aa || ant, $C = aa ? $Y : $B;
  const cmpCatLbl = aa ? 'A/A' : (ant ? `vs ${_repEtiqueta(tipo, _repPeriodoAnterior(tipo, periodo))}` : '—');
  const aaGrupos = {};
  for (const c of (cmpCat?.categorias || [])) aaGrupos[c.g] = (aaGrupos[c.g] || 0) + c.monto;
  const totalCat = Object.values(arbol).reduce((a, g) => a + g.monto, 0) || 1;
  let gi = 0;
  const filasCat = Object.entries(arbol).sort((a, b) => b[1].monto - a[1].monto).map(([gn, g]) => {
    const gid = 'rg' + (gi++);
    const subs = Object.entries(g.subs).sort((a, b) => b[1].monto - a[1].monto).map(([sn, s], si) => {
      const sid = gid + 's' + si;
      const cls = s.clas.sort((a, b) => b.monto - a.monto).map(c => `
        <tr class="r-n3 ${sid}" style="display:none;"><td></td><td>${_rEsc(c.c)}</td>
          <td class="r-num">${_rFmtK($A(c.monto))}</td><td class="r-num">${c.cant.toLocaleString('es-AR')}</td><td class="r-num r-muted">${(c.monto / totalCat * 100).toFixed(1)}%</td><td></td></tr>`).join('');
      return `
        <tr class="r-n2 ${gid}" style="display:none;cursor:pointer;" onclick="_repToggle('${sid}', this)"><td class="r-tog">▸</td><td>${_rEsc(sn)}</td>
          <td class="r-num">${_rFmtK($A(s.monto))}</td><td class="r-num">${s.cant.toLocaleString('es-AR')}</td><td class="r-num r-muted">${(s.monto / totalCat * 100).toFixed(1)}%</td><td></td></tr>${cls}`;
    }).join('');
    return `
      <tr class="r-n1" style="cursor:pointer;" onclick="_repToggle('${gid}', this)"><td class="r-tog">▸</td><td><b>${_rEsc(gn)}</b></td>
        <td class="r-num"><b>${_rFmtK($A(g.monto))}</b></td><td class="r-num">${g.cant.toLocaleString('es-AR')}</td>
        <td class="r-num r-muted">${(g.monto / totalCat * 100).toFixed(1)}%</td><td class="r-num">${_rDelta($A(g.monto), $C(aaGrupos[gn]))}</td></tr>${subs}`;
  }).join('');

  // ── venta por día, o por mes cuando el período es largo ──
  // Un año son 365 barras de 1px: ilegible. Desde ~2 meses se agrupa por mes.
  const diasRaw = act.por_dia || [];
  const porMes = diasRaw.length > 62;
  const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  let puntos;
  if (porMes) {
    const acc = new Map();
    for (const d of diasRaw) {
      const key = String(d.fecha).slice(0, 7);
      const e = acc.get(key) || { monto: 0, tickets: 0 };
      e.monto += d.monto || 0; e.tickets += d.tickets || 0;
      acc.set(key, e);
    }
    puntos = [...acc.entries()].sort().map(([key, e]) => ({
      lbl: _MES_C[Number(key.slice(5, 7)) - 1],
      tip: `${_MES_L[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
      monto: e.monto, tickets: e.tickets,
    }));
  } else {
    puntos = diasRaw.map(d => {
      const dd = new Date(d.fecha + 'T12:00:00');
      return { lbl: tipo === 'semanal' ? DIAS_ES[dd.getDay()] : dd.getDate(),
               tip: d.fecha, monto: d.monto, tickets: d.tickets };
    });
  }
  const maxDia = Math.max(1, ...puntos.map(d => d.monto));
  const barras = puntos.map(d =>
    `<div class="r-bar-w" title="${_rEsc(d.tip)} · ${_rFmt($A(d.monto))} · ${d.tickets} tickets">
      <div class="r-bar" style="height:${Math.round(d.monto / maxDia * 100)}%"></div><div class="r-bar-l">${d.lbl}</div></div>`
  ).join('');

  // ── heatmap día×hora ──
  const hm = {}; let hmMax = 1;
  for (const h of (act.heatmap || [])) { hm[`${h.d}-${h.h}`] = h.m; hmMax = Math.max(hmMax, h.m); }
  const DIAS_L = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const horas = []; for (let h = 9; h <= 22; h++) horas.push(h);
  const heat = `<div class="r-heat" style="grid-template-columns:38px repeat(${horas.length},1fr);">
    <div></div>${horas.map(h => `<div class="r-heat-lb">${h}</div>`).join('')}
    ${DIAS_L.map((dn, di) => `<div class="r-heat-lb">${dn}</div>` + horas.map(h => {
      const v = hm[`${di}-${h}`] || 0;
      return `<div class="r-heat-c" title="${dn} ${h}hs · ${_rFmt($A(v))}" style="background:rgba(22,163,74,${v ? (0.12 + v / hmMax * 0.82).toFixed(2) : 0.04});"></div>`;
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
    <div class="r-mp-row"><span>${_rEsc(l)}</span><span class="r-num">${_rFmtK($A(m))} · ${(m / mpTot * 100).toFixed(1)}%</span></div>
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
    <div class="r-card"><div class="r-ct">Venta por ${porMes ? 'mes' : 'día'} ${_diaFuerteDebil(act.por_dia, aj ? cA.coef : 1)}</div><div class="r-bars">${barras}</div></div>
    <div class="r-card"><div class="r-ct">Categorías <span class="r-muted">(tocá para expandir · Δ ${aa ? 'vs mismo período del año anterior' : 'vs el período anterior'})</span></div>
      <table class="r-tbl"><thead><tr><th></th><th>Categoría</th><th class="r-num">Monto</th><th class="r-num">Unid.</th><th class="r-num">%</th><th class="r-num">${_rEsc(cmpCatLbl)}</th></tr></thead>
      <tbody>${filasCat}</tbody></table></div>
    <div class="r-2col">
      <div class="r-card"><div class="r-ct">Top artículos por monto</div>
        ${lista(act.top_articulos_monto?.slice(0, 12), a => `<div class="r-mp-row"><span title="${_rEsc(a.sku)}">${_rEsc(a.descr || a.sku)}</span><span class="r-num">${_rFmtK($A(a.monto))}</span></div>`)}</div>
      <div class="r-card"><div class="r-ct">Top artículos por cantidad</div>
        ${lista(act.top_articulos_cant?.slice(0, 12), a => `<div class="r-mp-row"><span title="${_rEsc(a.sku)}">${_rEsc(a.descr || a.sku)}</span><span class="r-num">${(a.cant || 0).toLocaleString('es-AR')} u.</span></div>`)}</div>
    </div>
    <div class="r-2col">
      <div class="r-card"><div class="r-ct">Top proveedores</div>
        ${lista(act.proveedores, p => `<div class="r-mp-row"><span>${_rEsc(p.nombre)}</span><span class="r-num">${_rFmtK($A(p.monto))}</span></div>`)}</div>
      <div class="r-card"><div class="r-ct">Top clientes</div>
        ${lista(act.clientes, c => `<div class="r-mp-row"><span>${_rEsc(c.nombre)}</span><span class="r-num">${_rFmtK($A(c.monto))}</span></div>`)}</div>
    </div>
    <div class="r-2col">
      <div class="r-card"><div class="r-ct">Mapa de calor · día × hora</div>${heat}</div>
      <div class="r-card"><div class="r-ct">Medios de pago</div>${mpHtml}</div>
    </div>
    <div class="r-muted" style="text-align:center;padding:8px 0 14px;">
      Período: ${act.periodo?.desde || ''} → ${act.periodo?.hasta || ''} · generado por el reporte nocturno de la PC de JP</div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Interanual · el desarrollo de los últimos años
//  Sale de la RPC ventas_reporte_interanual: la VENTA de ventas_diarias (que
//  está completa y verificada) y la composición de los reportes mensuales.
//  Por eso cada año trae cobertura_pct y la pantalla avisa cuando el detalle
//  describe solo una parte — ver el comentario de la RPC.
// ═══════════════════════════════════════════════════════════════════════
const _IA_COLOR = ['#94a3b8', '#60a5fa', '#f59e0b', '#16a34a', '#dc2626'];
let _repIaCache = null;

async function _repRenderInteranual() {
  const body = document.getElementById('r-body');
  body.innerHTML = '<div class="r-loading">Cargando…</div>';
  await _repCargarIpc();
  if (!_repIaCache) {
    const { data, error } = await sb.rpc('ventas_reporte_interanual', { p_hasta: null, p_anios: 5 });
    if (error) { body.innerHTML = `<div class="r-loading">No se pudo cargar: ${_rEsc(error.message)}</div>`; return; }
    _repIaCache = data;
  }
  const d = _repIaCache;
  const aj = _repSel.real;
  const M = aj ? 'monto_real' : 'monto';
  const V = aj ? 'venta_real' : 'venta';
  const anios = d.anios || [];
  _repPintarToggle(anios.some(a => a.sin_ipc));
  if (!anios.length) { body.innerHTML = '<div class="r-loading">Todavía no hay años para comparar.</div>'; return; }

  // ── 1 · venta por año ──
  const maxA = Math.max(1, ...anios.map(a => a[V]));
  const barrasA = anios.map((a, i) => `
    <div class="r-bar-w" title="${a.anio}${a.parcial ? ' (parcial, ' + a.meses + ' meses)' : ''} · ${_rFmt(a[V])}">
      <div class="r-bar" style="height:${Math.round(a[V] / maxA * 100)}%;background:${_IA_COLOR[i % 5]};${a.parcial ? 'opacity:.55;' : ''}"></div>
      <div class="r-bar-l">${a.anio}${a.parcial ? '*' : ''}</div></div>`).join('');

  const filasA = anios.map((a, i) => {
    const prev = anios[i - 1];
    const upt = a.upt != null ? Number(a.upt).toLocaleString('es-AR') : '—';
    return `<tr>
      <td><b>${a.anio}</b>${a.parcial ? ` <span class="r-muted">${a.meses} meses</span>` : ''}</td>
      <td class="r-num">${_rFmtK(a[V])}</td>
      <td class="r-num">${prev ? _rDelta(a[V], prev[V]) : '<span class="r-flat">—</span>'}</td>
      <td class="r-num">${(a.tickets ?? 0).toLocaleString('es-AR')}</td>
      <td class="r-num">${a.ticket_prom != null ? _rFmtK(aj ? a.ticket_prom_real : a.ticket_prom) : '—'}</td>
      <td class="r-num">${upt}</td>
      <td class="r-num">${_rFmtK(aj ? a.venta_prom_dia_real : a.venta_prom_dia)}</td>
    </tr>`;
  }).join('');

  // ── 2 · curva mes a mes superpuesta (SVG, sin librerías) ──
  const pm = d.por_mes || [];
  const maxM = Math.max(1, ...pm.map(x => x[M]));
  const W = 760, H = 200, PL = 46, PB = 20;
  const px = m => PL + (m - 1) / 11 * (W - PL - 8);
  const py = v => H - PB - (v / maxM) * (H - PB - 10);
  const lineas = anios.map((a, i) => {
    const pts = pm.filter(x => x.anio === a.anio).sort((x, y) => x.mes - y.mes);
    if (!pts.length) return '';
    const dpath = pts.map((x, j) => `${j ? 'L' : 'M'}${px(x.mes).toFixed(1)},${py(x[M]).toFixed(1)}`).join(' ');
    return `<path d="${dpath}" fill="none" stroke="${_IA_COLOR[i % 5]}" stroke-width="2.2"
              stroke-linejoin="round" stroke-linecap="round"/>`
         + pts.map(x => `<circle cx="${px(x.mes).toFixed(1)}" cy="${py(x[M]).toFixed(1)}" r="2.6"
              fill="${_IA_COLOR[i % 5]}"><title>${_MES_L[x.mes - 1]} ${x.anio} · ${_rFmt(x[M])}</title></circle>`).join('');
  }).join('');
  const grilla = [0, .25, .5, .75, 1].map(f => {
    const y = py(maxM * f);
    return `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - 8}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`
         + `<text x="${PL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8">${_rFmtK(maxM * f)}</text>`;
  }).join('');
  const ejeX = _MES_C.map((m, i) =>
    `<text x="${px(i + 1).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#94a3b8">${m}</text>`).join('');
  const leyenda = anios.map((a, i) =>
    `<span class="r-leg"><i style="background:${_IA_COLOR[i % 5]}"></i>${a.anio}</span>`).join('');

  // ── 3 · por local ──
  const locales = [...new Set((d.por_local || []).map(x => x.local))].sort();
  const NOM = { alcorta: 'Alcorta', unicenter: 'Unicenter', oficina: 'Oficina', el_solar: 'El Solar' };
  const filasL = locales.map(loc => {
    const celdas = anios.map(a => {
      const f = (d.por_local || []).find(x => x.local === loc && x.anio === a.anio);
      return `<td class="r-num">${f ? _rFmtK(f[M]) : '<span class="r-muted">—</span>'}</td>`;
    }).join('');
    const ini = (d.por_local || []).find(x => x.local === loc && x.anio === anios[0].anio);
    const fin = (d.por_local || []).find(x => x.local === loc && x.anio === anios[anios.length - 1].anio);
    return `<tr><td><b>${NOM[loc] || _rEsc(loc)}</b></td>${celdas}
      <td class="r-num">${ini && fin ? _rDelta(fin[M], ini[M]) : '<span class="r-flat">—</span>'}</td></tr>`;
  }).join('');

  // ── 4 · categorías: quién ganó y quién perdió participación ──
  const cats = d.categorias || [];
  const aIni = anios[0].anio, aFin = anios[anios.length - 1].anio;
  const grupos = [...new Set(cats.map(c => c.g))];
  const filasC = grupos.map(g => {
    const ini = cats.find(c => c.g === g && c.anio === aIni);
    const fin = cats.find(c => c.g === g && c.anio === aFin);
    const pIni = ini ? Number(ini.part) : 0, pFin = fin ? Number(fin.part) : 0;
    return { g, pIni, pFin, delta: pFin - pIni, montoFin: fin ? fin[M] : 0, montoIni: ini ? ini[M] : 0 };
  }).sort((a, b) => b.delta - a.delta).map(r => `
    <tr><td><b>${_rEsc(r.g)}</b></td>
      <td class="r-num r-muted">${r.pIni.toFixed(1)}%</td>
      <td class="r-num">${r.pFin.toFixed(1)}%</td>
      <td class="r-num"><span class="${r.delta >= 0 ? 'r-up' : 'r-down'}">${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)} pp</span></td>
      <td class="r-num">${_rFmtK(r.montoFin)}</td>
      <td class="r-num">${r.montoIni ? _rDelta(r.montoFin, r.montoIni) : '<span class="r-flat">—</span>'}</td></tr>`).join('');

  // avisos que no se callan
  const flojos = anios.filter(a => a.cobertura_pct != null && a.cobertura_pct < 95);
  const avisos = [];
  if (anios.some(a => a.parcial))
    avisos.push(`Los años marcados con * están incompletos (el año en curso va por ${anios.find(a => a.parcial)?.meses} meses): la barra no es comparable contra un año entero, pero la venta promedio por día sí.`);
  if (flojos.length)
    avisos.push(`En ${flojos.map(a => a.anio).join(' y ')} el detalle del Dragonfish cubre solo ${flojos.map(a => a.cobertura_pct + '%').join(' y ')} de la venta real: los tickets y las categorías de ${flojos.length > 1 ? 'esos años' : 'ese año'} describen una parte, no el total. La venta sí es la completa.`);
  if (aj && anios.some(a => a.sin_ipc))
    avisos.push(`El IPC está publicado hasta ${_repIpcBase ? _repFmtMesCorto(_repIpcBase) : '—'}: los meses posteriores van SIN ajustar (no se estima inflación).`);

  body.innerHTML = `
    <div class="r-card"><div class="r-ct">Venta por año ${aj ? `<span class="r-muted">en pesos de ${_repFmtMesCorto(_repIpcBase)}</span>` : '<span class="r-muted">en pesos de cada momento</span>'}</div>
      <div class="r-bars" style="height:130px;">${barrasA}</div>
      <table class="r-tbl" style="margin-top:10px;"><thead><tr>
        <th>Año</th><th class="r-num">Venta</th><th class="r-num">vs. anterior</th>
        <th class="r-num">Tickets</th><th class="r-num">Ticket prom.</th>
        <th class="r-num">UPT</th><th class="r-num">Venta/día</th></tr></thead>
        <tbody>${filasA}</tbody></table></div>

    <div class="r-card"><div class="r-ct">Mes a mes, los ${anios.length} años superpuestos <span class="r-muted">(para ver la estacionalidad)</span></div>
      <div class="r-leyenda">${leyenda}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">${grilla}${ejeX}${lineas}</svg></div>

    <div class="r-card"><div class="r-ct">Por local</div>
      <table class="r-tbl"><thead><tr><th>Local</th>
        ${anios.map(a => `<th class="r-num">${a.anio}${a.parcial ? '*' : ''}</th>`).join('')}
        <th class="r-num">${aIni}→${aFin}</th></tr></thead>
        <tbody>${filasL}</tbody></table></div>

    <div class="r-card"><div class="r-ct">Qué creció y qué cayó <span class="r-muted">(participación sobre el total, ${aIni} vs ${aFin})</span></div>
      <table class="r-tbl"><thead><tr><th>Categoría</th>
        <th class="r-num">${aIni}</th><th class="r-num">${aFin}</th>
        <th class="r-num">Cambio</th><th class="r-num">Monto ${aFin}</th><th class="r-num">vs ${aIni}</th></tr></thead>
        <tbody>${filasC}</tbody></table></div>

    ${avisos.length ? `<div class="r-aviso">${avisos.map(a => `<div>⚠ ${_rEsc(a)}</div>`).join('')}</div>` : ''}
    <div class="r-muted" style="text-align:center;padding:8px 0 14px;">
      Venta tomada de la planilla diaria (completa y verificada) · tickets, unidades y categorías del reporte del Dragonfish</div>`;
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
    #reporte-overlay .r-mp-bar div{background:#16a34a;height:6px;border-radius:4px;}
    #reporte-overlay .r-toggle{background:rgba(255,255,255,.18);border:none;color:#fff;font-size:12px;border-radius:8px;padding:5px 10px;cursor:pointer;font-weight:600;}
    #reporte-overlay .r-toggle.on{background:#fff;color:#16a34a;}
    #reporte-overlay .r-leyenda{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:6px;font-size:11.5px;color:#475569;}
    #reporte-overlay .r-leg{display:inline-flex;align-items:center;gap:5px;}
    #reporte-overlay .r-leg i{width:11px;height:3px;border-radius:2px;display:inline-block;}
    #reporte-overlay .r-aviso{margin:0 12px 12px;background:#fffbeb;border-left:4px solid #d97706;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#92400e;line-height:1.5;}
    #reporte-overlay .r-aviso div + div{margin-top:6px;}
    @media (max-width:640px){#btn-reporte-ventas{padding:5px 9px !important;font-size:12px !important;}}`;
  document.head.appendChild(css);

  // El botón va en el header, pegado a "📊 Análisis" (pedido de JP: antes vivía
  // adentro del kebab y había que ir a buscarlo). Solo admin, así que espera a
  // que la sesión esté lista — igual que antes.
  let intentos = 0;
  const timer = setInterval(() => {
    intentos++;
    if (typeof session !== 'undefined' && session?.isAdmin) {
      clearInterval(timer);
      if (document.getElementById('btn-reporte-ventas')) return;
      const b = document.createElement('button');
      b.id = 'btn-reporte-ventas';
      b.title = 'Reporte semanal/mensual: KPIs, categorías, top artículos y el análisis de la semana';
      b.onclick = () => abrirReporteVentas();
      const ana = document.getElementById('btn-analisis');
      if (ana) {
        // Copia el estilo del de Análisis para que queden parejos aunque alguien
        // lo cambie; solo se le saca el display:none con el que nace oculto.
        b.textContent = '📈 Reporte';
        b.style.cssText = ana.style.cssText;
        b.style.removeProperty('display');
        ana.insertAdjacentElement('afterend', b);
      } else {
        // Header inesperado: mejor el kebab que perder el acceso al reporte.
        const kebab = document.getElementById('kebab-menu');
        if (!kebab) return;
        b.textContent = '📈 Reporte semanal/mensual';
        b.onclick = () => { if (typeof cerrarKebab === 'function') cerrarKebab(); abrirReporteVentas(); };
        kebab.insertBefore(b, kebab.firstChild);
      }
    } else if (intentos > 40) clearInterval(timer);
  }, 500);
})();
