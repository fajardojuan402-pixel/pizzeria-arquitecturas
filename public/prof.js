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
  cont.innerHTML = '';
  ['sala1', 'sala2'].forEach((id) => {
    cont.appendChild(tarjetaSala(data.salas[id]));
  });
  renderTabla(data.salas);
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
      sock.emit(evento, { salaId: sala.id, numero: n });
    };
    filaIniciar.appendChild(b);
  });
  card.appendChild(filaIniciar);

  // Boton de preguntas de discusion.
  const filaExtra = el('div', 'row');
  filaExtra.style.marginTop = '8px';
  const bp = el('button', 'ghost', sala.mostrarPreguntas ? 'Preguntas visibles ✓' : 'Mostrar preguntas de discusion');
  bp.disabled = sala.mostrarPreguntas;
  bp.onclick = () => sock.emit('mostrar-preguntas', { salaId: sala.id });
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
  ['Sala', 'Ronda', 'Arquitectura', 'Tiempo (s)', 'Fallas/Bloqueos', 'Extra'].forEach((h) =>
    thead.appendChild(el('th', null, h))
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
      tr.appendChild(el('td', null, (r.tiempoTotalMs / 1000).toFixed(1)));

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
