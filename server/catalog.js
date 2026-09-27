'use strict';

/**
 * catalog.js — Datos de dominio (ingredientes, pizzas, estaciones, textos).
 *
 * Todo lo "de contenido" vive aqui para que un profesor pueda ajustar la
 * actividad sin tocar la logica del juego.
 */

// Ingredientes disponibles (el orden es el que se muestra en pantalla).
const INGREDIENTES = [
  // Masa (bases y salsas) — la estacion "Masa" ahora tiene variedad real.
  'Base',
  'Base integral',
  'Salsa',
  'Salsa blanca',
  // Quesos — la estacion "Quesos" tambien tiene variedad real.
  'Queso',
  'Queso mozzarella',
  'Queso cheddar',
  // Toppings.
  'Pepperoni',
  'Jamon',
  'Pina',
  'Champinones',
  'Aceitunas',
  'Cebolla',
  'Tocineta',
  'Maiz',
  'Pimenton',
  'Tomate',
  'Carne',
  'Pollo',
];

// Catalogo de pedidos de EJEMPLO (recetas "clasicas"). Historicamente los
// pedidos salian de aqui, pero ahora cada pizza se ARMA AL AZAR combinando
// cualquiera de los ingredientes disponibles (ver elegirPedidoAleatorio). Se
// conserva como referencia/documentacion y por compatibilidad de imports.
const PEDIDOS = [
  { nombre: 'Margarita', ingredientes: ['Base', 'Salsa', 'Queso'] },
  { nombre: 'Hawaiana', ingredientes: ['Base', 'Salsa', 'Queso', 'Pina', 'Jamon'] },
  { nombre: 'Pepperoni', ingredientes: ['Base', 'Salsa', 'Queso', 'Pepperoni'] },
  {
    nombre: 'Vegetariana',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Champinones', 'Aceitunas', 'Cebolla'],
  },
  { nombre: 'Especial', ingredientes: ['Base', 'Salsa', 'Queso', 'Pepperoni', 'Cebolla'] },
  {
    nombre: 'Mexicana',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Carne', 'Maiz', 'Pimenton'],
  },
  {
    nombre: 'Barbacoa',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Pollo', 'Cebolla', 'Tocineta'],
  },
  {
    nombre: 'Campesina',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Tocineta', 'Maiz', 'Champinones'],
  },
  {
    nombre: 'Mediterranea',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Tomate', 'Aceitunas', 'Cebolla'],
  },
  {
    nombre: 'Carnivora',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Carne', 'Pollo', 'Pepperoni', 'Tocineta'],
  },
];

/**
 * Estaciones de la Ronda 2 (microservicios). Cada estacion "posee" un
 * subconjunto de ingredientes = su responsabilidad, igual que un microservicio
 * es dueno de su propio dominio.
 *   - Masa    : bases y salsas (Base, Base integral, Salsa, Salsa blanca)
 *   - Quesos  : quesos (Queso, Queso mozzarella, Queso cheddar)
 *   - Toppings: todo lo demas
 * Cada estacion tiene VARIEDAD de ingredientes reales, y las pizzas se arman
 * eligiendo al azar entre los ingredientes de cada estacion (no siempre los
 * mismos). El ORDEN del array define el flujo por el que pasa cada pizza.
 */
const ESTACIONES = [
  { id: 'masa', nombre: 'Masa', ingredientes: ['Base', 'Base integral', 'Salsa', 'Salsa blanca'] },
  { id: 'quesos', nombre: 'Quesos', ingredientes: ['Queso', 'Queso mozzarella', 'Queso cheddar'] },
  {
    id: 'toppings',
    nombre: 'Toppings',
    ingredientes: [
      'Pepperoni',
      'Jamon',
      'Pina',
      'Champinones',
      'Aceitunas',
      'Cebolla',
      'Tocineta',
      'Maiz',
      'Pimenton',
      'Tomate',
      'Carne',
      'Pollo',
    ],
  },
];

/**
 * DECOYS — Catalogo de "señuelos" por cada ingrediente real.
 *
 * PROPOSITO DIDACTICO: llenar la pantalla de opciones MUY parecidas (variantes,
 * errores de tipeo, familias distintas) obliga al jugador a LEER con cuidado
 * cada palabra antes de hacer clic, en vez de reconocer de memoria una posicion.
 * Es la palanca principal para subir la dificultad de "encontrar" el ingrediente
 * correcto sin cambiar la mecanica de las rondas.
 *
 * Un decoy NUNCA cuenta como progreso: la validacion vive en game.js (el
 * servidor solo acepta el string exacto del ingrediente real esperado).
 *
 * Cada clave es un ingrediente REAL (debe coincidir con INGREDIENTES) y su valor
 * es la lista de 10-12 señuelos REALES y bien escritos, parecidos a ese
 * ingrediente (variantes plausibles, no errores de tipeo).
 */
const DECOYS = {
  Base: [
    'Base fina',
    'Base gruesa',
    'Base rellena',
    'Base artesanal',
    'Base crocante',
    'Base delgada',
    'Base sin gluten',
    'Base de masa madre',
    'Base napolitana',
    'Base con semillas',
    'Base precocida',
    'Base al horno',
  ],
  'Base integral': [
    'Base integral fina',
    'Base integral gruesa',
    'Base integral artesanal',
    'Base integral crocante',
    'Base integral con semillas',
    'Base integral de avena',
    'Base multicereal',
    'Base de centeno',
    'Base de trigo integral',
    'Base integral delgada',
    'Base integral rellena',
    'Base integral al horno',
  ],
  Salsa: [
    'Salsa BBQ',
    'Salsa picante',
    'Salsa rosa',
    'Salsa de tomate',
    'Salsa napolitana',
    'Salsa pesto',
    'Salsa casera',
    'Salsa boloñesa',
    'Salsa de ajo',
    'Salsa marinara',
    'Salsa carbonara',
    'Salsa arrabiata',
  ],
  'Salsa blanca': [
    'Salsa blanca casera',
    'Salsa bechamel',
    'Salsa alfredo',
    'Salsa blanca de queso',
    'Salsa blanca con ajo',
    'Salsa blanca cremosa',
    'Salsa blanca ligera',
    'Salsa blanca al vino',
    'Salsa blanca de champiñones',
    'Salsa blanca especiada',
    'Salsa blanca gratinada',
    'Salsa blanca suave',
  ],
  Queso: [
    'Queso crema',
    'Queso azul',
    'Queso doble',
    'Queso rallado',
    'Queso parmesano',
    'Queso fundido',
    'Queso gouda',
    'Queso provolone',
    'Queso de cabra',
    'Queso ricotta',
    'Queso emmental',
    'Queso manchego',
  ],
  'Queso mozzarella': [
    'Queso mozzarella fresca',
    'Queso mozzarella fundida',
    'Queso mozzarella rallada',
    'Queso mozzarella de bufala',
    'Queso mozzarella light',
    'Queso mozzarella ahumada',
    'Queso mozzarella en bolas',
    'Queso mozzarella gratinada',
    'Queso mozzarella premium',
    'Queso mozzarella en lonchas',
    'Queso mozzarella artesanal',
    'Queso mozzarella baja en sal',
  ],
  'Queso cheddar': [
    'Queso cheddar rallado',
    'Queso cheddar fundido',
    'Queso cheddar maduro',
    'Queso cheddar suave',
    'Queso cheddar ahumado',
    'Queso cheddar blanco',
    'Queso cheddar naranja',
    'Queso cheddar en lonchas',
    'Queso cheddar fuerte',
    'Queso cheddar premium',
    'Queso cheddar artesanal',
    'Queso cheddar curado',
  ],
  Pepperoni: [
    'Pepperoni picante',
    'Pepperoni extra',
    'Pepperoni light',
    'Pepperoni doble',
    'Salami',
    'Chorizo',
    'Salchichon',
    'Pepperoni ahumado',
    'Pepperoni artesanal',
    'Salami picante',
    'Pepperoni curado',
    'Pepperoni premium',
  ],
  // Nota: el ingrediente real se llama "Jamon" (sin tilde) para calzar con
  // INGREDIENTES/PEDIDOS; los decoys usan variantes reales bien escritas.
  Jamon: [
    'Jamon serrano',
    'Jamon ahumado',
    'Jamon york',
    'Jamon cocido',
    'Jamon artesanal',
    'Jamon premium',
    'Jamon dulce',
    'Jamon ibérico',
    'Jamon curado',
    'Jamon de pavo',
    'Jamon ahumado extra',
    'Jamon en lonchas',
  ],
  // El ingrediente real (identificador interno) es "Pina" sin tilde, pero los
  // decoys son texto de PRESENTACION: se escriben con la ortografia correcta.
  Pina: [
    'Piña en almibar',
    'Piña natural',
    'Piña dulce',
    'Piña fresca',
    'Piña troceada',
    'Piña asada',
    'Piña caramelizada',
    'Piña colada',
    'Piña deshidratada',
    'Piña en rodajas',
    'Piña tropical',
    'Piña glaseada',
  ],
  // El identificador interno es "Champinones"; los decoys se muestran con ñ.
  Champinones: [
    'Champiñones frescos',
    'Champiñones en lata',
    'Champiñones salteados',
    'Champiñones rebanados',
    'Champiñones laminados',
    'Hongos',
    'Setas',
    'Portobello',
    'Champiñones al ajillo',
    'Champiñones enteros',
    'Champiñones silvestres',
    'Champiñones marinados',
  ],
  Aceitunas: [
    'Aceituna negra',
    'Aceituna verde',
    'Aceitunas rellenas',
    'Aceitunas kalamata',
    'Alcaparras',
    'Aceitunas picadas',
    'Aceituna sin hueso',
    'Aceitunas enteras',
    'Aceitunas marinadas',
    'Aceitunas laminadas',
    'Aceitunas manzanilla',
    'Aceitunas gordal',
  ],
  Cebolla: [
    'Cebolla morada',
    'Cebolla caramelizada',
    'Cebollín',
    'Cebolla blanca',
    'Cebolla roja',
    'Cebolla frita',
    'Cebolla dulce',
    'Cebolla picada',
    'Cebolla en aros',
    'Cebolla puerro',
    'Cebolla asada',
    'Cebolla encurtida',
  ],
  Tocineta: [
    'Tocineta ahumada',
    'Tocineta crocante',
    'Tocineta en trozos',
    'Tocineta ahumada extra',
    'Panceta',
    'Bacon',
    'Tocineta de pavo',
    'Tocineta curada',
    'Tocino',
    'Tocineta artesanal',
    'Tocineta en tiras',
    'Tocineta frita',
  ],
  Maiz: [
    'Maíz dulce',
    'Maíz tierno',
    'Maíz amarillo',
    'Maíz en grano',
    'Maíz tostado',
    'Maíz asado',
    'Elote',
    'Maíz desgranado',
    'Maíz enlatado',
    'Maíz blanco',
    'Maíz baby',
    'Choclo',
  ],
  Pimenton: [
    'Pimentón rojo',
    'Pimentón verde',
    'Pimentón amarillo',
    'Pimentón asado',
    'Pimentón en tiras',
    'Pimiento morrón',
    'Pimentón dulce',
    'Pimentón picante',
    'Pimentón italiano',
    'Pimentón salteado',
    'Pimentón fresco',
    'Pimentón troceado',
  ],
  Tomate: [
    'Tomate cherry',
    'Tomate en rodajas',
    'Tomate seco',
    'Tomate fresco',
    'Tomate maduro',
    'Tomate perita',
    'Tomate rallado',
    'Tomate confitado',
    'Tomate asado',
    'Tomate en cubos',
    'Tomate verde',
    'Tomate deshidratado',
  ],
  Carne: [
    'Carne molida',
    'Carne de res',
    'Carne mechada',
    'Carne desmechada',
    'Carne a la plancha',
    'Carne picada',
    'Carne de cerdo',
    'Carne asada',
    'Carne sazonada',
    'Carne en tiras',
    'Carne guisada',
    'Carne magra',
  ],
  Pollo: [
    'Pollo desmechado',
    'Pollo a la plancha',
    'Pollo asado',
    'Pollo en trozos',
    'Pollo BBQ',
    'Pollo apanado',
    'Pollo teriyaki',
    'Pollo marinado',
    'Pollo grillado',
    'Pollo al curry',
    'Pollo en tiras',
    'Pollo sazonado',
  ],
};

// Conjunto plano con TODOS los decoys (para poder rellenar la cuadricula gigante
// de la Ronda 1 con señuelos de ingredientes que ni siquiera estan en la receta).
const TODOS_LOS_DECOYS = Object.values(DECOYS).reduce((acc, arr) => acc.concat(arr), []);

/**
 * Tamaños objetivo de la cuadricula de ingredientes por ronda.
 *
 * - Ronda 1 (MONOLITO): un mar gigante de 60-80 casillas. Sin separacion de
 *   responsabilidades, el cocinero busca entre TODO -> caos del monolito.
 * - Ronda 2/3 (MICROSERVICIOS / SERVERLESS): 25-35 casillas por estacion/pizza.
 *   Cada estacion solo muestra lo suyo (aislamiento) -> mucho mas manejable,
 *   para que el contraste de velocidad frente a la Ronda 1 se sienta claro.
 */
const GRID_R1_MIN = 60;
const GRID_R1_MAX = 80;
const GRID_R2_MIN = 25;
const GRID_R2_MAX = 35;

/** ¿Es este texto uno de los ingredientes REALES del juego? */
function esIngredienteReal(texto) {
  return INGREDIENTES.includes(texto);
}

// Cimiento comun de TODA pizza (en el orden del flujo de estaciones):
// Masa (Base + Salsa) -> Quesos (Queso). Se mantiene fijo para que la metafora
// de microservicios por estacion tenga sentido (toda pizza pasa por esas
// estaciones); lo que se arma al azar son los ingredientes de CADA estacion.

// Pools por estacion: de aqui se elige al azar. Cada pizza toma 1 ingrediente
// de Masa y 1 de Quesos (los "cualquiera de los que esten alli" que pediste) y
// varios toppings. Se derivan de ESTACIONES para no duplicar la lista.
const _estacionPorId = (id) => ESTACIONES.find((e) => e.id === id) || { ingredientes: [] };
const POOL_MASA = _estacionPorId('masa').ingredientes.slice();
const POOL_QUESOS = _estacionPorId('quesos').ingredientes.slice();
const POOL_TOPPINGS = _estacionPorId('toppings').ingredientes.slice();

// Cuantos toppings al azar lleva cada pizza (rango inclusivo).
const TOPPINGS_MIN = 1;
const TOPPINGS_MAX = 4;

/** Devuelve una copia barajada del array (Fisher-Yates). */
function _barajarArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Elige un elemento al azar de un array (o null si esta vacio). */
function _unoAlAzar(arr) {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

/**
 * Arma una pizza AL AZAR combinando cualquiera de los ingredientes disponibles.
 *
 * En vez de un cimiento fijo (Base + Salsa + Queso), cada pizza elige AL AZAR:
 *   - 1 ingrediente de la estacion Masa   (Base / Base integral / Salsa / ...)
 *   - 1 ingrediente de la estacion Quesos (Queso / Queso mozzarella / ...)
 *   - entre TOPPINGS_MIN y TOPPINGS_MAX toppings de la estacion Toppings
 * Asi cada pedido usa CUALQUIERA de los ingredientes que existen en cada
 * estacion, no siempre los mismos. Los ingredientes van en el ORDEN del flujo
 * de estaciones (Masa -> Quesos -> Toppings) para que el recorrido tenga sentido.
 *
 * El nombre se genera a partir de todos los ingredientes elegidos.
 * `pedidoAnterior` es el nombre del pedido previo: si por casualidad sale
 * identico, se vuelve a generar para no repetir dos veces seguidas.
 */
function elegirPedidoAleatorio(pedidoAnterior) {
  const generarUno = () => {
    const masa = _unoAlAzar(POOL_MASA);
    const queso = _unoAlAzar(POOL_QUESOS);
    const cuantos =
      TOPPINGS_MIN + Math.floor(Math.random() * (TOPPINGS_MAX - TOPPINGS_MIN + 1));
    const toppings = _barajarArray(POOL_TOPPINGS).slice(0, cuantos);
    // Orden del flujo de estaciones: primero Masa, luego Quesos, luego Toppings.
    const ingredientes = [masa, queso, ...toppings].filter(Boolean);
    // El nombre se arma con los toppings (lo que distingue a la pizza); si no
    // hubiera, usamos el queso elegido como referencia.
    const paraNombre = toppings.length ? toppings : [queso].filter(Boolean);
    return { nombre: nombrePizza(paraNombre), ingredientes };
  };

  let pedido = generarUno();
  // Evitar repetir exactamente el mismo pedido dos veces seguidas.
  let intentos = 0;
  while (pedido.nombre === pedidoAnterior && intentos < 8) {
    pedido = generarUno();
    intentos++;
  }
  return pedido;
}

/** Construye un nombre legible de la pizza a partir de sus toppings. */
function nombrePizza(toppings) {
  if (!toppings.length) return 'Pizza sencilla';
  if (toppings.length === 1) return `Pizza de ${toppings[0]}`;
  const ultimos = toppings.slice();
  const ultimo = ultimos.pop();
  return `Pizza de ${ultimos.join(', ')} y ${ultimo}`;
}

// Duracion FIJA de cada ronda: 10 minutos. La ronda termina por TIEMPO, no por
// cantidad de pedidos (los pedidos se generan indefinidamente hasta que se agota).
// Se puede acortar con la variable de entorno PIZZA_DURACION_RONDA_MS (util para
// pruebas automatizadas, que no pueden esperar 10 minutos reales).
const DURACION_RONDA_MS = Number(process.env.PIZZA_DURACION_RONDA_MS) || 10 * 60 * 1000; // 600000 ms

// Probabilidad de que el proximo pedido de la Ronda 3 sea "¡HORA PICO!".
// (~28%: valor razonable dentro del rango sugerido 25-30%.)
const PROB_HORA_PICO = 0.28;

// (Historico) cantidad de referencia de pedidos; ya NO controla el fin de ronda,
// que ahora es por tiempo. Se conserva por compatibilidad de imports.
const PEDIDOS_POR_RONDA = 5;

// Duracion (ms) del bloqueo cuando el "dado" saca 1 o 2.
const BLOQUEO_MS = 20000;

// Duracion (ms) del "cold start" en la Ronda 3 (serverless).
const COLD_START_MS = 10000;

// Preguntas de discusion final (se muestran al terminar la Ronda 3).
const PREGUNTAS_DISCUSION = [
  'Ronda 1 (monolito): cuando el unico cocinero se bloqueaba, que pasaba con TODOS los pedidos? Como se relaciona con desplegar y escalar un monolito completo?',
  'Ronda 2 (microservicios): cuando fallaba una estacion, las demas seguian trabajando. Que ventaja de aislamiento de fallos ilustra esto? Que costo de coordinacion aparece?',
  'Ronda 2 con 2 jugadores: alguien tuvo que cubrir dos estaciones. Que representa tener menos "instancias" por servicio? Como afecta la carga y el riesgo?',
  'Ronda 3 (serverless): el "cold start" agrego demora al escalar bajo demanda. Cuando conviene pagar ese costo vs. tener instancias siempre activas?',
  'Comparando las tres: cual fue mas rapida en promedio? Cual mas resiliente a fallos? No hay una "mejor" arquitectura: depende del contexto. Que contexto favorece a cada una?',
];

module.exports = {
  INGREDIENTES,
  PEDIDOS,
  ESTACIONES,
  DECOYS,
  TODOS_LOS_DECOYS,
  GRID_R1_MIN,
  GRID_R1_MAX,
  GRID_R2_MIN,
  GRID_R2_MAX,
  esIngredienteReal,
  elegirPedidoAleatorio,
  DURACION_RONDA_MS,
  PROB_HORA_PICO,
  PEDIDOS_POR_RONDA,
  BLOQUEO_MS,
  COLD_START_MS,
  PREGUNTAS_DISCUSION,
};
