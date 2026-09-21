'use strict';
/**
 * test/run.js — Runner de la prueba de flujo completo (sin dependencias).
 *
 * Arranca el servidor en un puerto de prueba, ejecuta test/flujo-completo.js
 * como proceso hijo y apaga el servidor al terminar. Devuelve el codigo de
 * salida de la prueba (0 = todo OK).
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3555;
const CLAVE = process.env.CLAVE_PROFESOR || 'profe2024';
const ROOT = path.join(__dirname, '..');

const env = { ...process.env, PORT: String(PORT), CLAVE_PROFESOR: CLAVE };
// Evitamos heredar un NODE_OPTIONS roto del entorno (preload inexistente).
delete env.NODE_OPTIONS;

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log(`Arrancando servidor de prueba en el puerto ${PORT}...`);
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // Damos tiempo a que el servidor escuche.
  await esperar(1200);

  const prueba = spawn(process.execPath, [path.join(__dirname, 'flujo-completo.js')], {
    env,
    stdio: 'inherit',
  });

  prueba.on('exit', (code) => {
    try {
      server.kill('SIGTERM');
    } catch (_) {
      /* noop */
    }
    process.exit(code == null ? 1 : code);
  });
})();
