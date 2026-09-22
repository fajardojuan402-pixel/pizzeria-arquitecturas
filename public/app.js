/**
 * app.js — Vista del JUGADOR.
 *
 * Renderiza segun el estado que envia el servidor. La UI es "tonta": el servidor
 * es la unica fuente de verdad (autoritativo). Cada evento 'estado' repinta todo.
 *
 * Correspondencia con arquitecturas (para explicar en clase):
 *   Ronda 1 -> Monolito       (1 cocinero hace todo; se bloquea entero)
 *   Ronda 2 -> Microservicios (estaciones independientes en paralelo)
 *   Ronda 3 -> Serverless     (instancias que despiertan bajo demanda; cold start)
 */

const sock = createSocket();

// Identidad local (para reconexion de negocio: reenviar 'unirse' al reconectar).
let miNombre = null;
let miSala = null;
let miPlayerId = null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

// --- Pantalla de inicio ----------------------------------------------------

document.querySelectorAll('[data-sala]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nombre = $('#nombre').value.trim();
    if (!nombre) {
      mostrarErrorInicio('Escribe tu nombre primero.');
      return;
    }
    miNombre = nombre;
    miSala = btn.dataset.sala;
    sock.emit('unirse', { salaId: miSala, nombre: miNombre });
  });
});

function mostrarErrorInicio(msg) {
  const e = $('#errorInicio');
  e.textContent = msg;
  e.classList.remove('hidden');
}

// Reconexion de transporte: al (re)abrir el socket, si ya tenia identidad,
// reenvio 'unirse' con el mismo nombre -> el servidor me devuelve mi rol si
// estoy dentro de la ventana de 1 minuto.
sock.onOpen(() => {
  if (miNombre && miSala) {
    sock.emit('unirse', { salaId: miSala, nombre: miNombre });
  }
});

// --- Eventos del servidor --------------------------------------------------

sock.on('error-unirse', (d) => {
  mostrarErrorInicio(d.error || 'No se pudo unir.');
  // Si falla, olvidamos identidad para no reintentar en bucle.
  miNombre = miSala = miPlayerId = null;
});

sock.on('unido', (d) => {
  miPlayerId = d.playerId;
  miSala = d.salaId;
  $('#inicio').classList.add('hidden');
  $('#juego').classList.remove('hidden');
  if (d.reconectado) toast('Reconectado: recuperaste tu rol.');
});

sock.on('aviso', (d) => {
  if (d && d.error) toast(d.error);
});

sock.on('estado', (estado) => {
  if (!estado) return;
  render(estado);
});

// --- Render principal ------------------------------------------------------

function render(s) {
  $('#salaNombre').textContent = s.salaId === 'sala1' ? 'Sala 1' : 'Sala 2';
  $('#conteo').textContent = `${s.jugadores.length} jugador(es)`;
  const rol = s.yo && s.yo.rol ? s.yo.rol : '—';
  $('#miRol').textContent = `Rol: ${rol}`;
  $('#listaJugadores').textContent =
    'En sala: ' + s.jugadores.map((j) => j.nombre + (j.rol ? ` (${j.rol})` : '')).join(', ');

  const c = $('#contenido');

  // BUG 2 — El <select> de la Ronda 2 (2 jugadores) se cerraba solo porque cada
  // actualizacion de estado por WebSocket recreaba el nodo del selector mientras
  // el usuario lo tenia abierto. Solucion: si ya estamos mostrando la pantalla de
  // seleccion de roles y el nuevo estado sigue en esa misma fase, NO re-renderizamos
  // (nada de esa pantalla cambia hasta que el jugador confirme). Asi el dropdown
  // nativo permanece intacto y se puede elegir con calma.
  const enSeleccionRoles =
    s.estado === 'jugando' && s.ronda && s.ronda.tipo === 2 && s.ronda.fase === 'elegir-roles';
  if (enSeleccionRoles && c.querySelector('[data-rolesr2]')) {
    // Solo actualizamos la cabecera/cronometro; dejamos el selector como esta.
    actualizarCabeceraTiempo(s);
    return;
  }

  // BUG 1 — El scroll se "devolvia" al inicio en cada actualizacion porque
  // reconstruimos todo el HTML (innerHTML = ''), y el navegador pierde la posicion.
  // Solucion: guardamos el scrollTop de las listas largas ANTES de reconstruir y
  // lo restauramos justo DESPUES. Usamos un id estable por lista para casarlas.
  const scrollGuardado = guardarScrolls(c);
  const scrollPagina = window.scrollY;

  c.innerHTML = '';
  construirContenido(s, c);

  // Restauramos las posiciones de scroll tras reconstruir el DOM (BUG 1).
  restaurarScrolls(c, scrollGuardado);
  window.scrollTo(0, scrollPagina);
}

/** Construye el contenido de #contenido segun el estado (sin tocar el scroll). */
function construirContenido(s, c) {
  // Preguntas de discusion (si el sistema/profesor las activo).
  if (s.mostrarPreguntas && s.preguntas.length) {
    c.appendChild(vistaPreguntas(s.preguntas));
  }

  // Estados que NO son "jugando": esperar al profesor / resultados.
  if (s.estado === 'lobby') {
    c.appendChild(bloqueEspera('Esperando a que se unan al menos 2 jugadores…'));
    return;
  }
  if (s.estado === 'esperando') {
    c.appendChild(bloqueEspera('Esperando a que el profesor inicie una ronda.'));
    return;
  }
  if (s.estado === 'completada') {
    // Mostrar resultado de la ultima ronda jugada + espera.
    const res = s.resultados[s.rondaActual];
    if (res) c.appendChild(vistaResultado(res));
    c.appendChild(bloqueEspera('Ronda completada. Esperando al profesor…'));
    return;
  }

  // estado === 'jugando'
  const r = s.ronda;
  if (!r) {
    c.appendChild(bloqueEspera('Preparando ronda…'));
    return;
  }
  if (r.tipo === 1) c.appendChild(vistaRonda1(s, r));
  else if (r.tipo === 2) c.appendChild(vistaRonda2(s, r));
  else if (r.tipo === 3) c.appendChild(vistaRonda3(s, r));
}

// --- BUG 1: preservacion de scroll de listas largas ------------------------

/**
 * Recorre los contenedores con scroll dentro de `raiz` (las cuadriculas de
 * ingredientes marcadas con data-scrollkey) y devuelve un mapa clave -> scrollTop.
 */
function guardarScrolls(raiz) {
  const mapa = {};
  raiz.querySelectorAll('[data-scrollkey]').forEach((nodo) => {
    mapa[nodo.getAttribute('data-scrollkey')] = nodo.scrollTop;
  });
  return mapa;
}

/** Restaura el scrollTop guardado en los contenedores que reaparecen tras el re-render. */
function restaurarScrolls(raiz, mapa) {
  raiz.querySelectorAll('[data-scrollkey]').forEach((nodo) => {
    const key = nodo.getAttribute('data-scrollkey');
    if (mapa[key] != null) nodo.scrollTop = mapa[key];
  });
}

/** Actualiza solo la cabecera con el cronometro (sin recrear el contenido). */
function actualizarCabeceraTiempo(s) {
  const cron = document.querySelector('[data-cronometro]');
  if (cron && s.ronda) cron.textContent = '⏱ ' + formatoTiempo(s.ronda.tiempoRestanteMs);
}

/** Formatea milisegundos como mm:ss para la cuenta regresiva. */
function formatoTiempo(ms) {
  const total = Math.max(0, Math.ceil((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const seg = total % 60;
  return `${m}:${String(seg).padStart(2, '0')}`;
}

/** Crea el bloque del cronometro de cuenta regresiva de la ronda. */
function cronometro(r) {
  const restante = r.tiempoRestanteMs || 0;
  const cls = restante <= 30000 ? 'rojo' : restante <= 120000 ? 'amarillo' : 'azul';
  const span = pill('⏱ ' + formatoTiempo(restante), cls);
  span.setAttribute('data-cronometro', '1');
  return span;
}

function bloqueEspera(texto) {
  const d = el('div', 'card espera');
  d.appendChild(el('div', 'big', '⏳'));
  d.appendChild(el('div', 'big', texto));
  d.appendChild(el('div', 'mini', 'No hay nada que hacer hasta que el profesor actue.'));
  return d;
}

// --- RONDA 1: Monolito -----------------------------------------------------

function vistaRonda1(s, r) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, 'Ronda 1 — Fabrica de un solo cocinero (Monolito)'));

  // Fase: elegir cocinero.
  if (r.fase === 'elegir-cocinero') {
    card.appendChild(el('p', null, 'Elijan 1 cocinero. El resto observa.'));
    const row = el('div', 'row');
    s.jugadores.forEach((j) => {
      const b = el('button', 'ghost', `Que cocine ${j.nombre}`);
      b.onclick = () => sock.emit('elegir-cocinero', { playerId: j.id });
      row.appendChild(b);
    });
    card.appendChild(row);
    return card;
  }

  const soyCocinero = s.yo && s.yo.id === r.cocineroId;
  const cab = el('div', 'row');
  cab.appendChild(pill(soyCocinero ? 'Eres el COCINERO' : 'Observando', soyCocinero ? 'verde' : 'gris'));
  cab.appendChild(cronometro(r));
  card.appendChild(cab);
  // La ronda dura por tiempo: mostramos pedidos completados (no "X de 5").
  card.appendChild(el('div', 'mini', `Pizzas completadas: ${r.completados} · bloqueos: ${r.metricas.bloqueos}`));

  // Bloqueo activo (todo el monolito detenido).
  if (r.bloqueado) {
    const seg = Math.ceil(r.bloqueoRestanteMs / 1000);
    const a = el('div', 'aviso-bloqueo', `🛑 Cocinero bloqueado — ${seg}s (el monolito entero se detiene)`);
    card.appendChild(a);
    return card;
  }

  const pedido = r.pedidoActual;
  if (!pedido) {
    card.appendChild(el('p', null, 'Sin pedido actual.'));
    return card;
  }

  card.appendChild(el('h3', null, `Pedido: ${pedido.nombre}`));
  card.appendChild(recetaProgreso(pedido.ingredientes, r.progreso));

  if (soyCocinero) {
    const siguiente = pedido.ingredientes[r.progreso.length];
    // La cuadricula (reales + decoys) la arma y baraja el SERVIDOR (r.grid);
    // aqui solo la pintamos. Es un mar de casillas parecidas: hay que leer bien.
    card.appendChild(
      el('div', 'mini', `🔎 Busca el ingrediente correcto entre ${r.grid.length} opciones parecidas`)
    );
    card.appendChild(
      panelIngredientes(
        r.grid,
        siguiente,
        (ing) => sock.emit('colocar-ingrediente', { ingrediente: ing }),
        false,
        'r1-grid' // clave de scroll estable (una sola cuadricula en R1)
      )
    );
  } else {
    card.appendChild(el('p', 'mini', 'Solo el cocinero puede colocar ingredientes.'));
  }
  return card;
}

// --- RONDA 2: Microservicios ----------------------------------------------

function vistaRonda2(s, r) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, 'Ronda 2 — Por estaciones (Microservicios)'));

  // Fase: 2 jugadores eligen quien cubre que estaciones.
  if (r.fase === 'elegir-roles') {
    card.appendChild(seleccionRolesR2(s, r));
    return card;
  }

  // Que estaciones me tocaron a mi.
  const misEstaciones = r.estaciones
    .filter((e) => r.asignacion[e.id] === (s.yo && s.yo.id))
    .map((e) => e.id);

  const cab2 = el('div', 'row');
  cab2.appendChild(cronometro(r));
  cab2.appendChild(pill(`Completadas: ${r.completados}`, 'gris'));
  cab2.appendChild(pill(`Fallas: ${r.metricas.fallas}`, r.metricas.fallas ? 'rojo' : 'gris'));
  card.appendChild(cab2);

  // Estado de cada estacion (activa / bloqueada).
  const estRow = el('div', 'row');
  r.estaciones.forEach((e) => {
    const bloq = r.bloqueos[e.id] && r.bloqueos[e.id] > 0;
    const p = pill(
      `${e.nombre}${bloq ? ' 🛑' + Math.ceil(r.bloqueos[e.id] / 1000) + 's' : ''}`,
      bloq ? 'rojo' : misEstaciones.includes(e.id) ? 'verde' : 'gris'
    );
    estRow.appendChild(p);
  });
  card.appendChild(estRow);

  // Pizzas en proceso (en paralelo).
  const cont = el('div', 'pizzas');
  if (!r.pizzas.length) cont.appendChild(el('p', 'mini', 'No hay pizzas en proceso ahora mismo.'));
  r.pizzas.forEach((p) => {
    const est = r.estaciones.find((e) => e.id === p.estacionActual);
    const box = el('div', 'pizza');
    box.appendChild(el('h3', null, p.nombre));
    box.appendChild(el('div', 'estado', `En estacion: ${est ? est.nombre : '—'}`));

    // Ingredientes que corresponden a la estacion actual.
    const requeridosAqui = est ? p.ingredientes.filter((ing) => est.ingredientes.includes(ing)) : [];
    box.appendChild(recetaProgreso(requeridosAqui, p.progresoEstacion));

    const puedo = est && r.asignacion[est.id] === (s.yo && s.yo.id) && !(r.bloqueos[est.id] > 0);
    if (puedo && requeridosAqui.length) {
      const siguiente = requeridosAqui[p.progresoEstacion.length];
      // Cuadricula de decoys de ESTA estacion (solo lo suyo: aislamiento). La
      // arma/baraja el servidor en r.grids[est.id]; misma para todas sus pizzas.
      const grid = (r.grids && r.grids[est.id]) || requeridosAqui;
      box.appendChild(
        panelIngredientes(
          grid,
          siguiente,
          (ing) => sock.emit('colocar-ingrediente', { pizzaId: p.id, ingrediente: ing }),
          false,
          'r2-' + p.id + '-' + est.id // clave por pizza+estacion
        )
      );
    } else if (puedo && !requeridosAqui.length) {
      const b = el('button', 'ghost', 'Pasar a siguiente estacion');
      b.onclick = () => sock.emit('colocar-ingrediente', { pizzaId: p.id, ingrediente: '__pasar__' });
      box.appendChild(b);
    } else {
      box.appendChild(el('div', 'mini', 'Esta pizza no esta en tu estacion ahora.'));
    }
    cont.appendChild(box);
  });
  card.appendChild(cont);
  return card;
}

/** Pantalla de seleccion de roles (solo cuando hay 2 jugadores). */
function seleccionRolesR2(s, r) {
  const box = el('div');
  // Marca que permite al render saltarse el re-render mientras el usuario
  // interactua con los <select> (evita que un update por WebSocket los cierre).
  box.setAttribute('data-rolesr2', '1');
  box.appendChild(
    el('p', null, 'Son 2 jugadores: uno cubrira DOS estaciones y el otro UNA. Asignen cada estacion:')
  );
  const jugadores = s.jugadores;
  const selects = {};
  r.estaciones.forEach((e) => {
    const wrap = el('div');
    wrap.appendChild(el('label', null, `${e.nombre} (${e.ingredientes.join(', ')})`));
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%;padding:10px;border-radius:8px;border:1px solid #e5e7eb';
    jugadores.forEach((j) => {
      const opt = document.createElement('option');
      opt.value = j.id;
      opt.textContent = j.nombre;
      sel.appendChild(opt);
    });
    selects[e.id] = sel;
    wrap.appendChild(sel);
    box.appendChild(wrap);
  });
  const b = el('button', 'verde', 'Confirmar roles y empezar');
  b.style.marginTop = '10px';
  b.onclick = () => {
    const asignacion = {};
    Object.keys(selects).forEach((k) => (asignacion[k] = selects[k].value));
    // Validacion ligera en cliente: ambos jugadores deben participar.
    const usados = new Set(Object.values(asignacion));
    if (usados.size < 2) {
      toast('Ambos jugadores deben cubrir al menos una estacion.');
      return;
    }
    sock.emit('confirmar-roles-r2', { asignacion });
  };
  box.appendChild(b);
  return box;
}

// --- RONDA 3: Serverless ---------------------------------------------------

function vistaRonda3(s, r) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, 'Ronda 3 — Fin de semana, bajo demanda (Serverless)'));
  const cab3 = el('div', 'row');
  cab3.appendChild(cronometro(r));
  cab3.appendChild(pill(`Pedidos: ${r.completados}`, 'gris'));
  cab3.appendChild(pill(`Cold starts: ${r.metricas.coldStarts}`, r.metricas.coldStarts ? 'amarillo' : 'gris'));
  card.appendChild(cab3);

  const miEstado = r.estados[s.yo && s.yo.id];
  const coldRestante = r.coldRestante[s.yo && s.yo.id] || 0;

  // Cabecera de estado + hora pico.
  if (r.horaPico) {
    card.appendChild(el('div', 'aviso-bloqueo', '🔥 ¡HORA PICO! Varias pizzas a la vez.'));
  }

  // Panel de control de disponibilidad del jugador.
  const control = el('div', 'row');
  if (miEstado === 'coldstart') {
    const seg = Math.ceil(coldRestante / 1000);
    const b = el('div', 'card');
    b.style.width = '100%';
    b.appendChild(el('div', null, `❄️ Cold start… listo en ${seg}s`));
    b.appendChild(barra(1 - coldRestante / 10000));
    card.appendChild(b);
  } else if (miEstado === 'descansando') {
    if (r.horaPico) {
      const b = el('button', 'verde', 'Entrar a ayudar');
      b.onclick = () => sock.emit('entrar-a-ayudar');
      control.appendChild(b);
      control.appendChild(pill('Estas descansando', 'gris'));
    } else {
      control.appendChild(pill('Descansando (instancia apagada)', 'gris'));
    }
    card.appendChild(control);
  } else {
    // activo
    control.appendChild(pill('Activo', 'verde'));
    const b = el('button', 'ghost', 'Volver a descansar');
    b.onclick = () => sock.emit('cambiar-disponibilidad', { quiereDescansar: true });
    control.appendChild(b);
    card.appendChild(control);
  }

  // Pizzas de la rafaga actual.
  // Durante el cold start (o mientras se descansa) la cuadricula se ve atenuada
  // y NO es clicable: la instancia aun no esta "caliente". Solo al terminar los
  // 10s (miEstado === 'activo') se habilita.
  const bloqueadaCuadricula = miEstado !== 'activo';
  const cont = el('div', 'pizzas' + (bloqueadaCuadricula ? ' descansando' : ''));
  r.pizzas.forEach((p) => {
    const box = el('div', 'pizza');
    box.appendChild(el('h3', null, p.nombre + (p.completada ? ' ✅' : '')));
    box.appendChild(recetaProgreso(p.ingredientes, p.progreso));
    if (!p.completada) {
      const siguiente = p.ingredientes[p.progreso.length];
      // Cuadricula de decoys de ESTA pizza (la arma/baraja el servidor).
      const grid = (r.grids && r.grids[p.id]) || p.ingredientes;
      box.appendChild(
        panelIngredientes(
          grid,
          siguiente,
          (ing) => sock.emit('colocar-ingrediente', { pizzaId: p.id, ingrediente: ing }),
          bloqueadaCuadricula, // deshabilitada si no estoy activo (cold start/descanso)
          'r3-' + p.id // clave de scroll por pizza
        )
      );
    }
    cont.appendChild(box);
  });
  card.appendChild(cont);
  return card;
}

// --- Componentes reutilizables --------------------------------------------

function pill(texto, cls) {
  return el('span', 'pill ' + (cls || 'gris'), texto);
}

/** Muestra la receta con los ingredientes ya colocados tachados. */
function recetaProgreso(ingredientes, progreso) {
  const d = el('div', 'receta');
  ingredientes.forEach((ing, i) => {
    const hecho = i < progreso.length;
    d.appendChild(el('span', 'ing' + (hecho ? ' hecho' : ''), ing));
  });
  return d;
}

/**
 * Panel/cuadricula de ingredientes con SEÑUELOS (decoys).
 *
 * `grid` viene del servidor ya barajado y contiene el/los ingrediente(s) real(es)
 * mezclados con muchos decoys parecidos. El objetivo didactico es obligar a LEER
 * cada palabra: no basta con recordar una posicion (ademas el servidor vuelve a
 * barajar tras cada acierto, asi que el layout cambia constantemente).
 *
 * Reglas de interaccion:
 *  - Un clic en el ingrediente correcto (== `siguiente`) llama a onClick y el
 *    servidor avanza el pedido (que a su vez reenvia un grid re-barajado).
 *  - Un clic en un decoy (o en un ingrediente fuera de orden) NO avanza nada:
 *    damos feedback visual breve (parpadeo rojo de esa casilla) SIN penalizacion
 *    de tiempo. No emitimos al servidor para no generar trafico inutil; de todos
 *    modos el servidor tambien lo rechazaria (validacion anti-decoy autoritativa).
 *  - Si `disabled` es true (p.ej. cold start en Ronda 3), toda la cuadricula se
 *    ve atenuada y no responde a clics.
 *
 * IMPORTANTE: NO reordenamos ni deduplicamos aqui — respetamos el orden revuelto
 * que mando el servidor (mezcla de familias distintas, sin agrupar por tipo).
 */
function panelIngredientes(grid, siguiente, onClick, disabled, scrollKey) {
  const cont = el('div', 'ingredientes' + (disabled ? ' bloqueada' : ''));
  // Clave estable para preservar la posicion de scroll entre re-renders (BUG 1).
  if (scrollKey) cont.setAttribute('data-scrollkey', scrollKey);
  grid.forEach((ing) => {
    const esCorrecto = ing === siguiente;
    // No marcamos con clase 'next' el correcto: delataria la respuesta. La
    // dificultad es justamente encontrarlo leyendo.
    const b = el('button', 'casilla', ing);
    if (disabled) {
      b.disabled = true;
    } else {
      b.onclick = () => {
        if (esCorrecto) {
          onClick(ing); // acierto: el servidor avanza y re-baraja
        } else {
          flashError(b); // decoy o fuera de orden: parpadeo rojo, sin avanzar
        }
      };
    }
    cont.appendChild(b);
  });
  return cont;
}

/** Parpadeo rojo breve de una casilla al hacer clic en un decoy (sin penalizar). */
function flashError(btn) {
  btn.classList.remove('error'); // reinicia por si se repite rapido
  // Forzamos reflow para poder re-disparar la animacion consecutivamente.
  void btn.offsetWidth;
  btn.classList.add('error');
  setTimeout(() => btn.classList.remove('error'), 450);
}

function barra(fraccion) {
  const b = el('div', 'barra');
  const s = el('span');
  s.style.width = Math.max(0, Math.min(1, fraccion)) * 100 + '%';
  b.appendChild(s);
  return b;
}

// --- Resultados y preguntas ------------------------------------------------

function vistaResultado(res) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, `Resultado — Ronda ${res.ronda}: ${res.titulo}`));
  const ul = el('div', 'row');
  // La ronda dura por tiempo (~10 min); el dato interesante es cuantos pedidos
  // se completaron. Mostramos tiempo en min:seg + pedidos completados.
  ul.appendChild(pill(`Tiempo: ${formatoTiempo(res.tiempoTotalMs)}`, 'azul'));
  if (res.completados != null) ul.appendChild(pill(`Pedidos: ${res.completados}`, 'verde'));
  if (res.ronda === 1) ul.appendChild(pill(`Bloqueos: ${res.bloqueos}`, 'rojo'));
  if (res.ronda === 2) {
    ul.appendChild(pill(`Fallas: ${res.fallas}`, 'rojo'));
    ul.appendChild(pill(`Resto activo: ${(res.tiempoRestoActivoMs / 1000).toFixed(0)}s`, 'verde'));
  }
  if (res.ronda === 3) {
    ul.appendChild(pill(`Cold starts: ${res.coldStarts}`, 'amarillo'));
    ul.appendChild(pill(`Perdido en arranques: ${(res.tiempoColdMs / 1000).toFixed(0)}s`, 'rojo'));
  }
  card.appendChild(ul);
  card.appendChild(el('div', 'narrativa', res.narrativa));
  return card;
}

function vistaPreguntas(preguntas) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, '🧠 Preguntas de discusion'));
  const ol = el('ol', 'preguntas');
  preguntas.forEach((q) => ol.appendChild(el('li', null, q)));
  card.appendChild(ol);
  return card;
}
