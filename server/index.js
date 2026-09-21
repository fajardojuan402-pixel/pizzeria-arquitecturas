'use strict';

/**
 * index.js — Punto de entrada. Levanta un servidor HTTP nativo que:
 *   1) Sirve el frontend estatico desde /public.
 *   2) Expone una clave simple para el panel del profesor (?clave=... o /profesor).
 *   3) Hace upgrade a WebSocket y cablea los eventos con el GameEngine.
 *
 * No usamos Express ni Socket.io porque el entorno no permite instalar paquetes;
 * todo se resuelve con modulos nativos. La API de nuestro WsHub imita lo justo
 * de socket.io para que el codigo se lea igual de claro.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WsHub } = require('./ws');
const { GameEngine } = require('./game');

const PORT = process.env.PORT || 3000;
// Clave del panel del profesor. Cambiala aqui o via variable de entorno.
const CLAVE_PROFESOR = process.env.CLAVE_PROFESOR || 'profe2024';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- Servido de archivos estaticos ---------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function servirEstatico(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // Rutas amigables.
  if (pathname === '/' || pathname === '/jugar') pathname = '/index.html';
  if (pathname === '/profesor') pathname = '/profesor.html';

  // Evitar path traversal.
  const safePath = path
    .normalize(pathname)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Prohibido');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// --- Servidor HTTP + endpoints simples ------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Endpoint para validar la clave del profesor (usado por profesor.html).
  if (url.pathname === '/api/verificar-profesor') {
    const clave = url.searchParams.get('clave') || '';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: clave === CLAVE_PROFESOR }));
    return;
  }

  servirEstatico(req, res);
});

// --- WebSocket + logica de juego ------------------------------------------

const hub = new WsHub();

// El GameEngine notifica cambios por sala; reemitimos el estado a todos los
// sockets suscritos a esa sala (jugadores) y a los profesores.
const engine = new GameEngine((salaId) => difundirSala(salaId));

// Guardamos que "vista" quiere cada socket:
//   - jugador: { tipo:'jugador', salaId, playerId }
//   - profesor: { tipo:'profesor' }
const suscripciones = new Map(); // socketId -> { tipo, salaId?, playerId? }

/** Reenvia a cada jugador de la sala SU vista, y a cada profesor la vista global. */
function difundirSala(salaId) {
  for (const [sid, sub] of suscripciones.entries()) {
    const socket = hub.sockets.get(sid);
    if (!socket) continue;
    if (sub.tipo === 'jugador' && sub.salaId === salaId) {
      socket.emit('estado', engine.vistaJugador(salaId, sub.playerId));
    } else if (sub.tipo === 'profesor') {
      socket.emit('estado-profesor', engine.vistaProfesor());
    }
  }
}

/** Empuja la vista de profesor a todos los profesores conectados. */
function difundirProfesor() {
  for (const [sid, sub] of suscripciones.entries()) {
    if (sub.tipo !== 'profesor') continue;
    const socket = hub.sockets.get(sid);
    if (socket) socket.emit('estado-profesor', engine.vistaProfesor());
  }
}

// El profesor ve ambas salas; cuando cambia una sala tambien lo actualizamos
// (difundirSala ya cubre a los profesores). Este helper cubre cambios globales.
function difundirTodo() {
  difundirProfesor();
}

hub.on('connection', (socket) => {
  // --- El jugador se une a una sala ---------------------------------------
  socket.on('unirse', ({ salaId, nombre } = {}) => {
    const r = engine.unirse(socket.id, salaId, nombre);
    if (!r.ok) {
      socket.emit('error-unirse', { error: r.error });
      return;
    }
    suscripciones.set(socket.id, { tipo: 'jugador', salaId, playerId: r.playerId });
    // Confirmamos al cliente su identidad (para reconexion guarda nombre+sala).
    socket.emit('unido', { salaId, playerId: r.playerId, reconectado: !!r.reconectado });
    socket.emit('estado', engine.vistaJugador(salaId, r.playerId));
    difundirProfesor();
  });

  // --- El profesor abre su panel ------------------------------------------
  socket.on('entrar-profesor', ({ clave } = {}) => {
    if (clave !== CLAVE_PROFESOR) {
      socket.emit('error-profesor', { error: 'Clave incorrecta.' });
      return;
    }
    suscripciones.set(socket.id, { tipo: 'profesor' });
    socket.emit('profesor-ok', {});
    socket.emit('estado-profesor', engine.vistaProfesor());
  });

  // --- Acciones de jugador ------------------------------------------------
  socket.on('elegir-cocinero', ({ playerId } = {}) => {
    engine.elegirCocinero(socket.id, playerId);
  });

  socket.on('confirmar-roles-r2', ({ asignacion } = {}) => {
    const r = engine.confirmarRolesRonda2(socket.id, asignacion);
    if (r && !r.ok) socket.emit('aviso', { error: r.error });
  });

  socket.on('entrar-a-ayudar', () => {
    engine.entrarAAyudar(socket.id);
  });

  socket.on('cambiar-disponibilidad', ({ quiereDescansar } = {}) => {
    engine.cambiarDisponibilidad(socket.id, !!quiereDescansar);
  });

  socket.on('colocar-ingrediente', (payload = {}) => {
    engine.colocarIngrediente(socket.id, payload);
  });

  // --- Control del profesor ----------------------------------------------
  socket.on('iniciar-ronda', ({ salaId, numero } = {}) => {
    if (!esProfesor(socket.id)) return;
    const r = engine.iniciarRonda(salaId, numero);
    if (!r.ok) socket.emit('aviso', { error: r.error });
    else difundirTodo();
  });

  socket.on('reiniciar-ronda', ({ salaId, numero } = {}) => {
    if (!esProfesor(socket.id)) return;
    const r = engine.reiniciarRonda(salaId, numero);
    if (!r.ok) socket.emit('aviso', { error: r.error });
    else difundirTodo();
  });

  socket.on('mostrar-preguntas', ({ salaId } = {}) => {
    if (!esProfesor(socket.id)) return;
    engine.mostrarPreguntas(salaId);
  });

  // --- Desconexion --------------------------------------------------------
  socket.on('close', () => {
    const sub = suscripciones.get(socket.id);
    suscripciones.delete(socket.id);
    if (sub && sub.tipo === 'jugador') {
      engine.desconectar(socket.id);
      difundirProfesor();
    }
  });
});

function esProfesor(socketId) {
  const sub = suscripciones.get(socketId);
  return sub && sub.tipo === 'profesor';
}

// Enganchamos el upgrade HTTP -> WebSocket.
server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    hub.handleUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

// Ticker: para cronometros (bloqueos, cold starts) refrescamos periodicamente
// las salas que esten "jugando" aunque no haya acciones, asi las barras/relojes
// del cliente se ven fluidas. Es barato: solo reemite el estado ya calculado.
setInterval(() => {
  for (const salaId of Object.keys(engine.salas)) {
    const sala = engine.salas[salaId];
    if (sala.estado === 'jugando') difundirSala(salaId);
  }
}, 1000);

server.listen(PORT, () => {
  console.log('==================================================');
  console.log('  Pizzeria de Arquitecturas de Software');
  console.log('==================================================');
  console.log(`  Jugadores:  http://localhost:${PORT}/`);
  console.log(`  Profesor:   http://localhost:${PORT}/profesor`);
  console.log(`  Clave profe: ${CLAVE_PROFESOR}`);
  console.log('==================================================');
});
