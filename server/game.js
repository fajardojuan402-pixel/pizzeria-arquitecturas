'use strict';

/**
 * game.js — El "cerebro" de la actividad. Contiene TODO el estado en memoria y
 * la logica de las tres rondas. No hay base de datos: si el proceso se reinicia,
 * el estado se pierde (adecuado para una sesion de clase).
 *
 * Mapa mental de la metafora:
 *   Ronda 1 = MONOLITO      -> un solo cocinero hace todo; si se cae, se cae todo.
 *   Ronda 2 = MICROSERVICIOS-> estaciones independientes; una falla no frena al resto.
 *   Ronda 3 = SERVERLESS    -> instancias que "duermen" y arrancan bajo demanda (cold start).
 *
 * El objeto GameEngine expone metodos que los handlers de WebSocket invocan.
 * Cada cambio relevante dispara this.onUpdate(salaId) para que la capa de red
 * reenvie el estado a jugadores y profesor.
 */

const {
  INGREDIENTES,
  PEDIDOS,
  ESTACIONES,
  PEDIDOS_POR_RONDA,
  BLOQUEO_MS,
  COLD_START_MS,
  PREGUNTAS_DISCUSION,
} = require('./catalog');

const SALAS = ['sala1', 'sala2'];
const MIN_JUGADORES = 2;
const MAX_JUGADORES = 3;
const RECONEXION_MS = 60000; // ventana de 1 minuto para recuperar rol por nombre

// --- Utilidades pequenas -------------------------------------------------

const ahora = () => Date.now();
const dado = () => 1 + Math.floor(Math.random() * 6); // 1..6
const elige = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Devuelve una copia barajada del array (Fisher-Yates). */
function baraja(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Genera la secuencia de 5 pedidos de una ronda (pizzas al azar con repeticion). */
function generarPedidos(n = PEDIDOS_POR_RONDA) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = elige(PEDIDOS);
    out.push({ nombre: base.nombre, ingredientes: base.ingredientes.slice() });
  }
  return out;
}

// --- Modelo de estado -----------------------------------------------------

/**
 * Estructura de una sala:
 * {
 *   id, jugadores: Map(playerId -> jugador),
 *   estado: 'lobby' | 'esperando' | 'jugando' | 'completada',
 *   rondaActual: 0|1|2|3,
 *   cerrada: bool,               // true tras iniciar la 1a ronda: no admite 3er jugador
 *   ronda: objeto de la ronda en curso (o null),
 *   resultados: { 1: {...}, 2: {...}, 3: {...} },  // metricas por ronda ya jugada
 *   mostrarPreguntas: bool,
 * }
 *
 * jugador: { id, nombre, salaId, conectado, desconectadoEn, rol, ...campos de ronda }
 */
class GameEngine {
  constructor(onUpdate) {
    // onUpdate(salaId) se llama cada vez que cambia algo -> la red reemite estado.
    this.onUpdate = onUpdate || (() => {});
    this.salas = {};
    for (const id of SALAS) {
      this.salas[id] = {
        id,
        jugadores: new Map(),
        estado: 'lobby',
        rondaActual: 0,
        cerrada: false,
        ronda: null,
        resultados: {},
        mostrarPreguntas: false,
        timers: new Set(), // timers activos, para poder limpiarlos al reiniciar
      };
    }
    // Indice global de jugadores por id de conexion, para resolver eventos.
    this.playerBySocket = new Map(); // socketId -> { salaId, playerId }
  }

  // ---- Helpers de acceso -------------------------------------------------

  getSala(salaId) {
    return this.salas[salaId] || null;
  }

  jugadoresConectados(sala) {
    return [...sala.jugadores.values()].filter((j) => j.conectado);
  }

  /** Programa un timer y lo registra para poder cancelarlo si se reinicia la ronda. */
  _timer(sala, fn, ms) {
    const t = setTimeout(() => {
      sala.timers.delete(t);
      fn();
    }, ms);
    sala.timers.add(t);
    return t;
  }

  _limpiarTimers(sala) {
    for (const t of sala.timers) clearTimeout(t);
    sala.timers.clear();
  }

  // ---- Ingreso / reconexion ---------------------------------------------

  /**
   * Un jugador intenta unirse a una sala con su nombre.
   * Reglas de cupo:
   *  - Maximo 3 jugadores.
   *  - Si la sala ya inicio su primera ronda (cerrada), no admite un 3er jugador
   *    nuevo, aunque tuviera cupo fisico.
   *  - Reconexion: si existe un jugador con el mismo nombre desconectado hace
   *    < 1 min, recupera su lugar/rol.
   * Devuelve { ok, playerId, error }.
   */
  unirse(socketId, salaId, nombreRaw) {
    const sala = this.getSala(salaId);
    if (!sala) return { ok: false, error: 'Sala inexistente.' };
    const nombre = String(nombreRaw || '').trim();
    if (!nombre) return { ok: false, error: 'Escribe un nombre.' };

    // 1) Reconexion por nombre (case-insensitive).
    const previo = [...sala.jugadores.values()].find(
      (j) => j.nombre.toLowerCase() === nombre.toLowerCase()
    );
    if (previo) {
      if (previo.conectado) {
        return { ok: false, error: 'Ese nombre ya esta en uso en la sala.' };
      }
      const dentroDeVentana = ahora() - (previo.desconectadoEn || 0) <= RECONEXION_MS;
      if (dentroDeVentana) {
        // Recupera rol y estado: solo actualizamos el socket asociado.
        previo.conectado = true;
        previo.desconectadoEn = null;
        previo.socketId = socketId;
        this.playerBySocket.set(socketId, { salaId, playerId: previo.id });
        this.onUpdate(salaId);
        return { ok: true, playerId: previo.id, reconectado: true };
      }
      // Fuera de ventana: se elimina el registro viejo y entra como nuevo.
      sala.jugadores.delete(previo.id);
    }

    // 2) Ingreso nuevo: validar cupo.
    const conectados = this.jugadoresConectados(sala).length;
    if (conectados >= MAX_JUGADORES) {
      return { ok: false, error: 'Sala llena.' };
    }
    if (sala.cerrada) {
      return {
        ok: false,
        error: 'La sala ya inicio la actividad y no admite nuevos jugadores.',
      };
    }

    const playerId = `p_${Math.random().toString(36).slice(2, 8)}`;
    const jugador = {
      id: playerId,
      nombre,
      salaId,
      socketId,
      conectado: true,
      desconectadoEn: null,
      rol: null, // se asigna al iniciar cada ronda
    };
    sala.jugadores.set(playerId, jugador);
    this.playerBySocket.set(socketId, { salaId, playerId });

    // Si estabamos en lobby y ya hay minimo de jugadores, pasamos a "esperando".
    if (sala.estado === 'lobby' && this.jugadoresConectados(sala).length >= MIN_JUGADORES) {
      sala.estado = 'esperando';
    }
    this.onUpdate(salaId);
    return { ok: true, playerId };
  }

  /** Marca desconexion. No borra al jugador de inmediato (ventana de reconexion). */
  desconectar(socketId) {
    const ref = this.playerBySocket.get(socketId);
    this.playerBySocket.delete(socketId);
    if (!ref) return;
    const sala = this.getSala(ref.salaId);
    if (!sala) return;
    const jugador = sala.jugadores.get(ref.playerId);
    if (!jugador) return;
    jugador.conectado = false;
    jugador.desconectadoEn = ahora();

    // Purga diferida: si no vuelve en la ventana, se elimina el registro.
    this._timer(
      sala,
      () => {
        const j = sala.jugadores.get(ref.playerId);
        if (j && !j.conectado && ahora() - (j.desconectadoEn || 0) >= RECONEXION_MS) {
          sala.jugadores.delete(ref.playerId);
          if (this.jugadoresConectados(sala).length < MIN_JUGADORES && sala.estado === 'esperando') {
            sala.estado = 'lobby';
          }
          this.onUpdate(sala.id);
        }
      },
      RECONEXION_MS + 500
    );

    this.onUpdate(sala.id);
  }

  // ---- Control del profesor ---------------------------------------------

  /**
   * Inicia una ronda (1, 2 o 3) en una sala. El profesor puede iniciarla en
   * cualquier momento y orden, siempre que haya >= 2 jugadores conectados.
   * Al iniciar la PRIMERA ronda de la sala, esta se "cierra" (no admite 3er
   * jugador nuevo).
   */
  iniciarRonda(salaId, numero) {
    const sala = this.getSala(salaId);
    if (!sala) return { ok: false, error: 'Sala inexistente.' };
    const conectados = this.jugadoresConectados(sala);
    if (conectados.length < MIN_JUGADORES) {
      return { ok: false, error: 'Se necesitan al menos 2 jugadores conectados.' };
    }

    this._limpiarTimers(sala);
    sala.cerrada = true; // ya no entran nuevos jugadores
    sala.rondaActual = numero;
    sala.mostrarPreguntas = false;

    if (numero === 1) this._iniciarRonda1(sala, conectados);
    else if (numero === 2) this._iniciarRonda2(sala, conectados);
    else if (numero === 3) this._iniciarRonda3(sala, conectados);
    else return { ok: false, error: 'Numero de ronda invalido.' };

    this.onUpdate(salaId);
    return { ok: true };
  }

  /** Reinicia (vuelve a jugar) la ronda indicada desde cero. */
  reiniciarRonda(salaId, numero) {
    const sala = this.getSala(salaId);
    if (!sala) return { ok: false, error: 'Sala inexistente.' };
    // Reiniciar = simplemente iniciar de nuevo esa ronda.
    return this.iniciarRonda(salaId, numero);
  }

  /** El profesor fuerza mostrar las preguntas de discusion. */
  mostrarPreguntas(salaId) {
    const sala = this.getSala(salaId);
    if (!sala) return { ok: false, error: 'Sala inexistente.' };
    sala.mostrarPreguntas = true;
    this.onUpdate(salaId);
    return { ok: true };
  }

  // =======================================================================
  // RONDA 1 — MONOLITO ("Fabrica de un solo cocinero")
  // =======================================================================
  // Un solo cocinero arma TODAS las pizzas. Si el dado saca 1 o 2, TODO se
  // detiene 20s (no hay a quien delegar): igual que un monolito que, al fallar
  // o necesitar mantenimiento, tumba el sistema completo.
  _iniciarRonda1(sala, conectados) {
    sala.estado = 'jugando';
    sala.ronda = {
      tipo: 1,
      fase: 'elegir-cocinero', // los jugadores eligen 1 cocinero antes de arrancar
      pedidos: generarPedidos(),
      indice: 0,
      progreso: [], // ingredientes ya colocados del pedido actual
      cocineroId: null,
      bloqueado: false,
      bloqueoHasta: 0,
      inicio: null, // se fija cuando arranca de verdad (tras elegir cocinero)
      fin: null,
      metricas: { completados: 0, bloqueos: 0 },
    };
    // Reset de roles.
    for (const j of conectados) j.rol = null;
  }

  /** Un jugador se postula/elige como cocinero (primera eleccion gana). */
  elegirCocinero(socketId, playerId) {
    const ref = this.playerBySocket.get(socketId);
    if (!ref) return;
    const sala = this.getSala(ref.salaId);
    if (!sala || !sala.ronda || sala.ronda.tipo !== 1) return;
    if (sala.ronda.fase !== 'elegir-cocinero') return;

    const objetivo = playerId || ref.playerId;
    const jugador = sala.jugadores.get(objetivo);
    if (!jugador || !jugador.conectado) return;

    sala.ronda.cocineroId = objetivo;
    sala.ronda.fase = 'jugando';
    sala.ronda.inicio = ahora();
    for (const j of this.jugadoresConectados(sala)) {
      j.rol = j.id === objetivo ? 'Cocinero' : 'Observador';
    }
    this.onUpdate(sala.id);
  }

  // =======================================================================
  // RONDA 2 — MICROSERVICIOS ("Por estaciones")
  // =======================================================================
  // Cada estacion (Masa/Quesos/Toppings) es un "microservicio": solo maneja sus
  // ingredientes y puede trabajar en paralelo. Si el dado saca 1 o 2 se bloquea
  // UNA estacion al azar 20s; las demas siguen -> aislamiento de fallos.
  // Con 2 jugadores, uno cubre 2 estaciones (menos "instancias" = mas carga).
  _iniciarRonda2(sala, conectados) {
    sala.estado = 'jugando';
    const tresJugadores = conectados.length >= 3;
    sala.ronda = {
      tipo: 2,
      // Con 3 jugadores el reparto es automatico; con 2, hay pantalla previa.
      fase: tresJugadores ? 'jugando' : 'elegir-roles',
      pedidos: generarPedidos(),
      // pizzas en proceso: cada una con su estado (indice de estacion) y progreso.
      pizzas: [],
      siguientePedido: 0,
      // asignacion: estacionId -> playerId (quien es responsable)
      asignacion: {},
      // bloqueos por estacion: estacionId -> timestamp hasta
      bloqueos: {},
      inicio: tresJugadores ? ahora() : null,
      fin: null,
      metricas: {
        completados: 0,
        fallas: 0,
        // Para "tiempo que el resto siguio activo durante cada falla" registramos
        // cuantas estaciones seguian disponibles en cada bloqueo.
        detalleFallas: [],
      },
    };
    for (const j of conectados) j.rol = null;

    if (tresJugadores) {
      // Reparto normal: una estacion por jugador (orden estable).
      ESTACIONES.forEach((est, i) => {
        const jugador = conectados[i];
        sala.ronda.asignacion[est.id] = jugador.id;
      });
      this._sincronizarRolesRonda2(sala);
      this._lanzarSiguientePizza(sala);
    }
    // Con 2 jugadores esperamos a que confirmen roles (confirmarRolesRonda2).
  }

  /**
   * Con 2 jugadores: reciben la asignacion { estacionId: playerId } elegida por
   * ellos. Validamos que cada estacion tenga responsable y que ambos jugadores
   * participen (uno cubrira 2 estaciones).
   */
  confirmarRolesRonda2(socketId, asignacion) {
    const ref = this.playerBySocket.get(socketId);
    if (!ref) return { ok: false, error: 'Jugador no encontrado.' };
    const sala = this.getSala(ref.salaId);
    if (!sala || !sala.ronda || sala.ronda.tipo !== 2) return { ok: false, error: 'Ronda invalida.' };
    if (sala.ronda.fase !== 'elegir-roles') return { ok: false, error: 'Los roles ya fueron definidos.' };

    const jugadores = this.jugadoresConectados(sala);
    const ids = new Set(jugadores.map((j) => j.id));
    // Toda estacion debe tener un responsable valido.
    for (const est of ESTACIONES) {
      const asignado = asignacion && asignacion[est.id];
      if (!asignado || !ids.has(asignado)) {
        return { ok: false, error: 'Cada estacion debe tener un responsable.' };
      }
    }
    sala.ronda.asignacion = { ...asignacion };
    sala.ronda.fase = 'jugando';
    sala.ronda.inicio = ahora();
    this._sincronizarRolesRonda2(sala);
    this._lanzarSiguientePizza(sala);
    this.onUpdate(sala.id);
    return { ok: true };
  }

  /** Recalcula el campo .rol de cada jugador segun las estaciones que cubre. */
  _sincronizarRolesRonda2(sala) {
    const porJugador = {}; // playerId -> [nombresEstacion]
    for (const est of ESTACIONES) {
      const pid = sala.ronda.asignacion[est.id];
      if (!pid) continue;
      (porJugador[pid] = porJugador[pid] || []).push(est.nombre);
    }
    for (const j of this.jugadoresConectados(sala)) {
      j.rol = porJugador[j.id] ? porJugador[j.id].join(' + ') : 'Observador';
    }
  }

  /** Mete la siguiente pizza pendiente al flujo (estado = primera estacion). */
  _lanzarSiguientePizza(sala) {
    const r = sala.ronda;
    if (r.siguientePedido >= r.pedidos.length) return;
    const pedido = r.pedidos[r.siguientePedido];
    r.pizzas.push({
      id: `pz_${r.siguientePedido}`,
      nombre: pedido.nombre,
      ingredientes: pedido.ingredientes.slice(),
      estacionIndice: 0, // indice dentro de ESTACIONES por el que va pasando
      // ingredientes ya colocados en la estacion actual (para estaciones con >1 ingrediente)
      progresoEstacion: [],
      completada: false,
    });
    r.siguientePedido++;
  }

  // =======================================================================
  // RONDA 3 — SERVERLESS ("Fin de semana, bajo demanda")
  // =======================================================================
  // 1 jugador arranca "activo"; el resto "descansando" (instancias apagadas).
  // En "HORA PICO" llegan varias pizzas: los que descansan pueden "Entrar a
  // ayudar" pero pagan un COLD START de 10s antes de poder trabajar. Si ya
  // estaban activos, no repiten cold start. Al terminar la rafaga, cada uno
  // decide volver a descansar o seguir activo.
  _iniciarRonda3(sala, conectados) {
    sala.estado = 'jugando';
    // Secuencia de 5 pedidos: mezcla de normales (1 pizza) y hora pico (2-3).
    const secuencia = this._generarSecuenciaRonda3();
    sala.ronda = {
      tipo: 3,
      fase: 'jugando',
      secuencia, // array de rafagas; cada rafaga = { horaPico, pizzas:[...] }
      rafagaIndice: 0,
      // estado por jugador: 'activo' | 'descansando' | 'coldstart'
      estados: {},
      coldHasta: {}, // playerId -> timestamp fin de cold start
      pizzasActivas: [], // pizzas visibles de la rafaga actual
      inicio: ahora(),
      fin: null,
      metricas: { completados: 0, coldStarts: 0, tiempoColdMs: 0 },
    };
    // El primer jugador (orden de llegada) arranca activo; el resto descansa.
    conectados.forEach((j, i) => {
      sala.ronda.estados[j.id] = i === 0 ? 'activo' : 'descansando';
      j.rol = i === 0 ? 'Activo' : 'Descansando';
    });
    this._cargarRafagaRonda3(sala);
  }

  /** Genera 5 pedidos: cada uno normal (1 pizza) o hora pico (2-3 pizzas). */
  _generarSecuenciaRonda3() {
    const rafagas = [];
    for (let i = 0; i < PEDIDOS_POR_RONDA; i++) {
      const horaPico = Math.random() < 0.45; // ~45% de las veces
      const cantidad = horaPico ? 2 + Math.floor(Math.random() * 2) : 1; // 2 o 3
      const pizzas = [];
      for (let k = 0; k < cantidad; k++) {
        const base = elige(PEDIDOS);
        pizzas.push({
          id: `r${i}_${k}`,
          nombre: base.nombre,
          ingredientes: base.ingredientes.slice(),
          progreso: [],
          completada: false,
        });
      }
      rafagas.push({ horaPico, pizzas });
    }
    return rafagas;
  }

  /** Carga la rafaga actual como pizzas activas y notifica hora pico si aplica. */
  _cargarRafagaRonda3(sala) {
    const r = sala.ronda;
    if (r.rafagaIndice >= r.secuencia.length) return;
    const rafaga = r.secuencia[r.rafagaIndice];
    r.pizzasActivas = rafaga.pizzas.map((p) => ({ ...p, progreso: [], completada: false }));
    r.horaPicoActual = rafaga.horaPico;
  }

  /** Un jugador que descansa decide "Entrar a ayudar" -> inicia cold start. */
  entrarAAyudar(socketId) {
    const ref = this.playerBySocket.get(socketId);
    if (!ref) return;
    const sala = this.getSala(ref.salaId);
    if (!sala || !sala.ronda || sala.ronda.tipo !== 3) return;
    const r = sala.ronda;
    const pid = ref.playerId;
    if (r.estados[pid] !== 'descansando') return; // ya esta activo o en cold start

    r.estados[pid] = 'coldstart';
    r.coldHasta[pid] = ahora() + COLD_START_MS;
    r.metricas.coldStarts++;
    const jugador = sala.jugadores.get(pid);
    if (jugador) jugador.rol = 'Cold start...';

    this._timer(
      sala,
      () => {
        // Al terminar el cold start pasa a activo (si sigue en la ronda).
        if (r.estados[pid] === 'coldstart') {
          r.estados[pid] = 'activo';
          r.metricas.tiempoColdMs += COLD_START_MS;
          const j = sala.jugadores.get(pid);
          if (j) j.rol = 'Activo';
          this.onUpdate(sala.id);
        }
      },
      COLD_START_MS
    );
    this.onUpdate(sala.id);
  }

  /** Tras una rafaga, un jugador elige volver a descansar o seguir activo. */
  cambiarDisponibilidad(socketId, quiereDescansar) {
    const ref = this.playerBySocket.get(socketId);
    if (!ref) return;
    const sala = this.getSala(ref.salaId);
    if (!sala || !sala.ronda || sala.ronda.tipo !== 3) return;
    const r = sala.ronda;
    const pid = ref.playerId;
    if (r.estados[pid] === 'coldstart') return; // no se puede cambiar en pleno arranque
    r.estados[pid] = quiereDescansar ? 'descansando' : 'activo';
    const j = sala.jugadores.get(pid);
    if (j) j.rol = quiereDescansar ? 'Descansando' : 'Activo';
    this.onUpdate(sala.id);
  }

  // =======================================================================
  // ACCION COMUN: colocar un ingrediente (interpretada segun la ronda)
  // =======================================================================
  /**
   * El cliente envia { pizzaId, ingrediente }. Segun la ronda:
   *  - R1: el cocinero arma el pedido actual en orden.
   *  - R2: el responsable de la estacion coloca los ingredientes de SU estacion.
   *  - R3: cualquier jugador activo coloca ingredientes en orden.
   */
  colocarIngrediente(socketId, payload) {
    const ref = this.playerBySocket.get(socketId);
    if (!ref) return;
    const sala = this.getSala(ref.salaId);
    if (!sala || !sala.ronda) return;
    const r = sala.ronda;
    if (r.tipo === 1) this._r1Colocar(sala, ref.playerId, payload);
    else if (r.tipo === 2) this._r2Colocar(sala, ref.playerId, payload);
    else if (r.tipo === 3) this._r3Colocar(sala, ref.playerId, payload);
  }

  // ---- Ronda 1: colocar --------------------------------------------------
  _r1Colocar(sala, playerId, { ingrediente }) {
    const r = sala.ronda;
    if (r.fase !== 'jugando') return;
    if (playerId !== r.cocineroId) return; // solo el cocinero
    if (r.bloqueado && ahora() < r.bloqueoHasta) return; // en bloqueo

    const pedido = r.pedidos[r.indice];
    if (!pedido) return;
    const esperado = pedido.ingredientes[r.progreso.length];
    if (ingrediente !== esperado) return; // ingrediente incorrecto: se ignora

    r.progreso.push(ingrediente);

    if (r.progreso.length === pedido.ingredientes.length) {
      // Pizza completada.
      r.metricas.completados++;
      r.progreso = [];
      r.indice++;

      if (r.indice >= r.pedidos.length) {
        return this._finalizarRonda(sala);
      }
      // Tira el dado: 1 o 2 -> bloqueo de 20s (el monolito entero se detiene).
      if (dado() <= 2) {
        r.bloqueado = true;
        r.bloqueoHasta = ahora() + BLOQUEO_MS;
        r.metricas.bloqueos++;
        this._timer(
          sala,
          () => {
            r.bloqueado = false;
            r.bloqueoHasta = 0;
            this.onUpdate(sala.id);
          },
          BLOQUEO_MS
        );
      }
    }
    this.onUpdate(sala.id);
  }

  // ---- Ronda 2: colocar --------------------------------------------------
  _r2Colocar(sala, playerId, { pizzaId, ingrediente }) {
    const r = sala.ronda;
    if (r.fase !== 'jugando') return;
    const pizza = r.pizzas.find((p) => p.id === pizzaId && !p.completada);
    if (!pizza) return;

    const estacion = ESTACIONES[pizza.estacionIndice];
    if (!estacion) return;

    // Solo el responsable de esa estacion puede trabajarla...
    if (r.asignacion[estacion.id] !== playerId) return;
    // ...y solo si la estacion no esta bloqueada.
    if (r.bloqueos[estacion.id] && ahora() < r.bloqueos[estacion.id]) return;

    // Que ingredientes de esta pizza corresponden a esta estacion (en orden)?
    const requeridosAqui = pizza.ingredientes.filter((ing) => estacion.ingredientes.includes(ing));
    const esperado = requeridosAqui[pizza.progresoEstacion.length];

    // Si la estacion no aporta ingredientes a esta pizza, se "pasa" directo.
    if (requeridosAqui.length === 0) {
      this._r2AvanzarEstacion(sala, pizza);
      this.onUpdate(sala.id);
      return;
    }
    if (ingrediente !== esperado) return; // incorrecto: ignorar

    pizza.progresoEstacion.push(ingrediente);
    if (pizza.progresoEstacion.length === requeridosAqui.length) {
      this._r2AvanzarEstacion(sala, pizza);
    }
    this.onUpdate(sala.id);
  }

  /** Avanza una pizza a la siguiente estacion; si termina el flujo, se completa. */
  _r2AvanzarEstacion(sala, pizza) {
    const r = sala.ronda;
    pizza.progresoEstacion = [];
    pizza.estacionIndice++;

    // Saltar estaciones que no aportan ingredientes a esta pizza.
    while (pizza.estacionIndice < ESTACIONES.length) {
      const est = ESTACIONES[pizza.estacionIndice];
      const aporta = pizza.ingredientes.some((ing) => est.ingredientes.includes(ing));
      if (aporta) break;
      pizza.estacionIndice++;
    }

    if (pizza.estacionIndice >= ESTACIONES.length) {
      // Pizza terminada.
      pizza.completada = true;
      r.metricas.completados++;

      // Tira el dado: 1 o 2 -> se bloquea UNA estacion al azar 20s.
      if (dado() <= 2) {
        const estBloqueada = elige(ESTACIONES);
        r.bloqueos[estBloqueada.id] = ahora() + BLOQUEO_MS;
        r.metricas.fallas++;
        // Cuantas estaciones seguian activas durante la falla (aislamiento).
        r.metricas.detalleFallas.push({
          estacion: estBloqueada.nombre,
          estacionesActivas: ESTACIONES.length - 1,
          duracionMs: BLOQUEO_MS,
        });
        this._timer(
          sala,
          () => {
            delete r.bloqueos[estBloqueada.id];
            this.onUpdate(sala.id);
          },
          BLOQUEO_MS
        );
      }

      // Mete otra pizza al flujo si quedan pendientes.
      if (r.siguientePedido < r.pedidos.length) {
        this._lanzarSiguientePizza(sala);
      }

      if (r.metricas.completados >= r.pedidos.length) {
        this._finalizarRonda(sala);
      }
    }
  }

  // ---- Ronda 3: colocar --------------------------------------------------
  _r3Colocar(sala, playerId, { pizzaId, ingrediente }) {
    const r = sala.ronda;
    if (r.fase !== 'jugando') return;
    if (r.estados[playerId] !== 'activo') return; // debe estar activo (no descansando/cold)

    const pizza = r.pizzasActivas.find((p) => p.id === pizzaId && !p.completada);
    if (!pizza) return;
    const esperado = pizza.ingredientes[pizza.progreso.length];
    if (ingrediente !== esperado) return;

    pizza.progreso.push(ingrediente);
    if (pizza.progreso.length === pizza.ingredientes.length) {
      pizza.completada = true;
    }

    // La rafaga se completa cuando TODAS sus pizzas estan listas.
    if (r.pizzasActivas.every((p) => p.completada)) {
      r.metricas.completados++; // cada rafaga cuenta como 1 "pedido" completado
      r.rafagaIndice++;

      if (r.rafagaIndice >= r.secuencia.length) {
        return this._finalizarRonda(sala);
      }
      // Cargar la siguiente rafaga. Los que esten en 'activo' siguen activos
      // (NO repiten cold start); los que descansan veran la notificacion si es pico.
      this._cargarRafagaRonda3(sala);
    }
    this.onUpdate(sala.id);
  }

  // =======================================================================
  // FINALIZACION Y RESULTADOS
  // =======================================================================
  _finalizarRonda(sala) {
    const r = sala.ronda;
    r.fin = ahora();

    // Ronda 3: si alguien quedo a mitad de un cold start al terminar la ronda,
    // sumamos el tiempo ya transcurrido de ese arranque (no se desperdicia la
    // metrica solo porque la ronda cerro antes de completarse el arranque).
    if (r.tipo === 3 && r.coldHasta) {
      for (const pid of Object.keys(r.coldHasta)) {
        if (r.estados[pid] === 'coldstart') {
          const transcurrido = COLD_START_MS - Math.max(0, r.coldHasta[pid] - r.fin);
          r.metricas.tiempoColdMs += Math.max(0, transcurrido);
        }
      }
    }

    r.fase = 'completada';
    sala.estado = 'completada';
    this._limpiarTimers(sala);

    const tiempoTotalMs = (r.fin || ahora()) - (r.inicio || r.fin || ahora());
    const resumen = this._construirResumen(r, tiempoTotalMs);
    sala.resultados[r.tipo] = resumen;

    // Al terminar la Ronda 3, mostramos las preguntas de discusion.
    if (r.tipo === 3) sala.mostrarPreguntas = true;

    this.onUpdate(sala.id);
  }

  /** Arma el objeto de resultados + narrativa segun el tipo de ronda. */
  _construirResumen(r, tiempoTotalMs) {
    const seg = (tiempoTotalMs / 1000).toFixed(1);
    if (r.tipo === 1) {
      return {
        ronda: 1,
        titulo: 'Monolito',
        tiempoTotalMs,
        bloqueos: r.metricas.bloqueos,
        narrativa:
          `El unico cocinero completo 5 pizzas en ${seg}s y quedo bloqueado ` +
          `${r.metricas.bloqueos} vez/veces. Como en un monolito, cada bloqueo detuvo ` +
          `TODA la produccion: no habia a quien delegar.`,
      };
    }
    if (r.tipo === 2) {
      const tiempoResto = r.metricas.detalleFallas.reduce(
        (acc, f) => acc + f.duracionMs,
        0
      );
      return {
        ronda: 2,
        titulo: 'Microservicios',
        tiempoTotalMs,
        fallas: r.metricas.fallas,
        tiempoRestoActivoMs: tiempoResto,
        narrativa:
          `Las estaciones completaron 5 pizzas en ${seg}s con ${r.metricas.fallas} ` +
          `falla(s). En cada falla solo se detuvo UNA estacion mientras las demas ` +
          `siguieron trabajando: aislamiento de fallos, como en microservicios.`,
      };
    }
    return {
      ronda: 3,
      titulo: 'Serverless',
      tiempoTotalMs,
      coldStarts: r.metricas.coldStarts,
      tiempoColdMs: r.metricas.tiempoColdMs,
      narrativa:
        `Se atendieron 5 pedidos en ${seg}s con ${r.metricas.coldStarts} cold start(s), ` +
        `perdiendo ${(r.metricas.tiempoColdMs / 1000).toFixed(0)}s en arranques. ` +
        `Escalar bajo demanda ahorra recursos en reposo pero cada arranque cuesta tiempo.`,
    };
  }

  // =======================================================================
  // SERIALIZACION PARA LOS CLIENTES
  // =======================================================================
  /**
   * Vista que recibe UN jugador de su sala (incluye solo lo que le corresponde).
   */
  vistaJugador(salaId, playerId) {
    const sala = this.getSala(salaId);
    if (!sala) return null;
    const jugador = sala.jugadores.get(playerId);
    const base = {
      salaId,
      estado: sala.estado,
      rondaActual: sala.rondaActual,
      cerrada: sala.cerrada,
      jugadores: this.jugadoresConectados(sala).map((j) => ({
        id: j.id,
        nombre: j.nombre,
        rol: j.rol,
      })),
      yo: jugador ? { id: jugador.id, nombre: jugador.nombre, rol: jugador.rol } : null,
      mostrarPreguntas: sala.mostrarPreguntas,
      preguntas: sala.mostrarPreguntas ? PREGUNTAS_DISCUSION : [],
      resultados: sala.resultados,
      catalogo: { ingredientes: INGREDIENTES, estaciones: ESTACIONES },
      ronda: this._serializarRonda(sala),
    };
    return base;
  }

  /** Vista para el profesor: ambas salas + tabla comparativa. */
  vistaProfesor() {
    const salas = {};
    for (const id of SALAS) {
      const sala = this.salas[id];
      salas[id] = {
        id,
        estado: sala.estado,
        rondaActual: sala.rondaActual,
        cerrada: sala.cerrada,
        // Descripcion textual del estado exacto (para el panel).
        estadoTexto: this._estadoTexto(sala),
        conectados: this.jugadoresConectados(sala).length,
        jugadores: this.jugadoresConectados(sala).map((j) => ({ nombre: j.nombre, rol: j.rol })),
        resultados: sala.resultados,
        mostrarPreguntas: sala.mostrarPreguntas,
      };
    }
    return { salas, preguntas: PREGUNTAS_DISCUSION };
  }

  _estadoTexto(sala) {
    if (sala.estado === 'lobby') return 'Esperando jugadores (min. 2)';
    if (sala.estado === 'esperando') return 'Lista — esperando que inicies una ronda';
    if (sala.estado === 'jugando') {
      const fase = sala.ronda && sala.ronda.fase;
      if (fase === 'elegir-cocinero') return `Ronda 1: eligiendo cocinero`;
      if (fase === 'elegir-roles') return `Ronda 2: repartiendo estaciones`;
      return `Jugando Ronda ${sala.rondaActual}`;
    }
    if (sala.estado === 'completada') return `Ronda ${sala.rondaActual} completada`;
    return sala.estado;
  }

  /** Serializa la ronda en curso con lo necesario para pintar la UI. */
  _serializarRonda(sala) {
    const r = sala.ronda;
    if (!r) return null;
    if (r.tipo === 1) {
      const pedido = r.pedidos[r.indice] || null;
      return {
        tipo: 1,
        fase: r.fase,
        cocineroId: r.cocineroId,
        pedidoActual: pedido,
        progreso: r.progreso,
        indice: r.indice,
        total: r.pedidos.length,
        bloqueado: r.bloqueado,
        bloqueoRestanteMs: r.bloqueado ? Math.max(0, r.bloqueoHasta - ahora()) : 0,
        metricas: r.metricas,
      };
    }
    if (r.tipo === 2) {
      return {
        tipo: 2,
        fase: r.fase,
        asignacion: r.asignacion,
        estaciones: ESTACIONES,
        pizzas: r.pizzas
          .filter((p) => !p.completada)
          .map((p) => ({
            id: p.id,
            nombre: p.nombre,
            ingredientes: p.ingredientes,
            estacionIndice: p.estacionIndice,
            estacionActual: ESTACIONES[p.estacionIndice] ? ESTACIONES[p.estacionIndice].id : null,
            progresoEstacion: p.progresoEstacion,
          })),
        bloqueos: Object.fromEntries(
          Object.entries(r.bloqueos).map(([k, v]) => [k, Math.max(0, v - ahora())])
        ),
        completados: r.metricas.completados,
        total: r.pedidos.length,
        metricas: r.metricas,
      };
    }
    if (r.tipo === 3) {
      return {
        tipo: 3,
        fase: r.fase,
        estados: r.estados,
        coldRestante: Object.fromEntries(
          Object.entries(r.coldHasta).map(([k, v]) => [k, Math.max(0, v - ahora())])
        ),
        horaPico: !!r.horaPicoActual,
        pizzas: r.pizzasActivas.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          ingredientes: p.ingredientes,
          progreso: p.progreso,
          completada: p.completada,
        })),
        completados: r.metricas.completados,
        total: r.secuencia.length,
        metricas: r.metricas,
      };
    }
    return null;
  }
}

module.exports = { GameEngine, SALAS, MIN_JUGADORES, MAX_JUGADORES };
