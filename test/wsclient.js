'use strict';
/**
 * test/wsclient.js — Mini cliente WebSocket para las pruebas de flujo.
 *
 * Usa el MISMO protocolo casero del servidor (frames RFC 6455 con mascara del
 * lado cliente) y solo modulos nativos de Node. Sin dependencias externas.
 * No forma parte de la app: es utileria de prueba reutilizable.
 */
const http = require('http');
const crypto = require('crypto');
const HOST = '127.0.0.1';

/** Abre una conexion WebSocket contra el servidor local en el puerto dado. */
function connect(PORT) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: HOST,
      port: PORT,
      path: '/',
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('error', reject);
    req.on('upgrade', (res, socket) => {
      const listeners = {};
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        let f;
        while ((f = decode(buf))) {
          buf = f.rest;
          if (f.opcode === 0x1) {
            try {
              const m = JSON.parse(f.payload.toString('utf8'));
              (listeners[m.event] || []).forEach((cb) => cb(m.data));
            } catch (_) {
              /* ignorar mensajes malformados */
            }
          }
        }
      });
      const api = {
        on: (e, cb) => ((listeners[e] = listeners[e] || []).push(cb), api),
        emit: (event, data) => socket.write(encodeMasked(JSON.stringify({ event, data }))),
        close: () => socket.end(),
        destroy: () => socket.destroy(),
      };
      resolve(api);
    });
    req.end();
  });
}

/** Codifica un frame de CLIENTE (siempre enmascarado). */
function encodeMasked(str) {
  const p = Buffer.from(str, 'utf8');
  const len = p.length;
  let h;
  if (len < 126) {
    h = Buffer.alloc(2);
    h[1] = 0x80 | len;
  } else if (len < 65536) {
    h = Buffer.alloc(4);
    h[1] = 0x80 | 126;
    h.writeUInt16BE(len, 2);
  } else {
    h = Buffer.alloc(10);
    h[1] = 0x80 | 127;
    h.writeUInt32BE(0, 2);
    h.writeUInt32BE(len, 6);
  }
  h[0] = 0x81; // FIN + texto
  const mask = crypto.randomBytes(4);
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) out[i] = p[i] ^ mask[i % 4];
  return Buffer.concat([h, mask, out]);
}

/** Decodifica UN frame del servidor (sin mascara). */
function decode(b) {
  if (b.length < 2) return null;
  const op = b[0] & 0x0f;
  let len = b[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (b.length < 4) return null;
    len = b.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (b.length < 10) return null;
    len = b.readUInt32BE(6);
    off = 10;
  }
  if (b.length < off + len) return null;
  return { opcode: op, payload: b.slice(off, off + len), rest: b.slice(off + len) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { connect, sleep };
