/**
 * prof.js — Panel del PROFESOR.
 *
 * El profesor NO juega: observa ambas salas y controla el flujo. Para cada sala
 * puede iniciar/reiniciar cualquiera de las 3 rondas (mientras haya >= 2
 * jugadores) y mostrar las preguntas de discusion. Ve el estado exacto de cada
 * sala y una tabla comparativa acumulada que se actualiza en tiempo real.
 */

const sock = createSocket();
let claveGuardada = null;

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/**
 * Emite un evento con "anti-rebote": ignora repeticiones de la MISMA accion
 * (misma clave) dentro de una ventana corta. Evita que clics rapidos o dobles
 * disparen la accion varias veces. El backend igual valida (es autoritativo);
 * esto solo reduce trafico y evita estados visuales raros.
 */
const _ultimoEmit = {};
function emitThrottled(event, data, clave, ventanaMs = 700) {
  const k = clave || event + ':' + JSON.stringify(data || {});
  const t = Date.now();
  if (_ultimoEmit[k] && t - _ultimoEmit[k] < ventanaMs) return false;
  _ultimoEmit[k] = t;
  sock.emit(event, data);
  return true;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

// --- Login -----------------------------------------------------------------

$('#btnEntrar').addEventListener('click', entrar);
$('#clave').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') entrar();
});

function entrar() {
  const clave = $('#clave').value.trim();
  if (!clave) return;
  claveGuardada = clave;
  sock.emit('entrar-profesor', { clave });
}

// Reautenticacion tras reconexion de transporte.
sock.onOpen(() => {
  if (claveGuardada) sock.emit('entrar-profesor', { clave: claveGuardada });
});

sock.on('error-profesor', (d) => {
  const e = $('#errorLogin');
  e.textContent = d.error || 'No se pudo entrar.';
  e.classList.remove('hidden');
  claveGuardada = null;
});

sock.on('profesor-ok', () => {
  $('#login').classList.add('hidden');
  $('#panel').classList.remove('hidden');
});

sock.on('aviso', (d) => {
  if (d && d.error) toast(d.error);
});

sock.on('estado-profesor', (data) => {
  if (!data) return;
  renderPanel(data);
});

// --- Render del panel ------------------------------------------------------

function renderPanel(data) {
  const cont = $('#salas');
  const tabla = $('#tablaComparativa');
  // BUG 1 — preservar la posicion de scroll de las listas largas al re-render
  // (el panel se reconstruye entero en cada actualizacion por WebSocket).
  const scrollSalas = cont.scrollTop;
  const scrollTabla = tabla.scrollTop;
  const scrollPagina = window.scrollY;

  cont.innerHTML = '';
  ['sala1', 'sala2'].forEach((id) => {
    cont.appendChild(tarjetaSala(data.salas[id]));
  });
  renderTabla(data.salas);

  cont.scrollTop = scrollSalas;
  tabla.scrollTop = scrollTabla;
  window.scrollTo(0, scrollPagina);
}

/** Formatea milisegundos como mm:ss para la cuenta regresiva. */
function formatoTiempo(ms) {
  const total = Math.max(0, Math.ceil((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const seg = total % 60;
  return `${m}:${String(seg).padStart(2, '0')}`;
}

function tarjetaSala(sala) {
  const card = el('div', 'card');
  const header = el('div', 'row between');
  header.appendChild(el('h2', null, sala.id === 'sala1' ? 'Sala 1' : 'Sala 2'));

  // Conteo de jugadores conectados (2 o 3).
  const conteoCls = sala.conectados >= 2 ? 'verde' : 'gris';
  header.appendChild(el('span', 'pill ' + conteoCls, `${sala.conectados} jugador(es)`));
  card.appendChild(header);

  // Estado exacto de la sala.
  card.appendChild(estadoPill(sala));

  // Cronometro de la ronda en curso + pedidos completados en vivo.
  if (sala.estado === 'jugando') {
    const cronRow = el('div', 'row');
    cronRow.style.margin = '4px 0';
    const restante = sala.tiempoRestanteMs || 0;
    const cls = restante <= 30000 ? 'rojo' : restante <= 120000 ? 'amarillo' : 'azul';
    cronRow.appendChild(el('span', 'pill ' + cls, '⏱ ' + formatoTiempo(restante)));
    cronRow.appendChild(el('span', 'pill gris', `Completados: ${sala.completadosActual || 0}`));
    card.appendChild(cronRow);
  }

  // Jugadores y sus roles.
  if (sala.jugadores.length) {
    card.appendChild(
      el(
        'div',
        'mini',
        sala.jugadores.map((j) => j.nombre + (j.rol ? ` — ${j.rol}` : '')).join(' · ')
      )
    );
  } else {
    card.appendChild(el('div', 'mini', 'Sin jugadores conectados.'));
  }

  // Botones de control: iniciar rondas (>= 2 jugadores).
  const puede = sala.conectados >= 2;
  const filaIniciar = el('div', 'row');
  filaIniciar.style.marginTop = '10px';
  [1, 2, 3].forEach((n) => {
    const yaJugada = !!sala.resultados[n];
    const b = el('button', yaJugada ? 'gris' : 'verde', `${yaJugada ? 'Reiniciar' : 'Iniciar'} Ronda ${n}`);
    b.disabled = !puede;
    b.title = puede ? '' : 'Se necesitan al menos 2 jugadores';
    b.onclick = () => {
      const evento = yaJugada ? 'reiniciar-ronda' : 'iniciar-ronda';
      // Anti-doble-clic: bloquea repetir iniciar/reiniciar de ESA ronda un momento.
      if (emitThrottled(evento, { salaId: sala.id, numero: n }, `${evento}:${sala.id}:${n}`)) {
        b.disabled = true; // feedback inmediato hasta el proximo re-render
      }
    };
    filaIniciar.appendChild(b);
  });
  card.appendChild(filaIniciar);

  // Ronda 3: control de HORA PICO (solo el profesor la dispara). Llegan 2-3
  // pedidos a la vez y los jugadores despiertan automaticamente para cubrirlos.
  // Se pueden ENCOLAR varias: se ejecutan una tras otra cuando termina la actual.
  if (sala.esRonda3) {
    const filaPico = el('div', 'row');
    filaPico.style.marginTop = '8px';
    const enCola = (sala.picosPendientes && sala.picosPendientes.length) || 0;
    const bpico = el(
      'button',
      sala.horaPicoActiva ? 'amarillo' : 'rojo',
      sala.horaPicoActiva ? '🔥 Encolar otra hora pico' : '🔥 Activar hora pico'
    );
    // Siempre habilitado: si ya hay una en curso, la nueva queda pendiente en cola.
    bpico.title = sala.horaPicoActiva
      ? 'Ya hay una hora pico en curso; esta quedara pendiente y se ejecutara cuando termine la actual.'
      : 'Genera 2-3 pedidos a la vez; el sistema despierta a los cocineros necesarios.';
    bpico.onclick = () => {
      // Anti-doble-clic: un solo evento de hora pico por ventana corta. Encolar
      // varias es intencional, pero debe ser un clic deliberado, no un rebote.
      if (emitThrottled('activar-hora-pico', { salaId: sala.id }, 'pico:' + sala.id)) {
        bpico.disabled = true; // feedback inmediato hasta el proximo re-render
      }
    };
    filaPico.appendChild(bpico);

    // Estado en vivo de la hora pico y de la cola de pendientes.
    if (sala.horaPicoActiva) {
      filaPico.appendChild(el('span', 'pill amarillo', `En curso: ${sala.pedidosActivos} pendiente(s)`));
    }
    if (enCola > 0) {
      filaPico.appendChild(
        el('span', 'pill gris', `En cola: ${enCola} hora(s) pico [${sala.picosPendientes.join(', ')}]`)
      );
    }
    card.appendChild(filaPico);
  }

  // Boton de preguntas de discusion.
  const filaExtra = el('div', 'row');
  filaExtra.style.marginTop = '8px';
  const bp = el('button', 'ghost', sala.mostrarPreguntas ? 'Preguntas visibles ✓' : 'Mostrar preguntas de discusion');
  bp.disabled = sala.mostrarPreguntas;
  bp.onclick = () => {
    if (emitThrottled('mostrar-preguntas', { salaId: sala.id }, 'preg:' + sala.id)) {
      bp.disabled = true;
    }
  };
  filaExtra.appendChild(bp);
  card.appendChild(filaExtra);

  return card;
}

function estadoPill(sala) {
  let cls = 'gris';
  if (sala.estado === 'jugando') cls = 'amarillo';
  else if (sala.estado === 'completada') cls = 'azul';
  else if (sala.estado === 'esperando') cls = 'verde';
  const d = el('div');
  d.style.margin = '8px 0';
  d.appendChild(el('span', 'pill ' + cls, sala.estadoTexto));
  if (sala.cerrada) d.appendChild(el('span', 'pill gris', ' cerrada a nuevos jugadores'));
  return d;
}

// --- Tabla comparativa acumulada -------------------------------------------

function renderTabla(salas) {
  const cont = $('#tablaComparativa');
  cont.innerHTML = '';
  const tabla = el('table');

  const thead = el('tr');
  ['Sala', 'Ronda', 'Arquitectura', 'Tiempo', 'Pedidos', 'Tiempo perdido', 'Fallas/Bloqueos', 'Extra'].forEach(
    (h) => thead.appendChild(el('th', null, h))
  );
  tabla.appendChild(thead);

  let hayFilas = false;
  ['sala1', 'sala2'].forEach((sid) => {
    const sala = salas[sid];
    [1, 2, 3].forEach((n) => {
      const r = sala.resultados[n];
      if (!r) return;
      hayFilas = true;
      const tr = el('tr');
      tr.appendChild(el('td', null, sid === 'sala1' ? 'Sala 1' : 'Sala 2'));
      tr.appendChild(el('td', null, 'Ronda ' + n));
      tr.appendChild(el('td', null, r.titulo));
      // Tiempo total (~10 min). Mostramos min:seg para que sea legible.
      tr.appendChild(el('td', null, formatoTiempo(r.tiempoTotalMs)));
      // Pedidos completados en ese lapso: el dato clave para comparar rondas.
      tr.appendChild(el('td', null, String(r.completados != null ? r.completados : '—')));

      // Tiempo perdido por fallas/bloqueos/cold starts (segundos). Permite comparar
      // con numeros concretos cuanta produccion "se congelo" en cada arquitectura:
      //   R1 monolito     -> todo detenido en cada bloqueo (tiempoBloqueoMs)
      //   R2 microservicios -> solo una estacion bloqueada por vez (tiempoRestoActivoMs)
      //   R3 serverless   -> tiempo perdido en arranques / cold starts (tiempoColdMs)
      let perdidoMs = 0;
      if (r.ronda === 1) perdidoMs = r.tiempoBloqueoMs || 0;
      else if (r.ronda === 2) perdidoMs = r.tiempoRestoActivoMs || 0;
      else if (r.ronda === 3) perdidoMs = r.tiempoColdMs || 0;
      tr.appendChild(el('td', null, `${(perdidoMs / 1000).toFixed(0)}s`));

      let fallas = '—';
      if (r.ronda === 1) fallas = `${r.bloqueos} bloqueo(s)`;
      else if (r.ronda === 2) fallas = `${r.fallas} falla(s)`;
      else if (r.ronda === 3) fallas = `${r.coldStarts} cold start(s)`;
      tr.appendChild(el('td', null, fallas));

      let extra = '—';
      if (r.ronda === 2) extra = `Resto activo: ${(r.tiempoRestoActivoMs / 1000).toFixed(0)}s`;
      else if (r.ronda === 3) extra = `Perdido: ${(r.tiempoColdMs / 1000).toFixed(0)}s`;
      tr.appendChild(el('td', null, extra));

      tabla.appendChild(tr);
    });
  });

  if (!hayFilas) {
    cont.appendChild(el('p', 'mini', 'Aun no hay rondas completadas. La tabla se llenara a medida que jueguen.'));
    return;
  }
  cont.appendChild(tabla);
}
