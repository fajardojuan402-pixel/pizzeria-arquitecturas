'use strict';

/**
 * ws.js — Servidor WebSocket minimalista (RFC 6455) SIN dependencias externas.
 *
 * ¿Por que casero? El entorno no permite instalar paquetes de npm, asi que
 * reemplazamos "socket.io" con una implementacion propia usando solo modulos
 * nativos de Node (http + crypto). La API publica imita lo justo de socket.io
 * para que el resto del codigo sea legible:
 *
 *   - hub.on('connection', (socket) => { ... })
 *   - socket.on('nombreEvento', (payload) => { ... })
 *   - socket.emit('nombreEvento', payload)
 *   - socket.id           -> id unico de la conexion
 *   - hub.broadcast(evt, payload)  -> a todos
 *
 * El protocolo de mensajes sobre el WebSocket es JSON: { event, data }.
 *
 * NOTA DIDACTICA: socket.io normalmente hace mucho mas (reconexion automatica,
 * fallback a long-polling, rooms, etc.). Aqui implementamos solo lo necesario.
 * La reconexion "de negocio" (recuperar rol por nombre) la maneja la logica de
 * juego, no la capa de transporte.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

// GUID magico definido por la especificacion del handshake WebSocket.
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Calcula el header Sec-WebSocket-Accept a partir de la key del cliente. */
function acceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + WS_MAGIC)
    .digest('base64');
}

/**
 * Representa UNA conexion WebSocket. Expone .on()/.emit() al estilo evento.
 * Cada mensaje entrante { event, data } se re-emite como evento local.
 */
class WsSocket extends EventEmitter {
  constructor(rawSocket, id) {
    super();
    this.raw = rawSocket;
    this.id = id;
    this.alive = true;
    this._buffer = Buffer.alloc(0);

    rawSocket.on('data', (chunk) => this._onData(chunk));
    rawSocket.on('close', () => this._onClose());
    rawSocket.on('error', () => this._onClose());
    // 'end' = el cliente hizo un cierre "medio" (FIN) con socket.end(). Como no
    // usamos half-open, lo tratamos como cierre completo (cerramos nuestro lado).
    rawSocket.on('end', () => this._onClose());
  }

  /** Envia un evento de negocio como frame de texto JSON. */
  emit(event, data) {
    // Los eventos internos ('message', 'close'...) se propagan por EventEmitter.
    if (event === 'close' || event === 'message' || event === 'error') {
      return super.emit(event, data);
    }
    if (!this.alive) return;
    const payload = JSON.stringify({ event, data });
    try {
      this.raw.write(encodeFrame(payload));
    } catch (_) {
      this._onClose();
    }
  }

  /** Cierra la conexion. */
  close() {
    if (!this.alive) return;
    try {
      this.raw.end();
    } catch (_) {
      /* noop */
    }
    this._onClose();
  }

  _onClose() {
    if (!this.alive) return;
    this.alive = false;
    // Aseguramos que el socket TCP se libere por completo (evita fugas si el
    // cliente hizo solo un half-close).
    try {
      this.raw.destroy();
    } catch (_) {
      /* noop */
    }
    super.emit('close');
  }

  /** Acumula bytes y extrae frames completos. */
  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    let frame;
    while ((frame = decodeFrame(this._buffer)) !== null) {
      this._buffer = frame.rest;
      if (frame.opcode === 0x8) {
        // Frame de cierre.
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        // Ping -> respondemos Pong.
        try {
          this.raw.write(encodeFrame(frame.payload, 0xa));
        } catch (_) {
          /* noop */
        }
        continue;
      }
      if (frame.opcode === 0x1 || frame.opcode === 0x0) {
        // Texto. Intentamos parsear el sobre { event, data }.
        try {
          const msg = JSON.parse(frame.payload.toString('utf8'));
          if (msg && typeof msg.event === 'string') {
            super.emit(msg.event, msg.data);
          }
        } catch (_) {
          /* mensaje malformado: ignorar */
        }
      }
    }
  }
}

/**
 * Codifica un frame WebSocket de servidor (sin mascara).
 * opcode 0x1 = texto (por defecto), 0xa = pong.
 */
function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // Escribimos la longitud en 64 bits (usamos 32 bits altos en 0).
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  header[0] = 0x80 | opcode; // FIN=1 + opcode
  return Buffer.concat([header, payload]);
}

/**
 * Decodifica UN frame del buffer. Devuelve { opcode, payload, rest } o null si
 * aun no hay bytes suficientes para un frame completo.
 * Los frames de cliente SIEMPRE vienen enmascarados (masking key de 4 bytes).
 */
function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) === 0x80;
  let len = buffer[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buffer.length < offset + 2) return null;
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buffer.length < offset + 8) return null;
    // Ignoramos los 32 bits altos (mensajes gigantes no aplican aqui).
    len = buffer.readUInt32BE(offset + 4);
    offset += 8;
  }

  let maskKey;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + len) return null; // frame incompleto

  const payload = Buffer.alloc(len);
  buffer.copy(payload, 0, offset, offset + len);
  if (masked) {
    for (let i = 0; i < len; i++) payload[i] ^= maskKey[i % 4];
  }

  return { opcode, payload, rest: buffer.slice(offset + len) };
}

/**
 * Hub: gestiona el upgrade HTTP->WS y mantiene el conjunto de sockets vivos.
 * Emite 'connection' con cada nuevo WsSocket.
 */
class WsHub extends EventEmitter {
  constructor() {
    super();
    this.sockets = new Map(); // id -> WsSocket
    this._counter = 0;
  }

  /** Se engancha al evento 'upgrade' del servidor http. */
  handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = acceptKey(key);
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ];
    socket.write(headers.join('\r\n'));

    const id = `c${Date.now().toString(36)}_${(this._counter++).toString(36)}`;
    const ws = new WsSocket(socket, id);
    this.sockets.set(id, ws);
    ws.on('close', () => this.sockets.delete(id));

    super.emit('connection', ws);
  }

  /** Envia un evento a TODAS las conexiones vivas. */
  broadcast(event, data) {
    for (const ws of this.sockets.values()) ws.emit(event, data);
  }
}

module.exports = { WsHub };
