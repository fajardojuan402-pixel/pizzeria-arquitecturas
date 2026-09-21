/**
 * ws-client.js — Pequeno wrapper de WebSocket para el navegador.
 *
 * Reemplaza al cliente de socket.io. Da una API sencilla:
 *   const sock = createSocket();
 *   sock.on('estado', (data) => { ... });
 *   sock.emit('unirse', { salaId, nombre });
 *
 * Incluye reconexion automatica del TRANSPORTE (si se cae el socket, reintenta).
 * La reconexion "de negocio" (recuperar rol por nombre) la maneja cada pagina
 * reenviando 'unirse'/'entrar-profesor' cuando el socket vuelve a abrir.
 */
function createSocket() {
  const listeners = {};
  let ws = null;
  let cerradoAdrede = false;
  const colaEnvios = []; // mensajes a enviar cuando abra la conexion
  const abiertos = []; // callbacks para el evento 'open'

  function url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}`;
  }

  function conectar() {
    ws = new WebSocket(url());

    ws.onopen = () => {
      // Vaciamos la cola pendiente.
      while (colaEnvios.length) {
        const m = colaEnvios.shift();
        ws.send(m);
      }
      abiertos.forEach((cb) => cb());
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (msg && msg.event && listeners[msg.event]) {
        listeners[msg.event].forEach((cb) => cb(msg.data));
      }
    };

    ws.onclose = () => {
      if (cerradoAdrede) return;
      // Reintento de transporte tras 1s.
      setTimeout(conectar, 1000);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch (_) {}
    };
  }

  conectar();

  return {
    on(event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
    },
    /** Se ejecuta cada vez que el socket abre (util para re-enviar 'unirse'). */
    onOpen(cb) {
      abiertos.push(cb);
      if (ws && ws.readyState === WebSocket.OPEN) cb();
    },
    emit(event, data) {
      const payload = JSON.stringify({ event, data });
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
      else colaEnvios.push(payload);
    },
    close() {
      cerradoAdrede = true;
      if (ws) ws.close();
    },
  };
}
