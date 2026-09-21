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
  PEDIDOS_POR_RONDA,
  BLOQUEO_MS,
  COLD_START_MS,
  PREGUNTAS_DISCUSION,
};
