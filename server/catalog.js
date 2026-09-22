'use strict';

/**
 * catalog.js — Datos de dominio (ingredientes, pizzas, estaciones, textos).
 *
 * Todo lo "de contenido" vive aqui para que un profesor pueda ajustar la
 * actividad sin tocar la logica del juego.
 */

// Ingredientes disponibles (el orden es el que se muestra en pantalla).
const INGREDIENTES = [
  'Base',
  'Salsa',
  'Queso',
  'Pepperoni',
  'Jamon',
  'Pina',
  'Champinones',
  'Aceitunas',
  'Cebolla',
];

// Catalogo de pedidos posibles: nombre + ingredientes requeridos (en orden).
const PEDIDOS = [
  { nombre: 'Margarita', ingredientes: ['Base', 'Salsa', 'Queso'] },
  { nombre: 'Hawaiana', ingredientes: ['Base', 'Salsa', 'Queso', 'Pina', 'Jamon'] },
  { nombre: 'Pepperoni', ingredientes: ['Base', 'Salsa', 'Queso', 'Pepperoni'] },
  {
    nombre: 'Vegetariana',
    ingredientes: ['Base', 'Salsa', 'Queso', 'Champinones', 'Aceitunas', 'Cebolla'],
  },
  { nombre: 'Especial', ingredientes: ['Base', 'Salsa', 'Queso', 'Pepperoni', 'Cebolla'] },
];

/**
 * Estaciones de la Ronda 2 (microservicios). Cada estacion "posee" un
 * subconjunto de ingredientes = su responsabilidad, igual que un microservicio
 * es dueno de su propio dominio.
 *   - Masa    : Base + Salsa
 *   - Quesos  : Queso
 *   - Toppings: todo lo demas (los ingredientes que sobran)
 * El ORDEN del array define el flujo por el que pasa cada pizza.
 */
const ESTACIONES = [
  { id: 'masa', nombre: 'Masa', ingredientes: ['Base', 'Salsa'] },
  { id: 'quesos', nombre: 'Quesos', ingredientes: ['Queso'] },
  {
    id: 'toppings',
    nombre: 'Toppings',
    ingredientes: ['Pepperoni', 'Jamon', 'Pina', 'Champinones', 'Aceitunas', 'Cebolla'],
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
 * es la lista de 9-10 señuelos parecidos a ese ingrediente.
 */
const DECOYS = {
  Base: [
    'Base fina',
    'Base gruesa',
    'Base integral',
    'Base rellena',
    'Base artesanal',
    'Base crocante',
    'Base delgada',
    'Baste',
    'Vase',
    'Base sin gluten',
  ],
  Salsa: [
    'Salsa BBQ',
    'Salsa picante',
    'Salsa blanca',
    'Salsa rosa',
    'Salsa de tomate',
    'Salsa napolitana',
    'Salsa pesto',
    'Zalsa',
    'Salza',
    'Salsa casera',
  ],
  Queso: [
    'Queso crema',
    'Queso azul',
    'Queso doble',
    'Queso rallado',
    'Queso mozzarella',
    'Queso parmesano',
    'Queso cheddar',
    'Quezo',
    'Qeso',
    'Queso fundido',
  ],
  Pepperoni: [
    'Peperoni',
    'Pepperonni',
    'Pepperoni picante',
    'Peperonni',
    'Salami',
    'Chorizo',
    'Pepperoni extra',
    'Pepperoni light',
    'Peperony',
    'Pepperoni doble',
  ],
  // Nota: el ingrediente real se llama "Jamon" (sin tilde) para calzar con
  // INGREDIENTES/PEDIDOS; los decoys si usan variantes con y sin tilde.
  Jamon: [
    'Jamon serrano',
    'Jamón ahumado',
    'Jamón york',
    'Jamón cocido',
    'Tocineta',
    'Jamón',
    'Jamón artesanal',
    'Jamón premium',
    'Jámon',
    'Jamon dulce',
  ],
  // El ingrediente real es "Pina" (sin tilde); los decoys incluyen "Piña" real.
  Pina: [
    'Piña en almíbar',
    'Piña natural',
    'Piña dulce',
    'Piña',
    'Piñas',
    'Duraznos',
    'Piña fresca',
    'Piñá',
    'Piña troceada',
    'Piña asada',
  ],
  // El ingrediente real es "Champinones" (sin tilde ni ñ).
  Champinones: [
    'Champiñón',
    'Champiñones frescos',
    'Champiñones en lata',
    'Champiñon',
    'Champiñones',
    'Hongos',
    'Setas',
    'Champiñones salteados',
    'Champiñones rebanados',
    'Champiñónes',
  ],
  Aceitunas: [
    'Aceituna negra',
    'Aceituna verde',
    'Aceitunas rellenas',
    'Aceituna',
    'Aceitunas kalamata',
    'Alcaparras',
    'Aceitunas picadas',
    'Azeitunas',
    'Aceituna sin hueso',
    'Aceitunas enteras',
  ],
  Cebolla: [
    'Cebolla morada',
    'Cebolla caramelizada',
    'Cebollín',
    'Cebolla blanca',
    'Cebolla roja',
    'Cevolla',
    'Cebolla frita',
    'Cebolla dulce',
    'Cebolla picada',
    'Cebollita',
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

// Pedidos que debe completar cada ronda antes de terminar.
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
  PEDIDOS_POR_RONDA,
  BLOQUEO_MS,
  COLD_START_MS,
  PREGUNTAS_DISCUSION,
};
