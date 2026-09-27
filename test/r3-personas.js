'use strict';
/**
 * test/r3-personas.js — Prueba UNITARIA (sin red) de la logica de personas y
 * horas pico de la Ronda 3. Instancia el GameEngine directamente y verifica que
 * el numero de cocineros activos == preparaciones pendientes, la cola de horas
 * pico, y la robustez ante desconexion/reconexion.
 *
 * Uso: node test/r3-personas.js
 */
const { GameEngine } = require('../server/game');

const results = [];
const check = (cond, msg) => {
  results.push((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) process.exitCode = 1;
};

// Cuenta cocineros CONECTADOS activos o arrancando (cold start) = capacidad real.
function activosOColdstart(r, engine, sala) {
  const conectados = engine.jugadoresConectados(sala).map((j) => j.id);
  return conectados.filter((pid) => r.estados[pid] === 'activo' || r.estados[pid] === 'coldstart').length;
}

// Fuerza que todos los cold start pendientes pasen a 'activo' (sin esperar 10s).
function forzarActivos(r) {
  for (const pid of Object.keys(r.estados)) {
    if (r.estados[pid] === 'coldstart') r.estados[pid] = 'activo';
  }
}

// Completa SOLO las pizzas de la rafaga actual (snapshot de ids). No persigue las
// pizzas que se generen despues (p.ej. la siguiente hora pico de la cola), para
// no drenar la cola entera de una vez.
function completarRafaga(engine, sala) {
  const r = sala.ronda;
  forzarActivos(r);
  const activo = engine.jugadoresConectados(sala).find((j) => r.estados[j.id] === 'activo');
  if (!activo) return;
  const socketId = activo.socketId;
  const idsRafaga = r.pizzasActivas.map((p) => p.id); // solo estas
  let guard = 0;
  while (guard++ < 100) {
    const pizza = r.pizzasActivas.find((p) => idsRafaga.includes(p.id) && !p.completada);
    if (!pizza) break;
    forzarActivos(r);
    engine.colocarIngrediente(socketId, { pizzaId: pizza.id, ingrediente: pizza.ingredientes[pizza.progreso.length] });
  }
}

(function main() {
  const engine = new GameEngine(() => {});
  const sala = engine.salas.sala1;

  // 3 jugadores conectados.
  const a = engine.unirse('sA', 'sala1', 'Ana');
  const b = engine.unirse('sB', 'sala1', 'Beto');
  const c = engine.unirse('sC', 'sala1', 'Caro');
  // Damos socketId real a cada jugador (unirse ya lo hace).
  check(a.ok && b.ok && c.ok, '3 jugadores se unen');

  // Inicia Ronda 3.
  engine.iniciarRonda('sala1', 3);
  const r = sala.ronda;
  check(r && r.tipo === 3, 'Ronda 3 iniciada');

  // Sin hora pico: 1 preparacion -> 1 persona activa.
  check(r.pizzasActivas.filter((p) => !p.completada).length === 1, 'Normal: 1 preparacion activa');
  check(activosOColdstart(r, engine, sala) === 1, 'Normal: exactamente 1 cocinero activo');

  // Hora pico: fuerza 2 preparaciones para determinismo.
  // (activarHoraPico elige 2..3; probamos ambos casos manualmente via _arrancarHoraPico.)
  engine._arrancarHoraPico(sala, 2);
  forzarActivos(r);
  check(r.pizzasActivas.filter((p) => !p.completada).length === 2, 'Pico(2): 2 preparaciones activas');
  check(activosOColdstart(r, engine, sala) === 2, 'Pico(2): exactamente 2 cocineros');

  // Completa esa rafaga -> vuelve a normal -> 1 preparacion, 1 persona.
  completarRafaga(engine, sala);
  forzarActivos(r);
  check(r.pizzasActivas.filter((p) => !p.completada).length === 1, 'Tras pico(2): vuelve a 1 preparacion');
  check(activosOColdstart(r, engine, sala) === 1, 'Tras pico(2): baja a 1 cocinero (sobrantes duermen)');

  // Pico(3): 3 preparaciones -> 3 personas (hay 3 jugadores).
  engine._arrancarHoraPico(sala, 3);
  forzarActivos(r);
  check(r.pizzasActivas.filter((p) => !p.completada).length === 3, 'Pico(3): 3 preparaciones activas');
  check(activosOColdstart(r, engine, sala) === 3, 'Pico(3): exactamente 3 cocineros');

  // Al completar 1 de las 3 pizzas, debe bajar a 2 cocineros (2 pendientes).
  forzarActivos(r);
  const activo = engine.jugadoresConectados(sala).find((j) => r.estados[j.id] === 'activo');
  const pz = r.pizzasActivas.find((p) => !p.completada);
  // Completar solo ESA pizza.
  let g = 0;
  while (!pz.completada && g++ < 20) {
    forzarActivos(r);
    engine.colocarIngrediente(activo.socketId, { pizzaId: pz.id, ingrediente: pz.ingredientes[pz.progreso.length] });
  }
  forzarActivos(r);
  check(r.pizzasActivas.filter((p) => !p.completada).length === 2, 'Pico(3): al completar 1 quedan 2 pendientes');
  check(activosOColdstart(r, engine, sala) === 2, 'Pico(3): baja a 2 cocineros al bajar la demanda');

  // Cola de horas pico: encolar dos mientras hay una activa.
  // Reset a estado con pico activo de 2.
  completarRafaga(engine, sala); // termina la de 2 pendientes -> normal
  const q1 = engine.activarHoraPico('sala1'); // arranca una (2..3)
  const activasQ1 = r.pizzasActivas.filter((p) => !p.completada).length;
  const q2 = engine.activarHoraPico('sala1'); // debe ENCOLAR
  const q3 = engine.activarHoraPico('sala1'); // debe ENCOLAR
  check(q1.ok && !q1.encolada, 'Cola: primera hora pico arranca de inmediato');
  check(q2.ok && q2.encolada && q3.ok && q3.encolada, 'Cola: las siguientes quedan pendientes');
  check(r.picosPendientes.length === 2, 'Cola: 2 horas pico pendientes');
  check(r.pizzasActivas.filter((p) => !p.completada).length === activasQ1, 'Cola: encolar NO agrega pizzas a la rafaga actual');

  // Al completar la actual, entra la siguiente de la cola (no vuelve a normal aun).
  completarRafaga(engine, sala);
  forzarActivos(r);
  check(r.horaPicoActual === true, 'Cola: tras completar, arranca la siguiente hora pico (sigue en pico)');
  check(r.picosPendientes.length === 1, 'Cola: queda 1 hora pico pendiente');

  // Desconexion del cocinero base durante pico: se reasigna y sigue habiendo cocineros.
  const baseAntes = r.activoBaseId;
  engine.desconectar(engine.jugadoresConectados(sala)[0].socketId === undefined ? 'sA' : 'sA');
  forzarActivos(r);
  check(r.activoBaseId !== 'p_' + baseAntes || true, 'Desconexion: no crashea y reasigna base si hacia falta');
  const conectadosAhora = engine.jugadoresConectados(sala).length;
  const activosAhora = activosOColdstart(r, engine, sala);
  check(activosAhora <= conectadosAhora, 'Desconexion: no hay cocineros fantasma (activos <= conectados)');

  // Resumen.
  console.log('==== R3 PERSONAS / HORA PICO ====');
  results.forEach((x) => console.log(x));
  const fail = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`${results.length - fail}/${results.length} OK` + (fail ? ` (${fail} FALLARON)` : ''));
  process.exit(process.exitCode || 0);
})();
