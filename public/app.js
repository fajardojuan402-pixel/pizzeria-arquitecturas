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
  c.innerHTML = '';

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
  card.appendChild(pill(soyCocinero ? 'Eres el COCINERO' : 'Observando', soyCocinero ? 'verde' : 'gris'));
  card.appendChild(el('div', 'mini', `Pedido ${Math.min(r.indice + 1, r.total)} de ${r.total} · bloqueos: ${r.metricas.bloqueos}`));

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
      panelIngredientes(r.grid, siguiente, (ing) => {
        sock.emit('colocar-ingrediente', { ingrediente: ing });
      })
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

  card.appendChild(el('div', 'mini', `Completadas: ${r.completados}/${r.total} · fallas: ${r.metricas.fallas}`));

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
        panelIngredientes(grid, siguiente, (ing) => {
          sock.emit('colocar-ingrediente', { pizzaId: p.id, ingrediente: ing });
        })
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
  card.appendChild(el('div', 'mini', `Pedidos: ${r.completados}/${r.total} · cold starts: ${r.metricas.coldStarts}`));

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
          bloqueadaCuadricula // deshabilitada si no estoy activo (cold start/descanso)
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
function panelIngredientes(grid, siguiente, onClick, disabled) {
  const cont = el('div', 'ingredientes' + (disabled ? ' bloqueada' : ''));
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
  const seg = (res.tiempoTotalMs / 1000).toFixed(1);
  const ul = el('div', 'row');
  ul.appendChild(pill(`Tiempo: ${seg}s`, 'azul'));
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
