// ═══════════════════════════════════════════════════════════════════════
//  Ventas Adorno · manual.js — Manual de uso (overlay 📖, autoinyectable)
//  🚨 REGLA: cada vez que se agrega o cambia una función del módulo,
//  actualizar la sección correspondiente acá (y bump del ?v= en index.html).
//  Se carga después del script principal; ve sus globals (session, etc.).
// ═══════════════════════════════════════════════════════════════════════

function _mEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// (24-oct, regla JP 21-oct) Íconos de sección en SVG (currentColor), no emojis.
const _M_ICO = {
  lock:     '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  planilla: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  check:    '<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
  inbox:    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  menu:     '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  chart:    '<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="7"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="3" width="3" height="15"/>',
  book:     '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
};
function _mIco(n) {
  return `<svg class="m-ico" viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">${_M_ICO[n] || _M_ICO.book}</svg>`;
}

function _manualSecciones() {
  const esAdmin = (typeof session !== 'undefined') && session?.isAdmin;

  const base = [
    { icon: 'menu', titulo: 'La barra de arriba', desc: 'Es igual en todos los módulos: mismo lugar para cada cosa y el color de la moneda del módulo (el mismo del Hub).',
      pasos: ['A la izquierda, la moneda y el nombre del módulo. En la computadora, tocando el nombre (Ventas ▾) se abre la lista para pasar a otro módulo; al final de esa lista está «Volver al Hub».', 'Al lado: el local, el mes que estás mirando (se cambia ahí mismo), si está Abierto o Cerrado y los totales del mes.', 'A la derecha: el Reporte (ícono de barritas) y el menú ⋮ (Resincronizar mes, Solicitudes, Reaperturas, Cerrar o Reabrir mes). Las notificaciones se activan desde el Hub.', 'En el celular los totales no se ven en la barra (están en la pantalla); a la vista quedan el menú ⋮ y 🏠 Hub (volver al Hub).', 'Para cerrar la sesión: volvé al Hub y tocá 👤 (arriba) → Salir; se cierra en todos los módulos. En los módulos no hay botón de Salir.', '¿Dudas? Preguntale a Clodi (el botón de abajo a la derecha): sabe todo lo que dice este manual.', 'Para hablarle a Clodi (15-nov): mantené apretado el micrófono (con el dedo, el mouse o la barra espaciadora) mientras hablás, aunque hagas pausas, y soltalo para mandar la pregunta. También le podés escribir.', 'Avisos de error (16-nov, igual en todos los módulos): cuando algo falla aparece un cartel rojo arriba, en castellano simple (por ejemplo "No hay conexión con el sistema. Revisá internet y probá de nuevo."). No se va solo: se cierra con la ✕. Si el mismo aviso se repite, muestra ×2, ×3. "Ver detalle técnico" tiene el mensaje original, para pasárselo a JP si hace falta. Los avisos de que algo salió bien siguen yéndose solos.'] },
    {
      icon: 'lock', titulo: 'Entrar una sola vez',
      desc: 'La sesión se comparte entre todos los módulos del sistema.',
      pasos: [
        'En el Hub, con el ícono 👤 de arriba, ingresás con tu usuario y podés tildar "Confiar en esta computadora".',
        'Con eso tildado, entrás a todos los módulos de ese equipo sin volver a escribir la clave.',
        'Código del celular (doble factor): si sos admin o directora y lo activaste en el Hub (panel de sesión, "Código del celular al entrar"), en cada computadora te pide, después de la clave, el código de 6 números de la app de autenticación del celular (Google o Microsoft Authenticator), y después una vez cada 30 días. En el celular registrado con "Entrar con la cara en este equipo" no hace falta ni clave ni código: te pide la cara (o la huella) al abrir. Si cambiás o perdés el celular, avisale a JP para darlo de baja.',
        'En las computadoras de los locales, que usan varias personas, NO se tilda: cada módulo sigue pidiendo usuario y contraseña por separado.',
        'Oficina tiene dos cuentas (12-nov): en la pantalla de entrada de Ventas, al tocar Oficina aparecen dos pastillas, Analía (claudiaadorno@) y Marisa (administracion@). Tocás la de tu compu y ponés su contraseña; la compu recuerda la última que entró.',
        'La sesión se cierra desde el Hub (👤 → Salir) y se cierra en todos los módulos. La computadora sigue marcada como de confianza hasta que lo apagues desde el Hub.',
        'También se puede entrar a Ventas con el usuario personal (13-nov): en la pantalla de entrada, "Entrar con tu usuario personal". Lo que ves y lo que podés hacer lo deciden tus permisos del Hub (si tu perfil no ve la planilla, ves solo el Reporte).',
      ],
    },
    {
      icon: 'lock', titulo: 'Permisos (desde el Hub)',
      desc: 'Lo que cada usuario ve y puede hacer en Ventas lo maneja JP en el Hub → ícono de persona → Permisos, función por función (13-nov).',
      pasos: [
        'Cada función puede estar Habilitada (se usa normal), Pide permiso (aparece, pero al usarla tiene que autorizar alguien con permiso) u Oculta (no aparece).',
        'Apartados (15-nov): en Hub → Permisos → Perfiles, cada apartado de Ventas ("Planilla del día", "Correcciones y cierres", "Reporte" y "Otros locales") tiene su interruptor, igual que el del módulo. Si está apagado para un perfil, todas las funciones de ese apartado quedan ocultas para ese perfil, aunque sea admin (es para Clau: puede hacer y autorizar todo, pero ve solo lo que JP le deja prendido). JP ve todo. Al volver a prenderlo, cada función queda como estaba.',
        'Ver como (16-nov, solo JP): desde el Hub, JP puede entrar a Ventas viendo lo que ve otra cuenta (arriba dice "Viendo como …" y el botón Salir). Es solo para mirar: ve la planilla, los locales y los botones de esa cuenta, y si una función pide permiso se abre la ventana igual. Pero ahí no se autoriza, no se prende la cámara (en "¿Quién cierra?" aparece la lista) y no se graba nada: al llegar a guardar, cerrar o sincronizar aparece "Estás en «Ver como»: es solo lectura, acá no se graba nada."',
        'Las funciones de Ventas: ver la planilla, cerrar un turno, cerrar el día, cargar la Factura Oficina, justificar una diferencia con Mercado Pago, resincronizar desde el Dragonfish, cambiar a mano cualquier importe, pedir una corrección, pedir una reapertura, aprobar correcciones, reabrir días y cerrar o reabrir el mes, ver los días cerrados que cambiaron, ver el Reporte, ver el interanual y los últimos 5 años, ver los otros locales y operar en otros locales.',
        '"Pide permiso" (desde el 15-nov, la ventana común del Hub, igual en todos los módulos): autoriza alguien que tenga esa función Habilitada y ese local entre los suyos, o un dueño. Primero la CARA: la cámara lee en segundo plano (no se muestra el video) y, si quien está frente a la compu puede autorizarlo, aparece "Autorizado por …" y queda registrado con su nombre (no se guarda ninguna foto). Si no anda la cámara o esa persona no está, aparece la lista de quién puede autorizar (los que están en el local según el reloj o el turno, y los que no) y con "Pedir a…" le llega un aviso al celu para Aceptar o Rechazar; se espera hasta 3 minutos. Si no tiene el celu a mano, escribe ahí SU mail y SU clave personal (los de Colaboradores; si tiene el código del celular, también el código). La autorización sirve para esa sola operación y por 10 minutos, y queda anotado quién autorizó y cómo (cara, celu o clave). Se pide siempre con la cuenta que está usando Ventas en esa compu, aunque en el Hub haya otra cuenta abierta. Las cuentas de los locales y de la oficina nunca autorizan, y nadie se autoriza a sí mismo.',
        'Lo que se hace con la sesión de quien autoriza (abrir el Reporte, aprobar correcciones, cambiar importes a mano, cerrar o reabrir el mes o un día, ver los días cerrados que cambiaron) sigue con la ventana de mail y clave. Si el Hub no carga, también.',
        'Locales: cada persona tiene uno o varios locales en el Hub. Con uno, trabaja en ese; con varios, arriba se elige en cuál está trabajando. Ver o cargar en los otros locales son funciones aparte ("ver los otros locales" y "operar en otros locales"). A alguien se le puede sumar un local solo para mirar con el permiso "ventas_ver_<local>" del Hub (Andrea: ventas_ver_unicenter y, desde el 14-nov, ventas_ver_oficina): aparece en el selector como "Unicenter · solo ver" u "Oficina · solo ver" y ahí no tiene botones para cerrar, pedir ni cargar. Sigue trabajando en su local aunque mire otro.',
        'Lo controla también la base: aunque alguien intente saltearse la pantalla, la base no deja cerrar, pedir ni cambiar nada sin el permiso (o la autorización).',
        'Registra quién (14-nov): si JP marcó una función con 📷 Registra quién en el Hub, al usarla se anota quién la está haciendo: la cámara lee la cara en segundo plano y aparece "Anotado: tu nombre" (desde el 15-nov no se muestra la cámara); si no te reconoce, tocás tu nombre en la lista. Con usuario personal se anota solo. Si cerrás esa ventana, la operación no se hace. No se guarda ninguna foto: queda quién, cuándo, con qué cuenta y qué se hizo, y JP lo ve en el Hub → Permisos → Registro. Mientras las caras estén apagadas, se elige el nombre en la lista.',
        'En Ventas se anota: cerrar un turno, cerrar el día, cargar la Factura Oficina, justificar una diferencia con Mercado Pago, resincronizar desde el Dragonfish, cambiar un importe a mano, pedir una corrección o una reapertura, aprobar o rechazar correcciones, cerrar o reabrir el mes, reabrir un día, resolver una reapertura y marcar como visto un día cerrado que cambió. Mirar la planilla o el Reporte no se anota.',
      ],
    },
    {
      icon: 'planilla', titulo: 'Planilla del mes',
      desc: 'La planilla diaria de ventas del local. Reemplaza la planilla Excel de siempre.',
      pasos: [
        'Cada fila es un día; las columnas son los medios de pago: Efectivo, Tarjeta, QR (Mercado Pago), Vales, y para Oficina también Transferencia y CC.',
        'Los importes se ven con el signo $ (11-nov): en la planilla, en los totales, en los turnos y en los avisos. La cantidad de tickets va sin signo, porque no es plata.',
        'Qué locales ve cada uno sale de sus permisos del Hub (13-nov): la cuenta de Alcorta ve Alcorta y la de Unicenter, Unicenter. Las dos cuentas de Oficina (claudiaadorno@ y administracion@) ven y cargan los 3 locales: arriba eligen el local con las tarjetas o miran el consolidado. Cerrar o reabrir el mes, aprobar pedidos, reabrir días y cambiar importes a mano son funciones aparte (hoy, solo administración). Lo controla la base, no solo la pantalla.',
        'Si el mes elegido no tiene días cargados, arriba de la grilla aparece un aviso con el motivo: mes futuro, mes en curso sin ventas todavía, mes viejo del que solo se conoce el total mensual, o mes en que el local no operaba.',
        'Los números los carga solo el sistema desde Dragonfish — no hace falta tipear nada. Si un día quedó incompleto, tocá "Resincronizar mes" en el menú ⋮ (solo actualiza días NO cerrados).',
        'Nadie cambia un importe directo salvo quien tenga "Cambiar a mano cualquier importe" en el Hub (hoy, administración): la base no deja escribir la planilla de otra forma. Los números los graba el sistema: el sync de Dragonfish, el cierre del turno y el cierre del día. Si un número está mal, tocás la celda y pedís la corrección; la aprueba quien tenga "Aprobar correcciones".',
        'La columna Online en los locales es el efectivo de la segunda base — si hay que corregir a mano, SIEMPRE se corrige en esa columna.',
        'FC Oficina son facturas emitidas en Oficina pero que corresponden a una venta del local — las carga el sistema solo. Quien tenga "Cargar la Factura Oficina del día" toca la celda en un día abierto y la carga (pasa por la base, que controla el permiso). En un día cerrado se pide la corrección como cualquier otra celda.',
      ],
    },
    {
      icon: 'clock', titulo: 'Turnos',
      desc: 'Cada turno de caja se cierra por separado, contra las transacciones reales del día.',
      pasos: [
        'Los botones de cada día son solo íconos, sin recuadro: pasá el mouse (o dejá el dedo apoyado) para ver qué hace cada uno. El reloj rojo cierra el turno y aparece solo en el día de HOY.',
        'El cierre compara fila por fila lo que dice Dragonfish contra las transacciones. Si algo no coincide, revisá antes de cerrar.',
        'El cruce con Mercado Pago NO se hace al cerrar el turno (MP demora horas en publicar los pagos) — se hace al día siguiente.',
      ],
    },
    {
      icon: 'lock', titulo: 'Cierre del día',
      desc: 'El cierre definitivo del día. Se hace DESPUÉS del cierre de caja completo en Dragonfish.',
      pasos: [
        'Primero cerrá la caja en Dragonfish (Z completo), después cerrá el día acá — si no, el día queda congelado con datos viejos.',
        'Si en el Hub "Cerrar el día" (o "Cerrar un turno") de tu cuenta está en "Pide permiso", al tocar el candado (o el reloj) primero hace falta una autorización: la cámara lee en segundo plano la cara de la encargada (o de quien tenga permiso) y aparece "Autorizado por …"; si no la reconoce o no está, aparece la ventana para pedírselo al celu o que escriba su usuario y clave. Recién ahí seguís con "¿Quién cierra?". Tenés 10 minutos para terminar.',
        'Quién cierra (desde el 15-nov sin mostrar la cámara): al tocar el candado rojo aparece la ventana "Cerrar el día" con "Un momento…". La cámara lee tu cara en segundo plano (no se ve el video ni el círculo; la lucecita de la cámara sí se prende) y en uno o dos segundos aparece "✓ Cierra: tu nombre". Tocás "Cerrar el día". Si no sos vos, "No soy yo" abre la lista. La cara es la misma que se registra en el POS (Ajustes → "Quién emite"); acá no se registra y no se guarda ninguna foto.',
        'Si la cámara no anda o no te reconoce en unos 7 segundos, aparece sola la lista de la gente del local: tocás tu nombre y después "Cerrar el día". Ese cierre queda marcado como elegido a mano (el tilde se ve en color ámbar). Desde la lista, "Probar de nuevo con la cara" vuelve a intentar.',
        'Reconocimiento por cara: estuvo apagado del 13 al 15-nov y JP lo volvió a prender la noche del 15. Si se apaga desde el Hub, no se usa la cámara. Aparece directo la lista para elegir a mano quién cierra (con "Elegir a otra persona" si te equivocaste) y el cierre queda marcado como elegido a mano, en ámbar. Cuando se vuelva a prender, la cámara vuelve sola.',
        'Si "Cerrar el día" tiene 📷 Registra quién en el Hub, queda anotada la persona que elegiste (o que reconoció la cámara) en "¿Quién cierra?": no se pregunta dos veces. Si la reconoció la cámara, la base vuelve a comparar la cara y lo anota como "por la cara"; si se eligió a mano, como "de la lista". Desde la cuenta de admin se anota el admin.',
        'En la planilla, el tilde del día cerrado muestra el nombre de quien cerró (pasá el mouse para ver si fue con la cámara o a mano, y la hora), y el aviso de cierre que le llega al admin también lo dice. Desde la cuenta de admin se cierra sin cámara.',
        'Desde Oficina (12-nov) también se puede cerrar el día de cualquier local: la cámara reconoce a quien cierra y, si se elige a mano, la lista trae a la gente de ese local y a la de tus locales (para Oficina, la de la oficina).',
        'Al cerrar el día, el sistema cruza automáticamente los pagos de Mercado Pago del día ANTERIOR (ya definitivos).',
        'Si te quedó un día pasado sin cerrar, también lo podés cerrar — el candado rojo aparece igual. El ojo abre el detalle de los turnos; el candado abierto (admin) reabre el día; la llave violeta le pide la reapertura al admin.',
      ],
    },
    {
      icon: 'check', titulo: 'Tilde de Mercado Pago',
      desc: 'Al lado del importe QR/MP de cada día cerrado hay un tilde que muestra cómo dio el cruce contra MP.',
      pasos: [
        '✓ verde: el cruce dio perfecto, no hay nada que hacer.',
        '⚠ naranja: hay una diferencia sin revisar — te va a llegar una notificación. Tocá el ⚠ para ver el detalle.',
        'En el detalle, el botón "Revisar y salvar" te deja marcar la diferencia como JUSTIFICADA (sabés el motivo y lo escribís — obligatorio) o como ERROR. Aparece si tenés "Justificar una diferencia con Mercado Pago"; si pide permiso, al guardar autoriza alguien con permiso (con la cara, desde el celu o con su clave).',
        '✔ violeta: diferencia justificada. ✖ rojo: marcada como error. Todo queda registrado con quién y cuándo lo revisó.',
        'Si el sistema recruza el día y la diferencia cambia, la revisión se borra sola y hay que volver a revisar.',
      ],
    },
    {
      icon: 'inbox', titulo: 'Solicitudes y reaperturas',
      desc: 'Para corregir un dato de un día ya cerrado, no se toca directo: se pide.',
      pasos: [
        'Si un importe está mal, tocá la celda y "Enviar pedido" — le llega la solicitud de corrección al admin. Si en el Hub "Pedir que corrijan un importe" (o "Pedir que reabran un día cerrado") pide permiso, al enviar autoriza alguien con permiso (con la cara, desde el celu o con su clave).',
        'Si necesitás reabrir un día entero, usá "Reaperturas" del menú ⋮.',
        'Apenas lo pedís, a JP y a Clau les llega un aviso al celular con el local, el día, el importe y quién lo pidió (12-nov; antes ese aviso no salía). Lo mismo cuando se completa el sync de fin de mes de un mes que todavía no se cerró.',
        'El admin aprueba o rechaza. Cómo quedó lo ves en la planilla: la celda corregida queda amarilla (pasando el mouse se ve el antes y el después) y en ⋮ → Reaperturas ves el estado de tus pedidos.',
      ],
    },
    {
      icon: 'menu', titulo: 'Menú de opciones',
      desc: 'Arriba a la derecha, el botón ⋮ agrupa las herramientas extra.',
      pasos: [
        'Notificaciones (11-nov): ya no están en este menú, van por el Hub. En el Hub tocá la campanita 🔔 de arriba y prendé el interruptor de Ventas para recibir las alertas de cierres y de diferencias de MP. En iPhone solo funcionan si el Hub está instalado en la pantalla de inicio.',
        'Resincronizar mes: vuelve a traer de Dragonfish los días no cerrados.',
        '⬇ Instalar la app: para tenerla como aplicación en el celu.',
      ],
    },
  ];

  if (!esAdmin) {
    base.push({
      icon: 'chart', titulo: 'Reporte',
      desc: 'El reporte de ventas. Depende de "Ver el Reporte" en el Hub: habilitado se abre directo; si pide permiso, entra con su usuario quien tenga permiso.',
      pasos: [
        'Arriba a la derecha, el ícono de barras (Reporte). En las cuentas de los locales y de la oficina pide permiso: escribe SU mail y SU clave personal (los mismos de Colaboradores) alguien con permiso y, si su cuenta tiene el código del celular, también el código. Así no lo ve cualquiera que use la compu.',
        'Quién puede abrirlo: administración, las encargadas (Andrea y Soraya) y quien tenga el permiso del Hub para el reporte (Marisa y Analía, con sus usuarios personales). Lo que se ve lo decide la base con el usuario de quien lo abrió: la encargada ve su local y, si JP se lo habilita, otro más para mirar (Andrea ve Alcorta y Unicenter, 13-nov); administración y quien tiene el permiso ven los 3 locales y el consolidado. "Últimos 5 años" y "Evolución del año" aparecen si quien lo abrió tiene "Ver el interanual y los últimos 5 años" (o el permiso completo del reporte). Desde el Reporte no se opera nada: es solo para mirar.',
        'La encargada ve su local: KPIs contra el período anterior y el año pasado, día más fuerte y más flojo, categorías, top artículos, proveedores y clientes, medios de pago y mapa de calor por hora.',
        'Arriba elegís el período: Semanal, Mensual, Trimestral o Anual. El botón "$ nominal" pasa los importes a pesos de hoy con el IPC, para comparar períodos separados en el tiempo.',
        'Al cerrar el reporte (✕ o Escape) se cierra tu sesión: no queda abierta en la computadora del local. Si lo dejás abierto 15 minutos sin tocar, se cierra solo. No te cierra la sesión de Colaboradores en el celular.',
      ],
    });
  }

  // (15-nov) si a esta cuenta de admin le ocultaron el Reporte en el Hub (Clau), no se le explica
  if (esAdmin && !(typeof puedo === 'function' && puedo('ventas.reporte') === 'o')) {
    base.push({
      icon: 'chart', titulo: 'Análisis y consolidado (admin)',
      desc: 'Vista comparativa de los 3 locales, solo para administración.',
      pasos: [
        'Entrando sin local (o con "Todos") se ve el consolidado de los 3 locales.',
        'Lo que antes era el botón "Análisis" ahora está adentro del Reporte, como tipo "Evolución del año": elegís el mes y el local, y ves la proyección de cierre del mes, el acumulado del año contra el anterior (nominal y en pesos de hoy por IPC), la venta mes a mes contra el año pasado, la comparativa de los tres locales, el mix de medios de pago por mes, el ticket promedio por mes, la estacionalidad histórica y la venta por día de la semana.',
        'En las tarjetas del Reporte, al pasar el mouse por una comparación ("ant." o "A/A") se ve el valor de cada período: la venta en pesos, o la cantidad si es tickets, unidades o SKUs.',
        'En el banner de arriba, el ícono de la casa vuelve al Hub y el ícono de barras abre el Reporte (22-oct).',
        'Período en curso (22-oct): cuando el mes, trimestre o semana todavía no terminó, las comparaciones "ant." y "A/A" del Reporte se hacen contra el mismo tramo (del 1 al día de hoy) del período anterior y del año pasado, no contra el período entero; el tramo "(1 al 22)" se ve en la nota al pasar el mouse por la comparación. Unidades, UPT, SKUs, ticket máximo y venta blue no tienen esa comparación por tramo.',
        '"Reporte" (el ícono de barras del banner): el reporte profundo por categorías — KPIs comparados contra el período anterior y el año pasado (incluido UPT, unidades por ticket), día más fuerte y más flojo, drill-down Grupo→Subcategoría→Clasificación, top artículos/proveedores/clientes y mapa de calor por hora.',
        'Arriba de todo aparece el Análisis de la semana: diagnóstico, las acciones concretas y las cosas raras para mirar. Se escribe los lunes a la mañana, después de que se generan los números de madrugada.',
        'El primer selector elige el período: Semanal, Mensual, Trimestral, Anual (año calendario) o "Últimos 5 años". En los períodos largos las barras se agrupan por mes en vez de por día, para que se puedan leer.',
        'El botón "$ nominal" de arriba a la derecha pasa todo a pesos de hoy usando el IPC. Sirve para comparar períodos separados en el tiempo: en pesos de cada momento, un año viejo siempre parece chico aunque se haya vendido más. Los meses que el INDEC todavía no publicó van sin ajustar y la pantalla lo avisa — no se inventa inflación.',
        'En la planilla consolidada, las columnas de cada local van con su color (Alcorta verde, Unicenter azul, Oficina gris), igual que las tarjetas de arriba. Al entrar a un local, la barra de arriba, los encabezados de la planilla y la fila total toman el color de ese local. Las tarjetas de Total general, Alcorta, Unicenter y Oficina siguen arriba adentro de cada local (la que estás viendo queda marcada); tocás otra para saltar, o Total general para volver al consolidado.',
        'Cada local tiene su color en el reporte: Alcorta verde, Unicenter azul, Oficina gris (el consolidado va en pizarra). La barra de arriba, las barras de venta por día, el mapa de calor y las categorías toman el color del local que elegiste, y en "Últimos 5 años" cada fila de la tabla Por local lleva su color.',
        'Las tarjetas Venta por origen y Venta por material salen de dos campos del alta de Dragonfish que el reporte no usaba: Familia (que la empresa usa como país de origen) y Material. Se muestran tal como están cargados: si ves un rubro o un país mal escrito en la lista de orígenes, eso es un dato para corregir en el alta.',
        'El artículo PRUEBA (el comodín de $1 que se usa para cobrar fletes y extras) queda AFUERA de todo el reporte: no es venta de productos y rompía unidades, categorías y tops. Si en el período hubo cargas con PRUEBA, un aviso dice cuánto se excluyó. La planilla de ventas diarias sí lo incluye, porque es plata cobrada.',
        'Si aparece la tarjeta Artículos sin categoría, son artículos que no tienen Grupo cargado en Dragonfish y por eso no caen en ningún rubro del cuadro de Categorías. Cargándoselo allá desaparecen del reporte siguiente solos.',
        'A una encargada se le puede sumar otro local para mirar en el Reporte con el permiso "ventas_ver_<local>" del Hub (Andrea tiene ventas_ver_unicenter desde el 13-nov y ventas_ver_oficina desde el 14-nov). Es solo para ver: no la deja operar ese local.',
        'Las encargadas (Andrea y Soraya) también lo ven, solo de su local y sin "Últimos 5 años": desde el ícono de barras del local, entrando con su usuario personal. La base las filtra: con la cuenta del local (alcorta@/unicenter@) no se ve nada. (12-nov) Desde las cuentas de Oficina también se abre con usuario personal (se valida con hub_puede_ver): administración y quien tenga el permiso "reporte_ventas" en el Hub (Marisa y Analía) ven todo; la cuenta genérica sola no ve nada.',
        '"Últimos 5 años" es otra vista: venta por año, los años superpuestos mes a mes para ver la estacionalidad, la comparación por local, y qué categorías ganaron o perdieron participación. Arranca en 2023 porque el Dragonfish no conserva completa la historia anterior de los locales, y el reporte lo dice en vez de dibujar una tendencia que no es.',
        '"Cerrar mes" congela el mes completo; "Reabrir mes" lo habilita de nuevo.',
        'Los primeros días de cada mes aparecen dos avisos arriba: "Falta el sync de fin de mes" (con el botón Sincronizar ahora, que le pide al sistema del local que vuelva a traer el mes entero) y "listo para cerrar". Un mes cuenta como sincronizado si tiene cargado su último día o si se sincronizó entero después de que terminó: así Oficina, que no abre fines de semana, no queda trabada cuando el mes termina en sábado o domingo. Si el sistema del local está apagado, el pedido queda en espera hasta que se prenda.',
        'Las solicitudes de corrección de las chicas llegan a "Solicitudes" del menú ⋮.',
        '"Días cerrados que cambiaron" (menú ⋮): cada mañana el sistema de cada local compara los últimos 7 días ya cerrados contra Dragonfish. Si un día cambió después del cierre (una factura cargada al otro día, una venta borrada), aparece acá con el detalle por columna y te llega un aviso. La planilla no se corrige sola: mirá el caso, corregí a mano si corresponde y marcalo como visto.',
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
        <svg viewBox="0 0 24 24" aria-hidden="true" style="width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:16px;">Manual · Ventas</div>
          <div style="font-size:12px;opacity:.85;">Guía rápida de cada herramienta del módulo</div>
        </div>
        <button class="m-close" onclick="cerrarManual()">✕</button>
      </div>
      ${items.map((s, i) => `
        <div class="m-sec">
          <div class="m-tit">${_mIco(s.icon)}${i + 1}. ${_mEsc(s.titulo)}</div>
          <div class="m-desc">${_mEsc(s.desc)}</div>
          <ul class="m-pasos">${s.pasos.map(p => `<li>${_mEsc(p)}</li>`).join('')}</ul>
        </div>`).join('')}
      <div class="m-foot">Este manual se actualiza junto con el sistema. ¿Falta algo o no funciona? Avisale a JP.</div>
    </div>`;
  document.body.appendChild(ov);
  _manualLupa(ov);
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
    b.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><span>Manual</span>';   // (24-oct) ícono SVG, regla JP
    b.onclick = () => { if (typeof cerrarKebab === 'function') cerrarKebab(); abrirManual(); };
    kebab.appendChild(b);
  }
})();

// ── 🔍 Lupa del manual (29-sep, pedido Contreras): busca por palabra, sin tildes ni mayúsculas.
//    Deja solo las secciones que la contienen, dentro de ellas los pasos que la contienen,
//    y resalta la palabra. Mismo bloque en todos los módulos (el de RRHH usa _mLupaFiltrar).
function _mLupaNorm(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function _mLupaMarcar(el, q){
  const nodos = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) nodos.push(w.currentNode);
  nodos.forEach(n => {
    const t = n.nodeValue; let norm = '', mapa = [];
    for (let i = 0; i < t.length; i++){ const c = _mLupaNorm(t[i]); for (let k = 0; k < c.length; k++){ norm += c[k]; mapa.push(i); } }
    let desde = 0, pos, frag = null, ult = 0;
    while (q && (pos = norm.indexOf(q, desde)) >= 0){
      frag = frag || document.createDocumentFragment();
      const a = mapa[pos], b = mapa[pos + q.length - 1] + 1;
      if (a > ult) frag.appendChild(document.createTextNode(t.slice(ult, a)));
      const m = document.createElement('mark'); m.textContent = t.slice(a, b);
      m.style.cssText = 'background:#fde047;color:inherit;padding:0 1px;border-radius:3px'; frag.appendChild(m);
      ult = b; desde = pos + q.length;
    }
    if (frag){ if (ult < t.length) frag.appendChild(document.createTextNode(t.slice(ult))); n.parentNode.replaceChild(frag, n); }
  });
}
function _mLupaFiltrar(cont, selSec, texto, info){
  if (!cont) return;
  const q = _mLupaNorm(String(texto || '').trim());
  let vistas = 0;
  cont.querySelectorAll(selSec).forEach(sec => {
    if (sec.dataset.mOrig == null) sec.dataset.mOrig = sec.innerHTML; else sec.innerHTML = sec.dataset.mOrig;
    if (!q){ sec.style.display = ''; return; }
    const lis = [...sec.querySelectorAll('li')];
    const enLis = lis.filter(li => _mLupaNorm(li.textContent).includes(q));
    const hay = _mLupaNorm(sec.textContent).includes(q);
    sec.style.display = hay ? '' : 'none';
    if (!hay) return;
    vistas++;
    if (enLis.length) lis.forEach(li => { if (!enLis.includes(li)) li.style.display = 'none'; });
    _mLupaMarcar(sec, q);
  });
  if (info) info.textContent = !q ? '' : vistas ? `${vistas} ${vistas === 1 ? 'sección' : 'secciones'} con «${String(texto).trim()}»` : `No encontré «${String(texto).trim()}» en el manual.`;
  const primera = q && cont.querySelector('mark');
  if (primera) primera.scrollIntoView({block: 'center', behavior: 'smooth'});
}
function _manualLupa(ov){
  const head = ov && ov.querySelector('.m-head'); if (!head) return;
  head.style.flexWrap = 'wrap';
  const box = document.createElement('div');
  box.style.cssText = 'flex-basis:100%;display:flex;gap:8px;align-items:center;margin-top:8px';
  box.innerHTML = '<input type="search" placeholder="Buscar en el manual (por ej.: turno, cierre, corrección)…" '
    + 'style="flex:1;min-width:0;padding:8px 11px;border-radius:9px;border:none;font-size:14px;color:#0f172a;font-family:inherit">'
    + '<span class="m-lupa-info" style="font-size:12px;opacity:.9;white-space:nowrap"></span>';
  head.appendChild(box);
  const inp = box.querySelector('input'), info = box.querySelector('.m-lupa-info');
  let t = null;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => _mLupaFiltrar(ov, '.m-sec', inp.value, info), 250); });
  inp.addEventListener('keydown', e => { if (e.key === 'Escape' && inp.value){ e.stopPropagation(); inp.value = ''; _mLupaFiltrar(ov, '.m-sec', '', info); } });
  setTimeout(() => inp.focus(), 50);
}
