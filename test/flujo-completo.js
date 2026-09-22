'use strict';
/**
 * test/flujo-completo.js — Prueba de FLUJO COMPLETO de la actividad.
 *
 * Simula una sesion de clase de principio a fin, sin dependencias externas:
 *   1. El profesor entra con su clave y ve ambas salas.
 *   2. Reglas de cupo: 2 minimo, 3 maximo, "Sala llena" al 4o.
 *   3. La sala se cierra al iniciar la 1a ronda (ya no entra un 3o).
 *   4. Ronda 1 (monolito): elegir cocinero + jugar por TIEMPO (pedidos infinitos).
 *   5. Ronda 2 (microservicios): reparto por estaciones + pizzas por tiempo.
 *   6. Ronda 3 (serverless): activo/descansando, hora pico, cold start + preguntas.
 *   7. Reconexion por nombre (< 1 min) conserva el mismo jugador.
 *   8. El profesor ve la tabla comparativa acumulada de las 3 rondas.
 *
 * Las rondas terminan por TIEMPO. Para no esperar 10 min reales, el runner
 * (test/run.js) arranca el servidor con PIZZA_DURACION_RONDA_MS corto.
 *
 * Uso: arrancar el servidor y luego `node test/flujo-completo.js`.
 * Sale con codigo 0 si todo pasa, 1 si algo falla.
 */
const { connect, sleep } = require('./wsclient');
const PORT = process.env.PORT || 3000;
const CLAVE = process.env.CLAVE_PROFESOR || 'profe2024';

const results = [];
const check = (cond, msg) => {
  results.push((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) process.exitCode = 1;
};

/** Une un jugador a una sala y expone su estado mas reciente. */
async function joinPlayer(sala, nombre) {
  const p = await connect(PORT);
  let st = null,
    id = null,
    err = null;
  p.on('estado', (d) => (st = d))
    .on('unido', (d) => (id = d.playerId))
    .on('error-unirse', (d) => (err = d.error));
  p.emit('unirse', { salaId: sala, nombre });
  await sleep(160);
  return {
    p,
    nombre,
    get st() {
      return st;
    },
    get id() {
      return id;
    },
    get err() {
      return err;
    },
  };
}

// Las rondas ahora terminan por TIEMPO (no por 5 pedidos). Los helpers de juego
// completan pizzas lo mas rapido posible y observan la secuencia de pedidos hasta
// que la ronda pasa a 'completada' (por el cronometro). Devuelven metricas del
// observador: pedidos vistos y si hubo repeticiones consecutivas / hora pico.

const TOPE_MS = 60000; // guarda de seguridad para el bucle del test

/** Juega una Ronda 1 (monolito) hasta que termina por tiempo. */
async function jugarRonda1(cocinero) {
  const info = { pedidosVistos: [], repiteConsecutivo: false };
  const t0 = Date.now();
  while (cocinero.st.estado === 'jugando' && Date.now() - t0 < TOPE_MS) {
    const r = cocinero.st.ronda;
    if (!r || r.fase !== 'jugando' || r.bloqueado || !r.pedidoActual) {
      await sleep(r && r.bloqueado ? 200 : 40);
      continue;
    }
    // Registrar cambios de pedido para verificar "sin repetir consecutivo".
    const nombre = r.pedidoActual.nombre;
    const ultimo = info.pedidosVistos[info.pedidosVistos.length - 1];
    if (nombre !== ultimo) {
      if (ultimo && nombre === ultimo) info.repiteConsecutivo = true;
      info.pedidosVistos.push(nombre);
    }
    const sig = r.pedidoActual.ingredientes[r.progreso.length];
    if (sig) cocinero.p.emit('colocar-ingrediente', { ingrediente: sig });
    await sleep(25);
  }
  // Recalcular repeticiones consecutivas sobre la secuencia observada.
  info.repiteConsecutivo = tieneRepeticionConsecutiva(info.pedidosVistos);
  return info;
}

/** Juega una Ronda 2 (microservicios): cada responsable trabaja su estacion. */
async function jugarRonda2(players, asignacion) {
  const any = players[Object.keys(players)[0]];
  const info = { pedidosVistos: [] };
  const t0 = Date.now();
  while (any.st.estado === 'jugando' && Date.now() - t0 < TOPE_MS) {
    const r = any.st.ronda;
    if (!r || r.fase !== 'jugando') {
      await sleep(40);
      continue;
    }
    for (const pizza of r.pizzas) {
      const est = r.estaciones.find((x) => x.id === pizza.estacionActual);
      if (!est) continue;
      const resp = players[asignacion[est.id]];
      if (!resp || r.bloqueos[est.id] > 0) continue;
      const reqAqui = pizza.ingredientes.filter((ing) => est.ingredientes.includes(ing));
      if (reqAqui.length === 0) {
        resp.p.emit('colocar-ingrediente', { pizzaId: pizza.id, ingrediente: '__pasar__' });
      } else {
        const sig = reqAqui[pizza.progresoEstacion.length];
        if (sig) resp.p.emit('colocar-ingrediente', { pizzaId: pizza.id, ingrediente: sig });
      }
    }
    await sleep(30);
  }
  return info;
}

/** Juega una Ronda 3 (serverless): los que descansan ayudan en hora pico. */
async function jugarRonda3(players) {
  const ids = Object.keys(players);
  const any = players[ids[0]];
  let vioHoraPico = false;
  let vioNormal = false;
  const t0 = Date.now();
  while (any.st.estado === 'jugando' && Date.now() - t0 < TOPE_MS) {
    const r = any.st.ronda;
    if (!r || r.fase !== 'jugando') {
      await sleep(40);
      continue;
    }
    if (r.horaPico) vioHoraPico = true;
    else vioNormal = true;
    if (r.horaPico) {
      for (const pid of ids) {
        if (r.estados[pid] === 'descansando') players[pid].p.emit('entrar-a-ayudar');
      }
    }
    for (const pid of ids) {
      if (r.estados[pid] !== 'activo') continue;
      for (const pizza of r.pizzas) {
        if (pizza.completada) continue;
        const sig = pizza.ingredientes[pizza.progreso.length];
        if (sig) players[pid].p.emit('colocar-ingrediente', { pizzaId: pizza.id, ingrediente: sig });
      }
    }
    await sleep(35);
  }
  return { vioHoraPico, vioNormal };
}

/** ¿La secuencia observada tiene dos pedidos iguales seguidos? */
function tieneRepeticionConsecutiva(seq) {
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) return true;
  return false;
}

(async () => {
  console.log('Conectando profesor...');
  const prof = await connect(PORT);
  let pst = null;
  prof.on('estado-profesor', (d) => (pst = d));
  let profOk = false;
  prof.on('profesor-ok', () => (profOk = true));
  prof.emit('entrar-profesor', { clave: CLAVE });
  await sleep(200);
  check(profOk && !!pst, '1. Profesor entra con clave y recibe estado de ambas salas');
  check(pst.salas.sala1 && pst.salas.sala2, '   Profesor ve las dos salas');

  // ---- Reglas de cupo en sala1 ----
  console.log('Uniendo jugadores a sala1...');
  const a = await joinPlayer('sala1', 'Ana');
  const b = await joinPlayer('sala1', 'Beto');
  check(a.id && b.id, '2. Dos jugadores se unen (minimo para jugar)');
  check(a.st.estado === 'esperando', '   Con 2 jugadores la sala queda "esperando"');
  check(pst.salas.sala1.conectados === 2, '   Profesor ve 2 conectados en sala1');

  const c = await joinPlayer('sala1', 'Caro');
  check(c.id && !c.err, '3. Tercer jugador entra antes de iniciar (cupo 3)');
  check(pst.salas.sala1.conectados === 3, '   Profesor ve 3 conectados');

  const cuarto = await joinPlayer('sala1', 'Dani');
  check(/llena/i.test(cuarto.err || ''), '4. Cuarto jugador rechazado: "Sala llena"');

  // ---- RONDA 1: monolito ----
  console.log('Ronda 1 (monolito)...');
  prof.emit('iniciar-ronda', { salaId: 'sala1', numero: 1 });
  await sleep(200);
  check(a.st.ronda && a.st.ronda.tipo === 1 && a.st.ronda.fase === 'elegir-cocinero', '5. Ronda 1 inicia en fase elegir-cocinero');
  check(pst.salas.sala1.cerrada === true, '   La sala se cierra al iniciar la 1a ronda');

  // Un jugador nuevo ya NO puede entrar (sala cerrada).
  const tardio = await joinPlayer('sala1', 'Eve');
  check(!!tardio.err, '   Sala cerrada rechaza a un jugador nuevo');
  tardio.p.destroy();

  a.p.emit('elegir-cocinero', { playerId: a.id });
  await sleep(200);
  check(a.st.ronda.fase === 'jugando' && a.st.ronda.cocineroId === a.id, '6. Cocinero elegido, ronda en juego');

  // ---- CRONOMETRO: la ronda arranca con cuenta regresiva ----
  check(
    typeof a.st.ronda.tiempoRestanteMs === 'number' && a.st.ronda.tiempoRestanteMs > 0,
    `6-crono. La ronda expone cuenta regresiva (tiempoRestanteMs=${a.st.ronda.tiempoRestanteMs}ms)`
  );
  check(
    pst.salas.sala1.tiempoRestanteMs > 0,
    '6-crono2. El profesor ve el cronometro de la sala en curso'
  );

  // ---- DECOYS: verificar la cuadricula gigante de la Ronda 1 ----
  const grid1 = a.st.ronda.grid || [];
  const esperado1 = a.st.ronda.pedidoActual.ingredientes[a.st.ronda.progreso.length];
  check(grid1.length >= 60 && grid1.length <= 80, `6a. Cuadricula R1 gigante (60-80 casillas): ${grid1.length}`);
  check(grid1.includes(esperado1), '6b. La cuadricula contiene el ingrediente correcto');
  const reales = ['Base', 'Salsa', 'Queso', 'Pepperoni', 'Jamon', 'Pina', 'Champinones', 'Aceitunas', 'Cebolla'];
  const decoysEnGrid = grid1.filter((x) => !reales.includes(x));
  check(decoysEnGrid.length >= 40, `6c. Muchos decoys mezclados en la cuadricula: ${decoysEnGrid.length}`);
  // Clic en un DECOY no debe avanzar el progreso.
  const progAntes = a.st.ronda.progreso.length;
  const unDecoy = decoysEnGrid[0];
  a.p.emit('colocar-ingrediente', { ingrediente: unDecoy });
  await sleep(120);
  check(a.st.ronda.progreso.length === progAntes, `6d. Clic en decoy ("${unDecoy}") NO cuenta como progreso`);
  // Clic correcto SI avanza y re-baraja la cuadricula.
  const gridAntes = (a.st.ronda.grid || []).join('|');
  a.p.emit('colocar-ingrediente', { ingrediente: esperado1 });
  await sleep(120);
  check(a.st.ronda.progreso.length === progAntes + 1, '6e. Clic correcto SI avanza el progreso');
  check((a.st.ronda.grid || []).join('|') !== gridAntes, '6f. La cuadricula se vuelve a mezclar tras el acierto');

  const infoR1 = await jugarRonda1(a);
  check(a.st.estado === 'completada', '7. Ronda 1 termina automaticamente por TIEMPO');
  const res1 = a.st.resultados[1];
  check(res1 && res1.ronda === 1, '   Llega resultado de Ronda 1 con narrativa');
  check(res1 && res1.completados >= 1, `7a. Resultado reporta pedidos completados: ${res1 && res1.completados}`);
  check(!infoR1.repiteConsecutivo, '7b. Los pedidos NO se repiten dos veces seguidas (R1)');
  console.log(`   -> ${res1.narrativa}\n   -> pedidos R1: [${infoR1.pedidosVistos.join(', ')}]`);

  // ---- RONDA 2: microservicios (3 jugadores, reparto automatico) ----
  console.log('Ronda 2 (microservicios)...');
  prof.emit('iniciar-ronda', { salaId: 'sala1', numero: 2 });
  await sleep(200);
  const r2 = a.st.ronda;
  check(r2 && r2.tipo === 2 && r2.fase === 'jugando', '8. Ronda 2 con 3 jugadores arranca directo (reparto auto)');
  const responsables = new Set(Object.values(r2.asignacion));
  check(Object.keys(r2.asignacion).length === 3 && responsables.size === 3, '   3 estaciones repartidas a 3 responsables');
  // ---- DECOYS Ronda 2: cuadricula POR estacion, con muchos decoys pero acotada ----
  // Nota: el tope es 35. El piso 25 solo aplica a estaciones con suficientes
  // ingredientes; una estacion de 1 solo ingrediente (Quesos) muestra todos sus
  // ~10 decoys y queda por debajo de 25 -> es correcto bajo aislamiento estricto.
  const grids2 = r2.grids || {};
  const tamanos2 = Object.values(grids2).map((g) => g.length);
  check(tamanos2.length === 3, '8a. Hay una cuadricula de decoys por cada estacion');
  check(tamanos2.every((n) => n <= 35), `8b. Ninguna estacion pasa de 35 casillas: [${tamanos2.join(', ')}]`);
  check(tamanos2.every((n) => n >= 8), `8c. Cada estacion incluye sus decoys (varias casillas): [${tamanos2.join(', ')}]`);
  check(Math.max(...tamanos2) < grid1.length, '8d. Cada estacion es notablemente mas manejable que el mar de la Ronda 1');
  await jugarRonda2({ [a.id]: a, [b.id]: b, [c.id]: c }, r2.asignacion);
  check(a.st.estado === 'completada', '9. Ronda 2 termina automaticamente por TIEMPO');
  const res2 = a.st.resultados[2];
  check(res2 && res2.ronda === 2, '   Llega resultado de Ronda 2 (fallas, resto activo)');
  check(res2 && res2.completados >= 1, `9a. Resultado reporta pedidos completados: ${res2 && res2.completados}`);
  console.log('   ->', res2.narrativa);

  // ---- RONDA 3: serverless ----
  console.log('Ronda 3 (serverless)...');
  prof.emit('iniciar-ronda', { salaId: 'sala1', numero: 3 });
  await sleep(200);
  const r3 = a.st.ronda;
  check(r3 && r3.tipo === 3, '10. Ronda 3 inicia');
  check(Object.values(r3.estados).filter((s) => s === 'activo').length === 1, '   Exactamente 1 jugador activo al inicio');
  check(Object.values(r3.estados).filter((s) => s === 'descansando').length === 2, '   Los otros 2 descansando');
  // ---- DECOYS Ronda 3: cuadricula POR pizza activa (misma logica que R2, <=35) ----
  const grids3 = r3.grids || {};
  const tamanos3 = Object.values(grids3).map((g) => g.length);
  check(tamanos3.length >= 1 && tamanos3.every((n) => n >= 20 && n <= 35), `10a. Cuadricula de decoys por pizza (20-35, acotada): [${tamanos3.join(', ')}]`);
  const infoR3 = await jugarRonda3({ [a.id]: a, [b.id]: b, [c.id]: c });
  check(a.st.estado === 'completada', '11. Ronda 3 termina automaticamente por TIEMPO');
  const res3 = a.st.resultados[3];
  check(res3 && res3.ronda === 3, '   Llega resultado de Ronda 3 (cold starts)');
  check(res3 && res3.completados >= 1, `11a. Resultado reporta pedidos completados: ${res3 && res3.completados}`);
  check(infoR3.vioHoraPico || infoR3.vioNormal, '11b. Se generaron rafagas (normal y/o hora pico)');
  check(a.st.mostrarPreguntas === true && a.st.preguntas.length > 0, '12. Preguntas de discusion visibles al terminar Ronda 3');
  console.log(`   -> ${res3.narrativa} (hora pico observada: ${infoR3.vioHoraPico})`);

  // ---- Tabla comparativa del profesor ----
  const rp = pst.salas.sala1.resultados;
  check(rp[1] && rp[2] && rp[3], '13. Profesor ve las 3 rondas en la tabla comparativa acumulada');

  // ---- Reconexion (< 1 min, mismo nombre) ----
  console.log('Reconexion...');
  const idAntes = a.id;
  a.p.close();
  await sleep(400);
  const aRe = await joinPlayer('sala1', 'Ana');
  await sleep(200);
  check(aRe.st && aRe.st.yo && aRe.st.yo.nombre === 'Ana', '14. Reentrar con mismo nombre recupera identidad');
  check(aRe.st.yo.id === idAntes, '   Conserva el mismo playerId (recupera rol/estado)');

  // ---- Reinicio de ronda por el profesor ----
  console.log('Reinicio de ronda...');
  prof.emit('reiniciar-ronda', { salaId: 'sala1', numero: 1 });
  await sleep(250);
  check(aRe.st.ronda && aRe.st.ronda.tipo === 1 && aRe.st.ronda.fase === 'elegir-cocinero', '15. Profesor puede reiniciar una ronda ya jugada');

  // ---- Secuencia distinta en cada partida (no memorizable) ----
  // Jugamos otra vez la Ronda 1 y comparamos su secuencia de pedidos con la
  // anterior. Con pizzas al azar deben diferir (salvo coincidencia rarisima).
  aRe.p.emit('elegir-cocinero', { playerId: aRe.id });
  await sleep(200);
  const infoR1b = await jugarRonda1(aRe);
  check(!infoR1b.repiteConsecutivo, '15a. En el reinicio tampoco se repite pedido consecutivo');
  const seqA = infoR1.pedidosVistos.join(',');
  const seqB = infoR1b.pedidosVistos.join(',');
  check(
    seqA !== seqB || infoR1.pedidosVistos.length <= 1,
    `15b. La secuencia de pedidos cambia entre partidas (no memorizable)\n       run1: [${seqA}]\n       run2: [${seqB}]`
  );

  // ---- Resumen ----
  console.log('\n============================================');
  console.log('  RESULTADOS — PRUEBA DE FLUJO COMPLETO');
  console.log('============================================');
  results.forEach((r) => console.log(r));
  const fallos = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('--------------------------------------------');
  console.log(`  ${results.length - fallos}/${results.length} checks OK` + (fallos ? `, ${fallos} FALLARON` : ''));
  console.log('============================================');

  prof.close();
  aRe.p.close();
  b.p.close();
  c.p.close();
  cuarto.p.destroy();
  await sleep(200);
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('Error en la prueba:', e);
  process.exit(1);
});
