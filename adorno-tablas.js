// ═══════════════════════════════════════════════════════════════════════
//  adorno-tablas.js — TABLAS TIPO EXCEL, IGUAL EN TODOS LOS MÓDULOS
//  FUENTE ÚNICA: C:\CRM_Adorno\_shared\adorno-tablas.js. Cada módulo tiene una COPIA que pone
//  `python _shared/inyectar_tablas.py <modulo>`. NO editar la copia de un módulo: se cambia acá,
//  se vuelve a correr el inyector en cada módulo y cada módulo publica (con el OK de JP en su charla).
//
//  (19-nov-2026, JP) «Cuando haya tablas de información, quiero que sea más como un Excel: títulos
//  fijos al bajar, cada línea con colores alternos, que los títulos sirvan como filtros, para
//  acomodar, que se puedan ocultar y que las columnas se puedan arrastrar para agrandar o achicar.
//  Y que cuando creemos una tabla nueva ya tome esa base.» → nació en Compras (tablas.js v1, mismo
//  día) y se pasó acá, más los renglones alternados (cebra) y el renglón resaltado bajo el mouse.
//
//  Variables de color que usa (con valores por defecto si el módulo no las define):
//   --primary, --primary-dark, --bd, --tx, --mut, y propias: --tt-cebra (fondo de los renglones
//   alternados), --tt-hover (renglón bajo el mouse).
//  Una tabla sin cebra: data-tt-cebra="no". Las ventanas estirables (lo de Compras) se activan solo
//  si el módulo define ANTES de cargar este archivo:
//   window.ADORNO_TABLAS_CONF = {ventanas: '#prov-modal, [id$="-overlay"]'};
//
//  ── Lo que sigue es la descripción original de Compras ──
//  JP: «Quiero que todos los títulos de tablas queden fijos cuando voy para
//  abajo, que se puedan acomodar por los títulos, filtrar por los títulos y
//  ocultar. También en las tablas de adentro de cada apartado (ej. el nuevo
//  pedido). Y que la subventana se pueda agrandar o achicar estirando de las
//  puntas.»
//
//  No hay que tocar cada tabla: este archivo mira la página (MutationObserver)
//  y a toda <table> con <thead> le agrega:
//   · títulos fijos (position:sticky) contra lo que se desplaza: la página
//     (debajo del banner), la ventana o la caja con scroll propio. Los
//     envoltorios con overflow-x:auto (que anulan el sticky) se acomodan solos:
//     si la tabla entra, el envoltorio deja de cortar; si es más ancha, pasa a
//     ser una caja con alto de pantalla y los títulos quedan fijos adentro.
//   · tocar el título ordena: de menor a mayor → de mayor a menor → como venía.
//   · el embudito del título abre el menú: ordenar, buscar, elegir valores,
//     desde/hasta (números y fechas), ocultar la columna y ver las ocultas.
//   · una barrita arriba de la tabla cuando hay filtros u ocultas, para sacarlos.
//   · (19-nov, JP: «que las pueda agrandar o achicar arrastrándolas, como Excel») el borde
//     derecho de cada título se arrastra para cambiar el ancho de la columna; doble clic en ese
//     borde (o «Anchos automáticos» en el menú) vuelve al ancho que se acomoda solo. Los anchos
//     se recuerdan en esta computadora (localStorage adorno.tt.anchos.*).
//  Y a las ventanas (#prov-modal y los *-overlay) les hace estirables los
//  bordes y las puntas (doble clic en el borde: vuelve al tamaño original).
//
//  Qué recuerda: las columnas ocultas, para siempre en esta computadora
//  (localStorage); el orden y los filtros mientras la página esté abierta (se
//  vuelven a aplicar cuando la tabla se redibuja); el tamaño de cada ventana,
//  también mientras la página esté abierta.
//
//  Una tabla puede pedir que no la toquen con data-tt="no", o solo títulos
//  fijos con data-tt="fijo". Las tablas que ya ordenan solas (th con onclick
//  de orden, ej. la Bandeja) conservan su orden; se les suma filtrar y ocultar.
// ═══════════════════════════════════════════════════════════════════════
(function(){
'use strict';
if (window.ADORNO_TABLAS) return;

// ── íconos de línea (trazos de Lucide, MIT), mismo estilo que el resto del módulo ──
const I = {
  filtro: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
  subir: '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>',
  bajar: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>',
  ojoNo: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
  ojo: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  cruz: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  columnas: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  orden: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  chev: '<polyline points="9 18 15 12 9 6"/>'
};
const svg = (k, cls) => `<svg class="tt-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;

const CSS = `
table.tt>thead>tr>th.tt-th{position:sticky!important;z-index:1}
:where(table.tt)>thead>tr>th.tt-th{background:var(--tt-fondo,#fff);border-bottom-color:transparent;box-shadow:inset 0 -2px 0 var(--bd,#e2e8f0)}
[id$="-overlay"] .c-head{z-index:4!important}
:where(table.tt:not([data-tt-cebra="no"])>tbody>tr.tt-cebra)>td{box-shadow:inset 0 0 0 9999px var(--tt-cebra,rgba(120,86,60,.07))}
@media (hover:hover){:where(table.tt:not([data-tt-cebra="no"])>tbody>tr:hover)>td{box-shadow:inset 0 0 0 9999px var(--tt-hover,rgba(176,122,85,.12))}}
.tt-sinx{overflow:visible!important}
.tt-clip{overflow:clip!important}
.tt-caja{overflow:auto!important}
th.tt-col.tt-ordenable{cursor:pointer;user-select:none;-webkit-user-select:none}
th.tt-col:not(.tt-ordenable){cursor:default}
th .tt-menu{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin:-4px -4px -4px 2px;padding:0;border:0;
  background:transparent;border-radius:999px;color:inherit;opacity:.32;cursor:pointer;vertical-align:middle;transition:opacity .15s,background .15s,color .15s}
th:hover .tt-menu,th .tt-menu:focus-visible,th .tt-menu.abierto{opacity:.95}
th .tt-menu:hover,th .tt-menu.abierto{background:rgba(176,122,85,.13);color:var(--primary,#B07A55)}
th .tt-menu.on{opacity:1;color:var(--primary,#B07A55)}
th .tt-menu.on svg{fill:currentColor}
th .tt-menu svg,.tt-ico{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none}
th .tt-flecha{color:var(--primary,#B07A55);font-size:9px;margin-left:3px;vertical-align:1px}
th .tt-flecha:empty{display:none}
@media (hover:none){th .tt-menu{opacity:.6}}
.tt-oc{display:none!important}
tr.tt-fuera{display:none!important}
th .tt-ancho{position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;z-index:2;touch-action:none}
th .tt-ancho::after{content:'';position:absolute;top:18%;bottom:18%;right:3px;width:2px;border-radius:2px;background:transparent;transition:background .15s}
th:hover>.tt-ancho::after{background:var(--bd,#e2e8f0)}
th>.tt-ancho:hover::after,th>.tt-ancho.activo::after{background:var(--primary,#B07A55)}
table.tt-anchos>*>tr>th,table.tt-anchos>*>tr>td:not(:has(.sku-sug,.op-tip)){overflow:hidden;text-overflow:ellipsis}
html.tt-col-res,html.tt-col-res *{cursor:col-resize!important}
#tt-pop{position:fixed;z-index:10200;width:290px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;background:#fff;color:var(--tx,#0f172a);
  border:1px solid var(--bd,#e2e8f0);border-radius:24px;box-shadow:0 16px 44px rgba(15,23,42,.24);padding:12px 12px 10px;font-family:inherit;font-size:13px;
  text-transform:none;letter-spacing:0;font-weight:400;text-align:left;white-space:normal;line-height:1.3;cursor:default}
#tt-pop .tt-tit{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;margin:2px 6px 10px;color:var(--tx,#0f172a)}
#tt-pop .tt-tit span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tt-pop .tt-tit button{width:26px;height:26px;padding:0;justify-content:center;border:0}
#tt-pop .tt-fila{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
#tt-pop button.tt-p{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bd,#e2e8f0);background:#fff;border-radius:999px;padding:6px 12px;
  font:inherit;font-size:12.5px;cursor:pointer;color:var(--tx,#0f172a);white-space:nowrap}
#tt-pop button.tt-p:hover{border-color:var(--primary,#B07A55);color:var(--primary-dark,#8A5F42)}
#tt-pop button.tt-p.on{background:#F7F1EC;border-color:var(--primary,#B07A55);color:var(--primary-dark,#8A5F42);font-weight:700}
#tt-pop button.tt-p.solo{border-color:transparent;background:transparent}
#tt-pop button.tt-p.solo:hover{background:#F7F1EC}
#tt-pop input.tt-in{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 14px;border:1px solid var(--bd,#e2e8f0);border-radius:999px;outline:none;background:#fff;color:inherit}
#tt-pop input.tt-in:focus{border-color:var(--primary,#B07A55)}
#tt-pop .tt-rango{display:flex;gap:6px;margin:6px 0 2px}
#tt-pop .tt-rango input{min-width:0;flex:1;padding:6px 10px;font-size:12.5px}
#tt-pop .tt-vals{max-height:228px;overflow:auto;margin:8px 0 4px;padding:2px 0}
#tt-pop label.tt-v{display:flex;align-items:center;gap:9px;padding:5px 9px;border-radius:999px;cursor:pointer;margin:0;font-size:13px;color:inherit;font-weight:400}
#tt-pop label.tt-v:hover{background:#F7F1EC}
#tt-pop label.tt-v .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tt-pop label.tt-v .t.vacia{color:var(--mut,#64748b);font-style:italic}
#tt-pop label.tt-v .n{color:var(--mut,#64748b);font-size:11.5px;font-variant-numeric:tabular-nums}
#tt-pop label.tt-v.todos{font-weight:700}
#tt-pop input[type=checkbox]{-webkit-appearance:none;appearance:none;width:17px;height:17px;border:1.5px solid #cbd5e1;border-radius:50%;margin:0;flex:none;
  background:#fff center/11px no-repeat;cursor:pointer;padding:0}
#tt-pop input[type=checkbox]:checked{background-color:var(--primary,#B07A55);border-color:var(--primary,#B07A55);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E")}
#tt-pop input[type=checkbox]:indeterminate{border-color:var(--primary,#B07A55);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23B07A55' stroke-width='3.4' stroke-linecap='round'%3E%3Cline x1='6' y1='12' x2='18' y2='12'/%3E%3C/svg%3E")}
#tt-pop .tt-sep{height:1px;background:#f1f5f9;margin:8px 2px}
#tt-pop .tt-nota{font-size:11.5px;color:var(--mut,#64748b);margin:4px 8px}
#tt-pop .tt-pie{display:flex;gap:6px;flex-wrap:wrap;justify-content:space-between;margin-top:6px}
#tt-pop details.tt-cols>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:7px;padding:6px 9px;border-radius:999px;font-size:12.5px;color:var(--mut,#64748b);font-weight:700}
#tt-pop details.tt-cols>summary::-webkit-details-marker{display:none}
#tt-pop details.tt-cols>summary:hover{background:#F7F1EC;color:var(--primary-dark,#8A5F42)}
#tt-pop details.tt-cols>summary .tt-ico.ch{transition:transform .15s}
#tt-pop details.tt-cols[open]>summary .tt-ico.ch{transform:rotate(90deg)}
#tt-pop details.tt-cols .tt-vals{max-height:200px}
.tt-barra{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:2px 0 8px;font-size:12.5px;color:var(--mut,#64748b);text-transform:none;letter-spacing:0}
.tt-barra .tt-chip{display:inline-flex;align-items:center;gap:6px;background:#F7F1EC;color:#7F583D;border:1px solid #E7D7CC;border-radius:999px;padding:3px 4px 3px 11px;white-space:nowrap}
.tt-barra .tt-chip .tt-ico{width:13px;height:13px}
.tt-barra button{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:var(--primary-dark,#8A5F42);font:inherit;font-weight:700;cursor:pointer;border-radius:999px;padding:3px 9px}
.tt-barra button:hover{background:#F2EAE4}
.tt-barra .tt-aviso{font-size:11.5px}
html[data-tt-borde="n"],html[data-tt-borde="n"] *,html[data-tt-borde="s"],html[data-tt-borde="s"] *{cursor:ns-resize!important}
html[data-tt-borde="e"],html[data-tt-borde="e"] *,html[data-tt-borde="w"],html[data-tt-borde="w"] *{cursor:ew-resize!important}
html[data-tt-borde="ne"],html[data-tt-borde="ne"] *,html[data-tt-borde="sw"],html[data-tt-borde="sw"] *{cursor:nesw-resize!important}
html[data-tt-borde="nw"],html[data-tt-borde="nw"] *,html[data-tt-borde="se"],html[data-tt-borde="se"] *{cursor:nwse-resize!important}
html.tt-estirando,html.tt-estirando *{user-select:none!important;-webkit-user-select:none!important}
@media print{.tt-ui{display:none!important}table.tt>thead>tr>th.tt-th{position:static!important}tr.tt-fuera{display:none!important}}
`;
const estilo = document.createElement('style'); estilo.id = 'tt-css'; estilo.textContent = CSS;
(document.head || document.documentElement).appendChild(estilo);

// ── utilidades ──
const limpio = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const norm = s => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const COLL = new Intl.Collator('es', {numeric: true, sensitivity: 'base'});
const VACIO = /^(|—|-|–|s\/d|sin dato|sin datos)$/i;
// lo que está escondido adentro de una celda y no es su valor (globitos de ayuda, sugerencias, nuestra UI)
const SALTA = /(^|\s)(tt-ui|op-tipbox|sku-sug)(\s|$)/;

function texto(el, conControles){
  let s = '';
  for (let n = el.firstChild; n; n = n.nextSibling){
    if (n.nodeType === 3){ s += n.nodeValue; continue; }
    if (n.nodeType !== 1) continue;
    const tg = n.tagName;
    if (tg === 'SCRIPT' || tg === 'STYLE' || tg === 'TEMPLATE' || tg === 'TABLE' || tg === 'DATALIST' || n.namespaceURI === 'http://www.w3.org/2000/svg') continue;
    if (n.hidden || (n.style && n.style.display === 'none')) continue;
    const cl = typeof n.className === 'string' ? n.className : '';
    if (cl && SALTA.test(cl)) continue;
    if (tg === 'INPUT'){
      if (!conControles) continue;
      const ty = (n.type || '').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') s += n.checked ? ' ✓ ' : ' ';
      else if (!/^(button|submit|reset|hidden|file|image)$/.test(ty)) s += ' ' + n.value + ' ';
      continue;
    }
    if (tg === 'SELECT'){ if (conControles){ const o = n.options[n.selectedIndex]; s += ' ' + (o ? o.text : '') + ' '; } continue; }
    if (tg === 'TEXTAREA'){ if (conControles) s += ' ' + n.value + ' '; continue; }
    if (tg === 'BR'){ s += ' '; continue; }
    const t = texto(n, conControles);
    // entre dos pedazos pegados (<span>×3</span><span>Copa</span>) va un espacio, si no quedan como una sola palabra
    s += /^(DIV|P|LI|UL|OL|H\d|SECTION)$/.test(tg) || (s && t && !/\s$/.test(s) && !/^\s/.test(t) && n.previousSibling && n.previousSibling.nodeType === 1) ? ' ' + t + ' ' : t;
  }
  return s;
}
function textoCelda(c){
  if (!c) return '';
  let t = limpio(texto(c, true));
  if (!t){   // celdas que son solo un ícono: vale lo que dice su cartelito
    const q = c.querySelector('[aria-label],[title]');
    if (q) t = limpio(q.getAttribute('aria-label') || q.getAttribute('title') || '');
    if (t.length > 60) t = t.slice(0, 57) + '…';
  }
  return t;
}
const RX_FECHA = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[\s,]+(\d{1,2}):(\d{2}))?/;
const RX_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
function aFecha(t){
  let m = String(t).trim().match(RX_FECHA);
  if (m){ let y = +m[3]; if (y < 100) y += 2000; if (+m[2] > 12 || +m[1] > 31) return null;
    return y * 10000 + (+m[2]) * 100 + (+m[1]) + (m[4] ? ((+m[4]) * 60 + (+m[5])) / 10000 : 0); }
  m = String(t).trim().match(RX_ISO);
  return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : null;
}
// números a la argentina: 1.234.567,89 · $ -1.234,00 · 12 % · 3 u. · (1.234,00)
const RX_NUM = /^([-−–+]?)\s*(?:US\$|U\$S|USD|ARS|\$)?\s*([-−–]?)\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(?:%|u\.?|unid\.?|uds?\.?|pk|kg)?$/i;
function aNumero(t){
  let s = String(t).trim(), neg = false;
  const p = s.match(/^\((.*)\)$/); if (p){ s = p[1]; neg = true; }
  const m = s.match(RX_NUM); if (!m) return null;
  const v = parseFloat(m[3].replace(/\./g, '') + (m[4] ? '.' + m[4] : ''));
  return ((m[1] && m[1] !== '+') || m[2] || neg) ? -v : v;
}
function valorDe(c){
  const t = textoCelda(c);
  const vacio = VACIO.test(t);
  const base = c && c.dataset && c.dataset.orden != null ? c.dataset.orden : t;
  return {t, k: vacio ? '' : norm(t), vacio, fecha: vacio ? null : aFecha(base), num: vacio ? null : aNumero(base)};
}
function spanDe(c){ return +(c.dataset.ttCs || c.colSpan || 1); }
function celdaEn(tr, pos){
  let p = 0;
  for (const c of tr.cells){ const s = spanDe(c); if (pos < p + s) return c; p += s; }
  return null;
}

// ── estado ──
const REG = new Set();                 // tablas mejoradas
const ESTADO = new Map();              // clave → {orden:{id,dir}|null, filtros:{id:{q,excl:Set,desde,hasta,tipo}}}
const LS = 'adorno.tt.ocultas.' + ((location.pathname.split('/').filter(Boolean)[0]) || 'raiz') + '.';
function ocultasDe(clave){ try { return new Set(JSON.parse(localStorage.getItem(LS + clave) || '[]')); } catch (e){ return new Set(); } }
function guardarOcultas(T){ try { if (T.oc.size) localStorage.setItem(LS + T.clave, JSON.stringify([...T.oc])); else localStorage.removeItem(LS + T.clave); } catch (e){} }
const LSA = 'adorno.tt.anchos.' + ((location.pathname.split('/').filter(Boolean)[0]) || 'raiz') + '.';
function anchosDe(clave){ try { return JSON.parse(localStorage.getItem(LSA + clave) || 'null'); } catch (e){ return null; } }
function guardarAnchos(T){ try { if (T.w) localStorage.setItem(LSA + T.clave, JSON.stringify(T.w)); else localStorage.removeItem(LSA + T.clave); } catch (e){} }
function estadoDe(clave){ let s = ESTADO.get(clave); if (!s){ s = {orden: null, filtros: {}}; ESTADO.set(clave, s); } return s; }
const activo = f => !!(f && (f.q || (f.excl && f.excl.size) || f.desde != null || f.hasta != null));
let ocupado = 0;

function columnasDe(t){
  const th = t.tHead; if (!th || !th.rows.length) return null;
  const fila = th.rows[th.rows.length - 1]; if (!fila.cells.length) return null;
  const cols = [], vistos = {};
  let pos = 0;
  for (const c of fila.cells){
    const span = spanDe(c);
    const nombre = limpio(texto(c, false).replace(/[▲▼▴▾↑↓]/g, ''));
    const base = nombre ? norm(nombre) : '#' + pos;
    vistos[base] = (vistos[base] || 0) + 1;
    cols.push({th: c, pos, span, nombre, id: vistos[base] > 1 ? base + '~' + vistos[base] : base,
               util: !!nombre && !(c.querySelector('input[type=checkbox]') && nombre.length < 2)});
    pos += span;
  }
  return {cols, ancho: pos, fila};
}
function claveDe(t, cols){
  if (t.dataset.ttClave) return t.dataset.ttClave;
  const ctx = t.parentElement && t.parentElement.closest('[id]');
  const id = ctx ? ctx.id.replace(/\d+/g, '#') : '';
  return id + '::' + cols.filter(c => c.nombre).slice(0, 3).map(c => c.id).join('|');
}
function tipoFila(tr, ancho){
  if (/(^|\s)(tot|total|totales|subtotal|tt-fija)(\s|$)/i.test(tr.className)) return 'fija';
  const cs = tr.cells; if (!cs.length) return 'fija';
  let w = 0; for (const c of cs) w += spanDe(c);
  if (w < ancho || (cs.length === 1 && ancho > 1)) return 'anexa';
  if (/^(total|totales|subtotal)\b/i.test(limpio(cs[0].textContent))) return 'fija';
  return 'normal';
}
// cada «unidad» es una fila con las que cuelgan de ella (detalle desplegable, renglón de nota)
// ancho «normal» de una fila: el de los títulos, salvo que casi todas las filas tengan menos celdas
// (títulos con una columna de más): ahí manda el de las filas, si no todas quedarían como anexas.
function anchoFilas(T){
  const cuenta = new Map();
  let total = 0;
  for (const tb of T.t.tBodies) for (const tr of tb.rows){
    if (tr.cells.length < 2) continue;
    let w = 0; for (const c of tr.cells) w += spanDe(c);
    cuenta.set(w, (cuenta.get(w) || 0) + 1); total++;
    if (total > 300) break;
  }
  let mejor = T.ancho, n = 0;
  for (const [w, k] of cuenta) if (k > n){ n = k; mejor = w; }
  return total && mejor < T.ancho && n / total >= .6 ? mejor : T.ancho;
}
function unidadesDe(T){
  const U = [];
  const ancho = anchoFilas(T);
  for (const tb of T.t.tBodies){
    let actual = null, hubo = false;
    for (const tr of tb.rows){
      if (tr._ttN == null) tr._ttN = T.n++;
      const tipo = tipoFila(tr, ancho);
      if (tipo === 'normal'){ actual = {tb, filas: [tr], tr, n: tr._ttN, c: {}}; U.push(actual); hubo = true; }
      else if (tipo === 'anexa' && actual) actual.filas.push(tr);
      else U.push({tb, filas: [tr], tr, n: tr._ttN, fija: hubo ? 'abajo' : 'arriba'});
    }
  }
  return U;
}
function valor(u, col){ let v = u.c[col.pos]; if (!v){ v = valorDe(celdaEn(u.tr, col.pos)); u.c[col.pos] = v; } return v; }
// tipo de la columna: fecha, número o texto. Una columna de números con pocas palabras sueltas
// («Falta»: 14, 5, OK, sin mín.) es de números: las palabras quedan al final, en cualquier sentido.
function tipoCol(col, U){
  let f = 0, n = 0, tot = 0;
  const palabras = new Set();
  for (const u of U){ if (u.fija) continue; const v = valor(u, col); if (v.vacio) continue;
    tot++; if (v.fecha != null) f++; else if (v.num != null) n++; else palabras.add(v.k); if (tot >= 400) break; }
  if (!tot) return 'texto';
  if (f / tot >= .7) return 'fecha';
  if (n / tot >= .7 || (n / tot >= .3 && palabras.size <= 3)) return 'num';
  return 'texto';
}
function rango(v, tipo){ return tipo === 'fecha' ? (v.fecha != null ? 0 : 1) : tipo === 'num' ? (v.num != null ? 0 : 1) : 0; }
function comparar(a, b, tipo){
  if (tipo === 'fecha' && a.fecha != null && b.fecha != null) return a.fecha - b.fecha;
  if (tipo === 'num' && a.num != null && b.num != null) return a.num - b.num;
  return COLL.compare(a.t, b.t);
}
function pasa(T, u, salvo){
  const F = T.st.filtros;
  for (const id in F){
    if (id === salvo) continue;
    const f = F[id]; if (!activo(f)) continue;
    const col = T.colPorId[id]; if (!col) continue;
    const v = valor(u, col);
    if (f.q && !v.k.includes(norm(f.q))) return false;
    if (f.excl && f.excl.size && f.excl.has(v.k)) return false;
    if (f.desde != null || f.hasta != null){
      const x = f.tipo === 'fecha' ? (v.fecha != null ? Math.floor(v.fecha) : null) : v.num;
      if (x == null) return false;
      if (f.desde != null && x < f.desde) return false;
      if (f.hasta != null && x > f.hasta) return false;
    }
  }
  return true;
}

// ── aplicar filtros, orden y columnas ocultas ──
function aplicar(T){
  if (!T || !T.t.isConnected) return;
  ocupado++;
  try {
    const hayF = Object.values(T.st.filtros).some(activo);
    const algo = hayF || T.tuvoF || T.st.orden || T.desordenado;
    if (algo){
      const U = unidadesDe(T);
      let tot = 0, vis = 0;
      for (const u of U){
        if (u.fija) continue;
        tot++;
        const ok = !hayF || pasa(T, u);
        if (ok) vis++;
        for (const r of u.filas) if (r.classList.contains('tt-fuera') === ok) r.classList.toggle('tt-fuera', !ok);
      }
      T.tot = tot; T.vis = vis; T.tuvoF = hayF;
      T.fijasAbajo = U.some(u => u.fija === 'abajo') || !!(T.t.tFoot && T.t.tFoot.rows.length);
      if (T.st.orden || T.desordenado) ordenarFilas(T, U);
    }
    cebra(T);
    marcarOcultas(T);
    if (T.w) pintarAnchos(T);
    pintarTitulos(T);
    pintarBarra(T);
  } finally { ocupado--; obs.takeRecords(); }
}
function ordenarFilas(T, U){
  const o = T.st.orden, col = o && T.colPorId[o.id];
  const porTb = new Map();
  for (const u of U){ if (!porTb.has(u.tb)) porTb.set(u.tb, []); porTb.get(u.tb).push(u); }
  for (const [tb, L] of porTb){
    let orden;
    if (!col) orden = L.slice().sort((a, b) => a.n - b.n);
    else {
      const tipo = tipoCol(col, L);
      const nor = L.filter(u => !u.fija);
      for (const u of nor) u.v = valor(u, col);
      nor.sort((a, b) => (a.v.vacio - b.v.vacio) || (rango(a.v, tipo) - rango(b.v, tipo)) || (o.dir * comparar(a.v, b.v, tipo)) || (a.n - b.n));
      orden = [...L.filter(u => u.fija === 'arriba'), ...nor, ...L.filter(u => u.fija === 'abajo')];
    }
    const filas = orden.flatMap(u => u.filas);
    const act = tb.rows;
    let igual = act.length === filas.length;
    for (let i = 0; igual && i < filas.length; i++) if (act[i] !== filas[i]) igual = false;
    if (!igual){ const fr = document.createDocumentFragment(); for (const r of filas) fr.appendChild(r); tb.appendChild(fr); }
  }
  T.desordenado = !!col;
}
// ── renglones alternados (cebra) ──
// Se cuenta por «unidad» (una fila + las que cuelgan de ella, como un detalle desplegado) y solo las
// que se ven: al filtrar u ordenar, la cebra sigue pareja. Totales y renglones fijos no se pintan.
// Primero se lee qué se ve y después se marcan las clases (para no recalcular la página en cada fila).
function cebra(T){
  const t = T.t;
  if (t.dataset.ttCebra === 'no') return;
  const U = unidadesDe(T);
  const medir = t.offsetWidth > 0;
  const ve = U.map(u => !u.fija && !u.tr.hidden && !u.tr.classList.contains('tt-fuera') && u.tr.style.display !== 'none' &&
    (!medir || u.tr.getClientRects().length > 0));
  let i = 0, tbAnt = null;
  U.forEach((u, k) => {
    if (u.tb !== tbAnt){ tbAnt = u.tb; i = 0; }
    const par = ve[k] && (i++ % 2 === 1);
    for (const r of u.filas) if (r.classList.contains('tt-cebra') !== par) r.classList.toggle('tt-cebra', par);
  });
}
function marcarOcultas(T){
  const pos = new Set();
  for (const c of T.cols) if (T.oc.has(c.id)) for (let k = 0; k < c.span; k++) pos.add(c.pos + k);
  if (!pos.size && !T.tuvoOc) return;
  T.tuvoOc = pos.size > 0;
  for (const sec of [T.t.tHead, ...T.t.tBodies, T.t.tFoot]){
    if (!sec) continue;
    for (const tr of sec.rows){
      let p = 0;
      for (const c of tr.cells){
        const s0 = spanDe(c);
        let n = 0; for (let k = p; k < p + s0; k++) if (pos.has(k)) n++;
        if (s0 === 1){ if (c.classList.contains('tt-oc') !== (n === 1)) c.classList.toggle('tt-oc', n === 1); }
        else {
          if (n && !c.dataset.ttCs) c.dataset.ttCs = String(s0);
          if (n >= s0) c.classList.add('tt-oc');
          else { c.classList.remove('tt-oc'); if (c.dataset.ttCs && c.colSpan !== s0 - n) c.colSpan = s0 - n; }
        }
        p += s0;
      }
    }
  }
}

// ── títulos: flechita de orden + embudito del menú ──
function armarTitulos(T){
  for (const col of T.cols){
    const th = col.th;
    if (!th.querySelector(':scope > .tt-ancho')){   // borde derecho del título: se arrastra para cambiar el ancho
      const h = document.createElement('span'); h.className = 'tt-ui tt-ancho';
      h.title = 'Arrastrá para agrandar o achicar la columna · doble clic: ancho automático';
      th.appendChild(h);
    }
    if (!col.util) continue;
    th.classList.add('tt-col');
    if (!T.ordenApp) th.classList.add('tt-ordenable');
    if (th.querySelector(':scope > .tt-menu')) continue;
    const fl = document.createElement('span'); fl.className = 'tt-ui tt-flecha';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tt-ui tt-menu';
    b.title = (T.ordenApp ? 'Filtrar u ocultar' : 'Ordenar, filtrar u ocultar') + ' «' + col.nombre + '»';
    b.setAttribute('aria-label', b.title); b.innerHTML = svg('filtro');
    // si el título tiene un renglón de abajo (span.sub en bloque), el botón va al lado del nombre, no abajo
    let antes = null;
    for (const ch of th.children){ if (ch.classList.contains('tt-ui')) continue; const d = getComputedStyle(ch).display; if (d === 'block' || d === 'flex') { antes = ch; break; } }
    th.insertBefore(fl, antes); th.insertBefore(b, antes);
  }
}

// ── ancho de las columnas (como en Excel) ──
// La primera vez que se estira una columna, la tabla «congela» los anchos que tenía (table-layout:fixed,
// ancho = suma de las columnas); desde ahí cada columna mide lo que se le dé. Se recuerda en esta computadora.
function congelar(T, guardados){
  const t = T.t;
  for (const c of T.cols) if (c.th._ttW0 == null) c.th._ttW0 = c.th.style.width;
  if (t._ttW0 == null) t._ttW0 = t.style.width;
  t.classList.remove('tt-anchos'); t.style.tableLayout = ''; t.style.width = t._ttW0;
  for (const c of T.cols) c.th.style.width = c.th._ttW0;
  const medidas = T.cols.map(c => c.th.classList.contains('tt-oc') ? 0 : Math.round(c.th.getBoundingClientRect().width));
  T.w = {};
  T.cols.forEach((c, i) => { const g = guardados && Number(guardados[c.id]); T.w[c.id] = g > 0 ? g : medidas[i]; });
  pintarAnchos(T);
}
function pintarAnchos(T){
  if (!T.w) return;
  let suma = 0;
  for (const c of T.cols){
    if (c.th.classList.contains('tt-oc')) continue;
    if (!(T.w[c.id] > 0)) T.w[c.id] = 120;   // columna que estaba oculta cuando se congeló
    const v = T.w[c.id] + 'px'; if (c.th.style.width !== v) c.th.style.width = v;
    suma += T.w[c.id];
  }
  const t = T.t, v = suma + 'px';
  if (t.style.tableLayout !== 'fixed') t.style.tableLayout = 'fixed';
  if (t.style.width !== v) t.style.width = v;
  if (!t.classList.contains('tt-anchos')) t.classList.add('tt-anchos');
}
function anchosAuto(T){
  const t = T.t;
  T.w = null; T.anchosPend = null; guardarAnchos(T);
  t.classList.remove('tt-anchos'); t.style.tableLayout = ''; t.style.width = t._ttW0 || '';
  for (const c of T.cols) if (c.th._ttW0 != null) c.th.style.width = c.th._ttW0;
  programarFijo(T);
}
function pintarTitulos(T){
  const o = T.st.orden;
  for (const col of T.cols){
    if (!col.util) continue;
    const fl = col.th.querySelector(':scope > .tt-flecha'), b = col.th.querySelector(':scope > .tt-menu');
    const f = !T.ordenApp && o && o.id === col.id ? (o.dir > 0 ? '▲' : '▼') : '';
    if (fl && fl.textContent !== f) fl.textContent = f;
    if (b){ const on = activo(T.st.filtros[col.id]); if (b.classList.contains('on') !== on) b.classList.toggle('on', on); }
  }
}

// ── barrita de «filtrado / ocultas» arriba de la tabla ──
function ancla(T){
  let el = T.t;
  for (;;){
    const p = el.parentElement;
    if (!p || p === document.body || p.id || /^(TD|TH|LI|BODY)$/.test(p.tagName) || p.classList.contains('c-body') || p.classList.contains('c-box') || p.classList.contains('card')) break;
    const hijos = [...p.children].filter(x => !x.classList.contains('tt-ui'));
    if (hijos.length !== 1) break;
    el = p;
  }
  return el;
}
function pintarBarra(T){
  const nF = Object.keys(T.st.filtros).filter(id => T.colPorId[id] && activo(T.st.filtros[id])).length;
  const oc = T.cols.filter(c => T.oc.has(c.id));
  let b = T.barra;
  if (!nF && !oc.length){ if (b){ b.remove(); T.barra = null; } return; }
  if (!b || !b.isConnected){
    b = document.createElement('div'); b.className = 'tt-ui tt-barra';
    const a = ancla(T); a.parentNode.insertBefore(b, a); T.barra = b;
    b.addEventListener('click', ev => {
      const x = ev.target.closest('button'); if (!x) return;
      ev.stopPropagation();
      const TT = vivo(b._T);
      if (!TT) return;
      if (x.dataset.a === 'filtros'){ TT.st.filtros = {}; cerrarMenu(); aplicar(TT); }
      else if (x.dataset.a === 'ocultas'){ TT.oc.clear(); guardarOcultas(TT); aplicar(TT); prepararFijo(TT); }
    });
  }
  b._T = T;
  const partes = [];
  if (nF) partes.push(`<span class="tt-chip">${svg('filtro')}Mostrando <b>${T.vis ?? '?'}</b> de ${T.tot ?? '?'}${T.fijasAbajo ? ' <span class="tt-aviso">(el total no se recalcula)</span>' : ''}
    <button type="button" data-a="filtros" title="Sacar todos los filtros de esta tabla">${svg('cruz')}Quitar filtros</button></span>`);
  if (oc.length) partes.push(`<span class="tt-chip" title="Ocultas: ${escH(oc.map(c => c.nombre).join(', '))}">${svg('ojoNo')}${oc.length === 1 ? '1 columna oculta' : oc.length + ' columnas ocultas'}
    <button type="button" data-a="ocultas" title="Volver a mostrar todas las columnas">${svg('ojo')}Mostrar</button></span>`);
  const html = partes.join('');
  if (b._html !== html){ b.innerHTML = html; b._html = html; }
}
function vivo(T){
  if (T && T.t.isConnected) return T;
  if (!T) return null;
  for (const X of REG) if (X.clave === T.clave && X.t.isConnected) return X;
  return null;
}

// ── títulos fijos ──
function esScrollerReal(el, cs){
  return cs.position === 'fixed' || cs.position === 'absolute' || cs.maxHeight !== 'none' || !!el.style.height ||
         cs.overflowY === 'scroll' || el.scrollHeight > el.clientHeight + 1;
}
function topePegado(el, sc){
  let max = 0;
  for (let n = el; n && n !== sc && n !== document.body && n.parentElement; n = n.parentElement){
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling){
      if (s.classList.contains('tt-ui') || s.tagName === 'SCRIPT' || s.tagName === 'STYLE') continue;
      const cs = getComputedStyle(s);
      if (cs.position !== 'sticky' || cs.top === 'auto' || cs.display === 'none') continue;
      const b = parseFloat(cs.top) + s.offsetHeight;
      if (b > max) max = b;
    }
  }
  return Math.max(0, max);
}
function scrollerSobre(el){
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement){
    if (n.classList.contains('tt-sinx') || n.classList.contains('tt-clip')) continue;
    if (n.classList.contains('tt-caja')) return n;
    const cs = getComputedStyle(n);
    if ((cs.overflowX === 'visible' || cs.overflowX === 'clip') && (cs.overflowY === 'visible' || cs.overflowY === 'clip')) continue;
    if (esScrollerReal(n, cs)) return n;
  }
  return null;
}
function altoCaja(el){
  const sc = scrollerSobre(el);
  const visible = sc ? sc.clientHeight : innerHeight;
  const alto = Math.max(260, Math.round(visible - topePegado(el, sc) - (sc ? 70 : 24)));
  const v = alto + 'px'; if (el.style.maxHeight !== v) el.style.maxHeight = v;
}
function fondoDe(el){
  for (let n = el; n && n.nodeType === 1; n = n.parentElement){
    const b = getComputedStyle(n).backgroundColor;
    const m = b && b.match(/rgba?\(([^)]+)\)/);
    if (!m) continue;
    const p = m[1].split(',');
    if (p.length === 4 && parseFloat(p[3]) < 1) continue;
    return b;
  }
  return '#fff';
}
function prepararFijo(T){
  const t = T.t;
  if (!t.isConnected || !t.offsetWidth || !t.tHead) return;   // escondida: la vuelve a llamar el ResizeObserver
  ocupado++;
  try {
    if (T.anchosPend && !T.w){ congelar(T, T.anchosPend); T.anchosPend = null; }   // anchos guardados de esta tabla
    let sc = null;
    for (let el = t.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement){
      if (el.classList.contains('tt-clip')) continue;
      if (el.classList.contains('tt-sinx')){
        if (el.scrollWidth > el.clientWidth + 2){ el.classList.remove('tt-sinx'); el.classList.add('tt-caja'); sc = el; altoCaja(el); break; }
        continue;
      }
      if (el.classList.contains('tt-caja')){
        if (el.scrollWidth <= el.clientWidth + 1){ el.classList.remove('tt-caja'); el.style.maxHeight = ''; el.classList.add('tt-sinx'); continue; }
        sc = el; altoCaja(el); break;
      }
      const cs = getComputedStyle(el);
      const ox = cs.overflowX, oy = cs.overflowY;
      if ((ox === 'visible' || ox === 'clip') && (oy === 'visible' || oy === 'clip')) continue;
      if (esScrollerReal(el, cs)){ sc = el; break; }
      if (ox === 'hidden' || oy === 'hidden'){ el.classList.add('tt-clip'); continue; }
      // envoltorio de scroll horizontal sin alto propio: es lo que anula el sticky
      if (el.scrollWidth > el.clientWidth + 2){ el.classList.add('tt-caja'); sc = el; altoCaja(el); break; }
      el.classList.add('tt-sinx');
    }
    T.sc = sc;
    const tope = Math.round(topePegado(t, sc));
    const filas = t.tHead.rows, y0 = filas.length ? filas[0].offsetTop : 0;
    for (const r of filas){
      const v = (tope + r.offsetTop - y0) + 'px';
      for (const th of r.cells){ if (!th.classList.contains('tt-th')) th.classList.add('tt-th'); if (th.style.top !== v) th.style.top = v; }
    }
    const f = fondoDe(t);
    if (t.style.getPropertyValue('--tt-fondo') !== f) t.style.setProperty('--tt-fondo', f);
  } finally { ocupado--; obs.takeRecords(); }
}
let rafFijo = 0, toFijo = 0;
const pendFijo = new Set();
function correrFijo(){
  if (rafFijo){ cancelAnimationFrame(rafFijo); rafFijo = 0; }
  if (toFijo){ clearTimeout(toFijo); toFijo = 0; }
  const L = [...pendFijo]; pendFijo.clear();
  for (const X of L) if (X.t.isConnected) prepararFijo(X);
}
function programarFijo(T){
  if (T) pendFijo.add(T); else for (const X of REG) pendFijo.add(X);
  if (rafFijo || toFijo) return;
  // en el próximo cuadro; si el navegador pausa los cuadros (pestaña de fondo), igual a los 150 ms
  rafFijo = requestAnimationFrame(correrFijo);
  toFijo = setTimeout(correrFijo, 150);
}
const RO = new ResizeObserver(ents => { for (const e of ents){ const T = e.target._tt; if (T) programarFijo(T); else programarFijo(); } });

// ── mejorar una tabla ──
function elegible(t){
  if (!t.tHead || !t.tHead.rows.length || !t.tHead.querySelector('th')) return false;
  if (t.closest('[data-tt="no"], .tt-ui, .asist-panel, .op-tipbox, #login')) return false;
  return true;
}
function mejorar(t){
  if (t._tt || !elegible(t)) return;
  const info = columnasDe(t); if (!info) return;
  const T = {t, cols: info.cols, ancho: info.ancho, n: 0, colPorId: {}};
  for (const c of info.cols) T.colPorId[c.id] = c;
  T.clave = claveDe(t, info.cols);
  T.st = estadoDe(T.clave);
  T.oc = ocultasDe(T.clave);
  T.soloFijo = t.dataset.tt === 'fijo' || t.tHead.rows.length > 1;
  T.ordenApp = [...info.fila.cells].some(c => /orden/i.test(c.getAttribute('onclick') || ''));
  if (T.ordenApp) T.st.orden = null;
  if (T.soloFijo){ T.cols = []; T.colPorId = {}; }
  else { const a = anchosDe(T.clave); if (a && typeof a === 'object') T.anchosPend = a; }
  t._tt = T; t.classList.add('tt');
  REG.add(T);
  ocupado++;
  try { if (!T.soloFijo) armarTitulos(T); } finally { ocupado--; }
  RO.observe(t);
  prepararFijo(T);
  aplicar(T);
}
function olvidar(T){
  REG.delete(T); try { RO.unobserve(T.t); } catch (e){}
  if (T.barra && T.barra.isConnected && !vivo(T)) T.barra.remove();
  if (POP && POP.T === T && !T.t.isConnected) cerrarMenu();
}
function escanear(raiz){
  for (const T of [...REG]) if (!T.t.isConnected) olvidar(T);
  const L = raiz && raiz.tagName === 'TABLE' ? [raiz] : (raiz || document).getElementsByTagName('table');
  for (const t of [...L]) if (!t._tt) mejorar(t);
}

// ── menú del título ──
let POP = null;
function cerrarMenu(){
  if (!POP) return;
  if (POP.boton) POP.boton.classList.remove('abierto');
  POP.el.remove(); POP = null;
}
function abrirMenu(T, col, boton){
  cerrarMenu();
  const el = document.createElement('div'); el.id = 'tt-pop'; el.className = 'tt-ui';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Columna ' + col.nombre);
  document.body.appendChild(el);
  POP = {T, col, el, boton};
  boton.classList.add('abierto');
  pintarMenu();
  posicionar();
  const q = el.querySelector('input.tt-q');
  if (q && matchMedia('(hover:hover)').matches) q.focus({preventScroll: true});
}
function posicionar(){
  if (!POP) return;
  const el = POP.el, b = POP.boton;
  const r = b.isConnected ? b.getBoundingClientRect() : {left: 20, right: 20, bottom: 60, top: 60};
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = r.right - w + 8; if (x < 8) x = Math.min(r.left - 8, innerWidth - w - 8); x = Math.max(8, Math.min(x, innerWidth - w - 8));
  let y = r.bottom + 6; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6 >= 8 ? r.top - h - 6 : innerHeight - h - 8);
  el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
}
function etiquetasOrden(tipo){
  return tipo === 'fecha' ? ['Más viejo primero', 'Más nuevo primero'] : tipo === 'num' ? ['Menor a mayor', 'Mayor a menor'] : ['De la A a la Z', 'De la Z a la A'];
}
const MAX_VALORES = 300;
function pintarMenu(){
  const P = POP; if (!P) return;
  const T = vivo(P.T); if (!T){ cerrarMenu(); return; }
  P.T = T;
  const col = T.colPorId[P.col.id] || P.col; P.col = col;
  const st = T.st, f = st.filtros[col.id] || {};
  const U = unidadesDe(T).filter(u => !u.fija);
  const tipo = tipoCol(col, U); P.tipo = tipo;
  // valores de las filas que pasan los OTROS filtros (como Excel)
  const m = new Map();
  for (const u of U){
    if (!pasa(T, u, col.id)) continue;
    const v = valor(u, col);
    const e = m.get(v.k); if (e) e.n++; else m.set(v.k, {k: v.k, t: v.vacio ? '(vacías)' : v.t, n: 1, v});
  }
  const vals = [...m.values()].sort((a, b) => (a.k === '') - (b.k === '') || (rango(a.v, tipo) - rango(b.v, tipo)) || comparar(a.v, b.v, tipo));
  P.vals = vals;
  const o = st.orden && st.orden.id === col.id ? st.orden.dir : 0;
  const [l1, l2] = etiquetasOrden(tipo);
  const excl = f.excl || new Set();
  const nExcl = vals.filter(v => excl.has(v.k)).length;
  const muchos = vals.length > MAX_VALORES;
  const fechaIn = x => x == null ? '' : String(Math.floor(x)).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const numIn = x => x == null ? '' : String(x).replace('.', ',');
  const otras = T.cols.filter(c => c.util);
  const nOc = otras.filter(c => T.oc.has(c.id)).length;
  P.el.innerHTML = `
    <div class="tt-tit"><span title="${escH(col.nombre)}">${escH(col.nombre)}</span><button type="button" class="tt-p solo" data-a="cerrar" title="Cerrar">${svg('cruz')}</button></div>
    ${T.ordenApp ? '<div class="tt-nota">Esta tabla se ordena tocando el título.</div>' : `<div class="tt-fila">
      <button type="button" class="tt-p${o > 0 ? ' on' : ''}" data-a="asc">${svg('subir')}${l1}</button>
      <button type="button" class="tt-p${o < 0 ? ' on' : ''}" data-a="desc">${svg('bajar')}${l2}</button>
      ${o ? `<button type="button" class="tt-p solo" data-a="sinorden" title="Volver al orden en que venía">${svg('cruz')}Sin orden</button>` : ''}</div>`}
    <div class="tt-sep"></div>
    <input class="tt-in tt-q" type="search" placeholder="Buscar en esta columna…" value="${escH(f.q || '')}" autocomplete="off">
    ${tipo === 'fecha' ? `<div class="tt-rango"><input class="tt-in tt-d" type="date" title="Desde (incluido)" value="${fechaIn(f.desde)}"><input class="tt-in tt-h" type="date" title="Hasta (incluido)" value="${fechaIn(f.hasta)}"></div>`
      : tipo === 'num' ? `<div class="tt-rango"><input class="tt-in tt-d" inputmode="decimal" placeholder="desde" title="Desde (incluido)" value="${numIn(f.desde)}"><input class="tt-in tt-h" inputmode="decimal" placeholder="hasta" title="Hasta (incluido)" value="${numIn(f.hasta)}"></div>` : ''}
    <div class="tt-vals">
      <label class="tt-v todos"><input type="checkbox" data-a="todos"><span class="t">Todos</span><span class="n">${U.length}</span></label>
      ${vals.slice(0, MAX_VALORES).map((v, i) => `<label class="tt-v" data-i="${i}"><input type="checkbox" data-i="${i}"${excl.has(v.k) ? '' : ' checked'}><span class="t${v.k === '' ? ' vacia' : ''}" title="${escH(v.t)}">${escH(v.t.length > 70 ? v.t.slice(0, 67) + '…' : v.t)}</span><span class="n">${v.n}</span></label>`).join('')}
    </div>
    ${muchos ? `<div class="tt-nota">Hay ${vals.length} valores distintos: se muestran los primeros ${MAX_VALORES}. Usá el buscador.</div>` : ''}
    <div class="tt-pie">
      ${activo(f) ? `<button type="button" class="tt-p" data-a="limpiar">${svg('cruz')}Limpiar filtro</button>` : '<span></span>'}
      <button type="button" class="tt-p" data-a="ocultar" title="Esconder esta columna (se recuerda en esta computadora)">${svg('ojoNo')}Ocultar columna</button>
    </div>
    <details class="tt-cols"${P.colsAbierto ? ' open' : ''}><summary>${svg('chev', 'ch')}${svg('columnas')}Columnas${nOc ? ` · ${nOc} oculta${nOc > 1 ? 's' : ''}` : ''}</summary>
      <div class="tt-vals">${otras.map(c => `<label class="tt-v"><input type="checkbox" data-col="${escH(c.id)}"${T.oc.has(c.id) ? '' : ' checked'}><span class="t">${escH(c.nombre)}</span></label>`).join('')}</div>
      ${T.w ? `<button type="button" class="tt-p solo" data-a="anchos" title="Las columnas vuelven al ancho que se acomoda solo">${svg('columnas')}Anchos automáticos</button>` : ''}
    </details>`;
  const todos = P.el.querySelector('input[data-a="todos"]');
  todos.checked = nExcl === 0; todos.indeterminate = nExcl > 0 && nExcl < vals.length;
  filtrarLista();
}
function filtrarLista(){
  if (!POP) return;
  const q = norm((POP.el.querySelector('input.tt-q') || {}).value || '');
  for (const lb of POP.el.querySelectorAll('.tt-vals label.tt-v[data-i]')){
    const v = POP.vals[+lb.dataset.i];
    lb.style.display = !q || (v && v.k.includes(q)) ? '' : 'none';
  }
}
function filtroDe(T, id){ let f = T.st.filtros[id]; if (!f){ f = T.st.filtros[id] = {q: '', excl: new Set(), desde: null, hasta: null, tipo: 'texto'}; } if (!f.excl) f.excl = new Set(); return f; }
function limpiarVacio(T, id){ if (!activo(T.st.filtros[id])) delete T.st.filtros[id]; }
function leerRango(txt, tipo){
  const s = String(txt || '').trim(); if (!s) return null;
  if (tipo === 'fecha'){ const m = s.match(RX_ISO); return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : aFecha(s); }
  const n = aNumero(s); return n == null ? null : n;
}
function alMenu(ev){
  if (!POP) return;
  const T = vivo(POP.T); if (!T){ cerrarMenu(); return; }
  const col = POP.col, x = ev.target;
  const btn = x.closest('button[data-a]');
  if (ev.type === 'click' && btn){
    const a = btn.dataset.a;
    if (a === 'cerrar'){ cerrarMenu(); return; }
    if (a === 'asc' || a === 'desc'){ T.st.orden = {id: col.id, dir: a === 'asc' ? 1 : -1}; aplicar(T); pintarMenu(); return; }
    if (a === 'sinorden'){ T.st.orden = null; aplicar(T); pintarMenu(); return; }
    if (a === 'limpiar'){ delete T.st.filtros[col.id]; aplicar(T); pintarMenu(); return; }
    if (a === 'anchos'){ anchosAuto(T); pintarMenu(); return; }
    if (a === 'ocultar'){ T.oc.add(col.id); guardarOcultas(T); if (T.st.filtros[col.id]) delete T.st.filtros[col.id]; cerrarMenu(); aplicar(T); programarFijo(T); return; }
    return;
  }
  if (x.matches('input[data-col]') && ev.type === 'change'){
    POP.colsAbierto = true;
    if (x.checked) T.oc.delete(x.dataset.col); else T.oc.add(x.dataset.col);
    guardarOcultas(T); aplicar(T); programarFijo(T);
    if (!x.checked && x.dataset.col === col.id){ cerrarMenu(); return; }
    pintarMenu(); return;
  }
  if (x.matches('input[data-a="todos"]') && ev.type === 'change'){
    const f = filtroDe(T, col.id);
    if (x.checked) f.excl.clear(); else for (const v of POP.vals) f.excl.add(v.k);
    limpiarVacio(T, col.id); aplicar(T); pintarMenu(); return;
  }
  if (x.matches('input[data-i]') && ev.type === 'change'){
    const v = POP.vals[+x.dataset.i]; if (!v) return;
    const f = filtroDe(T, col.id);
    if (x.checked) f.excl.delete(v.k); else f.excl.add(v.k);
    limpiarVacio(T, col.id); aplicar(T);
    const nExcl = POP.vals.filter(w => f.excl.has(w.k)).length;
    const todos = POP.el.querySelector('input[data-a="todos"]');
    if (todos){ todos.checked = nExcl === 0; todos.indeterminate = nExcl > 0 && nExcl < POP.vals.length; }
    pintarPie(T, col); return;
  }
  if (x.matches('input.tt-q') && ev.type === 'input'){
    const f = filtroDe(T, col.id); f.q = x.value.trim(); limpiarVacio(T, col.id); aplicar(T); filtrarLista(); pintarPie(T, col); return;
  }
  if ((x.matches('input.tt-d') || x.matches('input.tt-h')) && (ev.type === 'input' || ev.type === 'change')){
    const f = filtroDe(T, col.id); f.tipo = POP.tipo;
    const v = leerRango(x.value, POP.tipo);
    if (x.matches('.tt-d')) f.desde = v; else f.hasta = v;
    limpiarVacio(T, col.id); aplicar(T); pintarPie(T, col); return;
  }
}
// solo el botón «Limpiar filtro» (sin redibujar todo el menú: no se pierde el foco del buscador)
function pintarPie(T, col){
  if (!POP) return;
  const pie = POP.el.querySelector('.tt-pie'); if (!pie) return;
  const hay = activo(T.st.filtros[col.id]);
  const primero = pie.firstElementChild;
  if (hay && primero.tagName !== 'BUTTON'){ const b = document.createElement('button'); b.type = 'button'; b.className = 'tt-p'; b.dataset.a = 'limpiar'; b.innerHTML = svg('cruz') + 'Limpiar filtro'; pie.replaceChild(b, primero); }
  else if (!hay && primero.tagName === 'BUTTON'){ pie.replaceChild(document.createElement('span'), primero); }
}

// ── eventos de las tablas ──
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('th .tt-menu');
  if (!b) return;
  ev.stopPropagation(); ev.preventDefault();   // que no dispare el onclick del título (orden propio de la tabla)
  const th = b.closest('th'), t = th && th.closest('table'), T = t && t._tt; if (!T) return;
  const col = T.cols.find(c => c.th === th); if (!col) return;
  if (POP && POP.boton === b){ cerrarMenu(); return; }
  abrirMenu(T, col, b);
}, true);
document.addEventListener('click', ev => {
  const th = ev.target.closest && ev.target.closest('th.tt-ordenable'); if (!th) return;
  if (ev.target.closest('input,select,textarea,button,a,label,.tt-ui')) return;
  const sel = getSelection && getSelection(); if (sel && String(sel).length > 1 && th.contains(sel.anchorNode)) return;
  const T = th.closest('table') && th.closest('table')._tt; if (!T || T.ordenApp) return;
  const col = T.cols.find(c => c.th === th); if (!col) return;
  const o = T.st.orden;
  T.st.orden = !o || o.id !== col.id ? {id: col.id, dir: 1} : o.dir > 0 ? {id: col.id, dir: -1} : null;
  aplicar(T);
  if (POP && POP.T === T) pintarMenu();
});
['click', 'change', 'input'].forEach(tipo => document.addEventListener(tipo, ev => { if (POP && POP.el.contains(ev.target)){ alMenu(ev); if (tipo === 'click') ev.stopPropagation(); } }, true));
document.addEventListener('toggle', ev => { if (POP && ev.target.matches && ev.target.matches('details.tt-cols')) POP.colsAbierto = ev.target.open; }, true);
document.addEventListener('pointerdown', ev => {
  if (!POP) return;
  if (POP.el.contains(ev.target) || (POP.boton && POP.boton.contains(ev.target))) return;
  cerrarMenu();
}, true);
window.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && POP){ ev.stopPropagation(); ev.preventDefault(); const b = POP.boton; cerrarMenu(); if (b && b.isConnected) b.focus({preventScroll: true}); }
}, true);
document.addEventListener('scroll', ev => { if (POP && !POP.el.contains(ev.target)) posicionar(); }, true);
addEventListener('resize', () => { programarFijo(); if (POP) posicionar(); });

// ── arrastrar el borde del título para cambiar el ancho de la columna ──
let ANCHO = null;
document.addEventListener('pointerdown', ev => {
  const h = ev.target.closest && ev.target.closest('th > .tt-ancho'); if (!h) return;
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  const th = h.parentElement, t = th.closest('table'), T = t && t._tt; if (!T) return;
  const col = T.cols.find(c => c.th === th); if (!col) return;
  ev.preventDefault(); ev.stopPropagation();
  cerrarMenu();
  if (!T.w) congelar(T, null);
  ANCHO = {T, col, h, x0: ev.clientX, w0: T.w[col.id], id: ev.pointerId, movio: false};
  h.classList.add('activo');
  document.documentElement.classList.add('tt-estirando', 'tt-col-res');
  try { document.documentElement.setPointerCapture(ev.pointerId); } catch (e){}
}, true);
document.addEventListener('pointermove', ev => {
  const A = ANCHO; if (!A || ev.pointerId !== A.id) return;
  const w = Math.max(36, Math.round(A.w0 + ev.clientX - A.x0));
  if (w === A.T.w[A.col.id]) return;
  A.movio = true; A.T.w[A.col.id] = w; pintarAnchos(A.T);
}, {passive: true});
function soltarAncho(ev){
  const A = ANCHO; if (!A || (ev && ev.pointerId !== A.id)) return;
  ANCHO = null;
  A.h.classList.remove('activo');
  document.documentElement.classList.remove('tt-estirando', 'tt-col-res');
  guardarAnchos(A.T);
  tragarClick = true; setTimeout(() => { tragarClick = false; }, 0);   // que soltar no ordene la columna
  programarFijo(A.T);
}
document.addEventListener('pointerup', soltarAncho, true);
document.addEventListener('pointercancel', soltarAncho, true);
document.addEventListener('dblclick', ev => {
  const h = ev.target.closest && ev.target.closest('th > .tt-ancho'); if (!h) return;
  ev.stopPropagation(); ev.preventDefault();
  const T = h.closest('table') && h.closest('table')._tt; if (T) anchosAuto(T);
}, true);

// ═══ VENTANAS ESTIRABLES ═══════════════════════════════════════════════
// Solo si el módulo lo pide (window.ADORNO_TABLAS_CONF.ventanas = selector de sus ventanas); si no, nada de esto corre.
const OVS = String((window.ADORNO_TABLAS_CONF || {}).ventanas || '').trim();
const TAM = new Map();     // id de la ventana → tamaño elegido (mientras la página esté abierta)
let ovCache = null, EST = null, tragarClick = false, cursorAct = '';
function cajaDe(ov){
  const c = ov.querySelector(':scope > .c-box');
  if (c) return c;
  const f = ov.firstElementChild;
  return f && !f.classList.contains('tt-ui') ? f : null;
}
function ventanaArriba(){
  if (!OVS) return null;
  if (!ovCache) ovCache = [...document.querySelectorAll(OVS)];
  let mejor = null, z = -Infinity;
  for (const ov of ovCache){
    if (!ov.isConnected) continue;
    const cs = getComputedStyle(ov);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position !== 'fixed') continue;
    const zi = parseInt(cs.zIndex, 10) || 0;
    if (zi >= z){ z = zi; mejor = ov; }
  }
  return mejor;
}
function zonaEn(x, y, tol, objetivo){
  const ov = ventanaArriba(); if (!ov) return null;
  if (objetivo && objetivo.closest && objetivo.closest('.tt-ui, .asist-panel, .asist-fab')) return null;
  const box = cajaDe(ov); if (!box) return null;
  const r = box.getBoundingClientRect(); if (!r.width) return null;
  const fuera = tol, dentro = Math.max(3, tol - 2);
  if (x < r.left - fuera || x > r.right + fuera || y < r.top - fuera || y > r.bottom + fuera) return null;
  const dR = box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).overflowY !== 'visible' ? 2 : dentro;   // no pisar la barra de scroll
  const n = y <= r.top + dentro, s = y >= r.bottom - dentro, w = x <= r.left + dentro, e = x >= r.right - dR;
  const esq = 18;
  let v = n ? 'n' : s ? 's' : '', h = w ? 'w' : e ? 'e' : '';
  if (v && !h){ if (x <= r.left + esq) h = 'w'; else if (x >= r.right - esq) h = 'e'; }
  if (h && !v){ if (y <= r.top + esq) v = 'n'; else if (y >= r.bottom - esq) v = 's'; }
  if (!v && !h) return null;
  return {ov, box, dir: v + h};
}
function ponerCursor(d){
  if (d === cursorAct) return;
  cursorAct = d;
  if (d) document.documentElement.setAttribute('data-tt-borde', d); else document.documentElement.removeAttribute('data-tt-borde');
}
function guardarOriginal(box, r){
  if (box._ttOrig) return;
  box._ttOrig = {w: box.style.width, h: box.style.height, mw: box.style.maxWidth, mh: box.style.maxHeight, ovf: box.style.overflow, alto0: r.height};
}
function empezarEstirar(z, ev){
  const rr = z.box.getBoundingClientRect();
  guardarOriginal(z.box, rr);
  // ventana más alta que la pantalla (crece con lo que tiene y desplaza el fondo): al estirarla de arriba o de abajo
  // pasa a medir lo que se ve, y lo de adentro se desplaza dentro de ella
  let r = {left: rr.left, right: rr.right, width: rr.width, top: rr.top, bottom: rr.bottom, height: rr.height};
  if (/[ns]/.test(z.dir) && (rr.top < 0 || rr.bottom > innerHeight)){
    r.top = Math.max(rr.top, 12); r.bottom = Math.min(rr.bottom, innerHeight - 12); r.height = r.bottom - r.top;
  }
  EST = {ov: z.ov, box: z.box, dir: z.dir, x0: ev.clientX, y0: ev.clientY, r0: r, id: ev.pointerId};
  document.documentElement.classList.add('tt-estirando');
  ponerCursor(z.dir);
  cerrarMenu();
}
function estirar(ev){
  const S = EST; if (!S || ev.pointerId !== S.id) return;
  const dx = ev.clientX - S.x0, dy = ev.clientY - S.y0, r0 = S.r0, d = S.dir, b = S.box;
  const MW = Math.min(340, innerWidth - 8), MH = Math.min(180, innerHeight - 8), M = 4;
  let w = r0.width, h = r0.height, L = r0.left, A = r0.top;
  if (d.includes('e')) w = Math.min(Math.max(r0.width + dx, MW), innerWidth - r0.left - M);
  if (d.includes('w')){ w = Math.min(Math.max(r0.width - dx, MW), r0.right - M); L = r0.right - w; }
  if (d.includes('s')) h = Math.min(Math.max(r0.height + dy, MH), Math.max(innerHeight - r0.top - M, MH));
  if (d.includes('n')){ h = Math.min(Math.max(r0.height - dy, MH), r0.bottom - M); A = r0.bottom - h; }
  b.style.maxWidth = 'none'; b.style.width = Math.round(w) + 'px';
  if (/[ns]/.test(d)){
    b.style.maxHeight = 'none'; b.style.height = Math.round(h) + 'px';
    if (getComputedStyle(b).overflowY === 'visible') b.style.overflow = 'auto';
    b.style.setProperty('--tt-alto', Math.round(h) + 'px');
  }
  // el borde opuesto queda quieto: corrijo lo que mueve el centrado del fondo (mismo translate que usa «mover la ventana»)
  const r = b.getBoundingClientRect();
  b._dx = (b._dx || 0) + (L - r.left); b._dy = (b._dy || 0) + (A - r.top);
  b.style.transform = `translate(${Math.round(b._dx)}px,${Math.round(b._dy)}px)`;
  for (const T of REG) if (b.contains(T.t)) programarFijo(T);
}
function terminarEstirar(ev){
  const S = EST; if (!S || (ev && ev.pointerId !== S.id)) return;
  EST = null;
  document.documentElement.classList.remove('tt-estirando');
  ponerCursor('');
  const b = S.box;
  if (S.ov.id) TAM.set(S.ov.id, {w: b.style.width, h: b.style.height || '', ovf: b.style.overflow || ''});
  tragarClick = true; setTimeout(() => { tragarClick = false; }, 0);
  for (const T of REG) if (b.contains(T.t)) programarFijo(T);
}
function volverTamano(box, ov){
  const o = box._ttOrig; if (!o) return;
  box.style.width = o.w; box.style.height = o.h; box.style.maxWidth = o.mw; box.style.maxHeight = o.mh; box.style.overflow = o.ovf;
  box.style.removeProperty('--tt-alto');
  box._dx = 0; box._dy = 0; box.style.transform = '';   // y a su lugar de siempre
  if (ov && ov.id) TAM.delete(ov.id);
  for (const T of REG) if (box.contains(T.t)) programarFijo(T);
}
function aplicarTam(ov){
  const s = ov.id && TAM.get(ov.id); if (!s) return;
  const box = cajaDe(ov); if (!box || box._ttTam) return;
  box._ttTam = true;
  guardarOriginal(box, box.getBoundingClientRect());
  box.style.maxWidth = 'none'; box.style.width = `min(${s.w}, calc(100vw - 24px))`;
  if (s.h){ box.style.maxHeight = 'none'; box.style.height = `min(${s.h}, calc(100vh - 24px))`; box.style.overflow = s.ovf || 'auto';
    box.style.setProperty('--tt-alto', `min(${s.h}, calc(100vh - 24px))`); }
}
document.addEventListener('pointermove', ev => {
  if (EST){ estirar(ev); return; }
  if (ev.pointerType !== 'mouse' || ev.buttons){ if (cursorAct && !ev.buttons) ponerCursor(''); return; }
  const z = zonaEn(ev.clientX, ev.clientY, 7, ev.target);
  ponerCursor(z ? z.dir : '');
}, {passive: true});
document.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  const z = zonaEn(ev.clientX, ev.clientY, ev.pointerType === 'mouse' ? 7 : 14, ev.target); if (!z) return;
  ev.preventDefault(); ev.stopPropagation();
  try { document.documentElement.setPointerCapture(ev.pointerId); } catch (e){}
  empezarEstirar(z, ev);
}, true);
document.addEventListener('pointerup', terminarEstirar, true);
document.addEventListener('pointercancel', terminarEstirar, true);
// que «mover la ventana» (mousedown/touchstart) no arranque mientras se estira
document.addEventListener('mousedown', ev => { if (EST){ ev.stopPropagation(); ev.preventDefault(); } }, true);
document.addEventListener('touchstart', ev => { if (EST){ ev.stopPropagation(); if (ev.cancelable) ev.preventDefault(); } }, {capture: true, passive: false});
document.addEventListener('touchmove', ev => { if (EST && ev.cancelable) ev.preventDefault(); }, {capture: true, passive: false});
document.addEventListener('click', ev => { if (tragarClick){ tragarClick = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
document.addEventListener('dblclick', ev => {
  const z = zonaEn(ev.clientX, ev.clientY, 7, ev.target); if (!z) return;
  ev.stopPropagation(); ev.preventDefault();
  volverTamano(z.box, z.ov);
}, true);

// ── observar la página ──
const obs = new MutationObserver(muts => {
  if (ocupado) return;
  let buscar = false, ventanas = false;
  const sucias = new Set(), rehacer = new Set();
  for (const m of muts){
    const tg = m.target;
    if (tg === document.body) ovCache = null;
    if (tg.nodeType === 1 && tg.closest && tg.closest('.tt-ui')) continue;
    for (const n of m.addedNodes){
      if (n.nodeType !== 1 || n.classList.contains('tt-ui')) continue;
      const tag = n.tagName;
      if (tag === 'TR'){ const t = n.closest('table'); if (t && t._tt) sucias.add(t._tt); else buscar = true; }
      else if (tag === 'TBODY' || tag === 'TFOOT'){ const t = n.parentElement; if (t && t._tt) sucias.add(t._tt); else buscar = true; }
      else if (tag === 'THEAD'){ const t = n.parentElement; if (t && t._tt) rehacer.add(t); else buscar = true; }
      else if (tag === 'TABLE' || n.getElementsByTagName('table').length) buscar = true;
      if (OVS && n.matches && (n.matches(OVS) || (tg.nodeType === 1 && tg.matches && tg.matches(OVS)))) ventanas = true;
    }
  }
  for (const t of rehacer){ const T = t._tt; if (T){ olvidar(T); t._tt = null; } mejorar(t); }
  if (buscar) escanear();
  for (const T of sucias) if (REG.has(T)) aplicar(T);
  if (ventanas){ ovCache = null; for (const ov of document.querySelectorAll(OVS)) aplicarTam(ov); }
  if (POP && !vivo(POP.T)) cerrarMenu();
});
function arrancar(){
  obs.observe(document.body, {childList: true, subtree: true});
  escanear();
  const ban = document.querySelector('.ab-banner, body > header, #app > header');
  if (ban) RO.observe(ban);
}
if (document.body) arrancar(); else document.addEventListener('DOMContentLoaded', arrancar);

window.ADORNO_TABLAS = {
  version: 2,   // 2 = pieza común (_shared) con cebra; 1 = tablas.js de Compras
  cebra: T => cebra(T),
  recalcular: () => { escanear(); for (const T of REG){ prepararFijo(T); aplicar(T); } },
  _reg: REG, _estado: ESTADO, _tam: TAM,
  _num: aNumero, _fecha: aFecha
};
})();
