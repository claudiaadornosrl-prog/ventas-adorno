// ═══════════════════════════════════════════════════════════════════════
//  Ventas Adorno · manual.js — Manual de uso (overlay 📖, autoinyectable)
//  🚨 REGLA: cada vez que se agrega o cambia una función del módulo,
//  actualizar la sección correspondiente acá (y bump del ?v= en index.html).
//  Se carga después del script principal; ve sus globals (session, etc.).
// ═══════════════════════════════════════════════════════════════════════

function _mEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _manualSecciones() {
  const esAdmin = (typeof session !== 'undefined') && session?.isAdmin;

  const base = [
    {
      icon: '📋', titulo: 'Planilla del mes',
      desc: 'La planilla diaria de ventas del local. Reemplaza la planilla Excel de siempre.',
      pasos: [
        'Cada fila es un día; las columnas son los medios de pago: Efectivo, Tarjeta, QR (Mercado Pago), Vales, y para Oficina también Transferencia y CC.',
        'Los números los carga solo el sistema desde Dragonfish — no hace falta tipear nada. Si un día quedó incompleto, tocá "🐉 Resincronizar mes" en el menú ⋮ (solo actualiza días NO cerrados).',
        'La columna Online en los locales es el efectivo de la segunda base — si hay que corregir a mano, SIEMPRE se corrige en esa columna.',
        'FC Oficina son facturas emitidas en Oficina pero que corresponden a una venta del local — las carga el sistema solo.',
      ],
    },
    {
      icon: '🕐', titulo: 'Turnos',
      desc: 'Cada turno de caja se cierra por separado, contra las transacciones reales del día.',
      pasos: [
        'El botón "🔒 Cerrar turno" aparece cuando el turno tiene ventas cargadas. Solo se puede cerrar el turno de HOY.',
        'El cierre compara fila por fila lo que dice Dragonfish contra las transacciones. Si algo no coincide, revisá antes de cerrar.',
        'El cruce con Mercado Pago NO se hace al cerrar el turno (MP demora horas en publicar los pagos) — se hace al día siguiente.',
      ],
    },
    {
      icon: '🔒', titulo: 'Cierre del día',
      desc: 'El cierre definitivo del día. Se hace DESPUÉS del cierre de caja completo en Dragonfish.',
      pasos: [
        'Primero cerrá la caja en Dragonfish (Z completo), después cerrá el día acá — si no, el día queda congelado con datos viejos.',
        'Al cerrar el día, el sistema cruza automáticamente los pagos de Mercado Pago del día ANTERIOR (ya definitivos).',
        'Si te quedó un día pasado sin cerrar, también lo podés cerrar — el botón 🔒 aparece igual.',
      ],
    },
    {
      icon: '✓', titulo: 'Tilde de Mercado Pago',
      desc: 'Al lado del importe QR/MP de cada día cerrado hay un tilde que muestra cómo dio el cruce contra MP.',
      pasos: [
        '✓ verde: el cruce dio perfecto, no hay nada que hacer.',
        '⚠ naranja: hay una diferencia sin revisar — te va a llegar una notificación. Tocá el ⚠ para ver el detalle.',
        'En el detalle, el botón "Revisar y salvar" te deja marcar la diferencia como JUSTIFICADA (sabés el motivo y lo escribís — obligatorio) o como ERROR.',
        '✔ violeta: diferencia justificada. ✖ rojo: marcada como error. Todo queda registrado con quién y cuándo lo revisó.',
        'Si el sistema recruza el día y la diferencia cambia, la revisión se borra sola y hay que volver a revisar.',
      ],
    },
    {
      icon: '📩', titulo: 'Solicitudes y reaperturas',
      desc: 'Para corregir un dato de un día ya cerrado, no se toca directo: se pide.',
      pasos: [
        'Si un importe está mal en un día cerrado, tocá la celda y "Enviar pedido" — le llega la solicitud de corrección al admin.',
        'Si necesitás reabrir un día entero, usá "🙏 Reaperturas" del menú ⋮.',
        'El admin aprueba o rechaza; te enterás por notificación.',
      ],
    },
    {
      icon: '⋮', titulo: 'Menú de opciones',
      desc: 'Arriba a la derecha, el botón ⋮ agrupa las herramientas extra.',
      pasos: [
        '🔔 Notificaciones: activalas para recibir alertas de cierres y diferencias de MP. En iPhone solo funcionan si la app está instalada en la pantalla de inicio.',
        '🐉 Resincronizar mes: vuelve a traer de Dragonfish los días no cerrados.',
        '⬇ Instalar la app: para tenerla como aplicación en el celu.',
      ],
    },
  ];

  if (esAdmin) {
    base.push({
      icon: '📊', titulo: 'Análisis y consolidado (admin)',
      desc: 'Vista comparativa de los 3 locales, solo para administración.',
      pasos: [
        'Entrando sin local (o con "Todos") se ve el consolidado de los 3 locales.',
        'El botón "📊 Análisis" abre gráficos de evolución, comparativas por medio de pago y por local.',
        '"📊 Reporte semanal/mensual" (menú ⋮): el reporte profundo por categorías — KPIs comparados contra el período anterior y el año pasado, drill-down Grupo→Subcategoría→Clasificación, top artículos/proveedores/clientes, mapa de calor por hora y recomendación del gerente. Se genera solo los martes a la madrugada; historia desde 2019.',
        '"🔒 Cerrar mes" congela el mes completo; "🔓 Reabrir mes" lo habilita de nuevo.',
        'Las solicitudes de corrección de las chicas llegan a "📩 Solicitudes" del menú ⋮.',
      ],
    });
  }
  return base;
}

function abrirManual() {
  if (document.getElementById('manual-overlay')) return;
  const items = _manualSecciones();
  const ov = document.createElement('div');
  ov.id = 'manual-overlay';
  ov.innerHTML = `
    <div class="m-box">
      <div class="m-head">
        <span style="font-size:22px;">📖</span>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:16px;">Manual · Ventas</div>
          <div style="font-size:12px;opacity:.85;">Guía rápida de cada herramienta del módulo</div>
        </div>
        <button class="m-close" onclick="cerrarManual()">✕</button>
      </div>
      ${items.map((s, i) => `
        <div class="m-sec">
          <div class="m-tit">${s.icon} ${i + 1}. ${_mEsc(s.titulo)}</div>
          <div class="m-desc">${_mEsc(s.desc)}</div>
          <ul class="m-pasos">${s.pasos.map(p => `<li>${_mEsc(p)}</li>`).join('')}</ul>
        </div>`).join('')}
      <div class="m-foot">💡 Este manual se actualiza junto con el sistema. ¿Falta algo o no funciona? Avisale a JP.</div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) cerrarManual(); });
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
}

function cerrarManual() {
  const ov = document.getElementById('manual-overlay');
  if (ov) ov.remove();
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarManual(); });

(function _manualInit() {
  const css = document.createElement('style');
  css.textContent = `
    #manual-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px;overflow-y:auto;-webkit-overflow-scrolling:touch;}
    #manual-overlay .m-box{background:#f8fafc;border-radius:14px;max-width:760px;width:100%;padding-bottom:6px;box-shadow:0 20px 60px rgba(0,0,0,.3);}
    #manual-overlay .m-head{position:sticky;top:0;background:#16a34a;color:#fff;padding:14px 18px;border-radius:14px 14px 0 0;display:flex;align-items:center;gap:10px;z-index:1;}
    #manual-overlay .m-close{background:rgba(255,255,255,.18);border:none;color:#fff;font-size:16px;border-radius:8px;padding:6px 11px;cursor:pointer;}
    #manual-overlay .m-sec{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #16a34a;border-radius:10px;margin:14px 14px 0;padding:14px 18px;}
    #manual-overlay .m-tit{font-weight:700;font-size:15px;margin-bottom:4px;color:#14532d;}
    #manual-overlay .m-desc{font-size:13px;color:#475569;margin-bottom:8px;}
    #manual-overlay .m-pasos{margin:0 0 2px 18px;padding:0;font-size:13px;line-height:1.65;color:#334155;}
    #manual-overlay .m-pasos li{margin-bottom:4px;}
    #manual-overlay .m-foot{margin:16px 14px 12px;background:#fef3c7;border-left:4px solid #d97706;border-radius:8px;padding:11px 14px;font-size:12.5px;color:#92400e;}`;
  document.head.appendChild(css);

  const kebab = document.getElementById('kebab-menu');
  if (kebab) {
    const b = document.createElement('button');
    b.textContent = '📖 Manual';
    b.onclick = () => { if (typeof cerrarKebab === 'function') cerrarKebab(); abrirManual(); };
    kebab.appendChild(b);
  }
})();
