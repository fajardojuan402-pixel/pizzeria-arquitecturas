# 🍕 Pizzeria de Arquitecturas de Software

Aplicación web **multijugador en tiempo real** para una clase universitaria. Simula
tres arquitecturas de software usando una pizzería como metáfora:

| Ronda | Nombre en clase | Arquitectura que simula |
|-------|-----------------|-------------------------|
| **1** | Fábrica de un solo cocinero | **Monolito** — un cocinero hace todo; si se bloquea, se detiene TODO |
| **2** | Por estaciones | **Microservicios** — estaciones independientes en paralelo; una falla no frena al resto |
| **3** | Fin de semana, bajo demanda | **Serverless** — instancias que "duermen" y arrancan bajo demanda (*cold start*) |

## Cómo ejecutar

```bash
# Requiere Node.js >= 18. No hay dependencias que instalar.
npm start
# o:  node server/index.js
```

Luego abre en el navegador:

- **Jugadores:** http://localhost:3000/
- **Profesor:**  http://localhost:3000/profesor  (clave por defecto: `profe2024`)

> La clave del profesor y el puerto se pueden cambiar con variables de entorno:
> `CLAVE_PROFESOR=miclave PORT=8080 npm start`

## Sin dependencias externas (a propósito)

Este proyecto **no usa Express ni Socket.io**: todo se implementa con módulos
nativos de Node (`http`, `crypto`). El servidor WebSocket propio vive en
[`server/ws.js`](server/ws.js) y expone una API pequeña al estilo Socket.io
(`hub.on('connection')`, `socket.on/emit`). Esto lo hace fácil de ejecutar en
cualquier entorno sin acceso a un registro de paquetes.

Si en tu entorno **sí** puedes instalar paquetes y prefieres Express + Socket.io,
la lógica de juego (`server/game.js`) es agnóstica del transporte: solo tendrías
que cambiar la capa de red en `server/index.js`.

## Estructura del proyecto

```
pizzeria-arquitecturas/
├── package.json
├── README.md
├── server/
│   ├── index.js     # Servidor HTTP + WebSocket; cablea eventos con el juego
│   ├── ws.js        # Servidor WebSocket casero (RFC 6455) — reemplaza socket.io
│   ├── catalog.js   # Datos de dominio: ingredientes, pizzas, estaciones, textos
│   └── game.js      # GameEngine: TODO el estado en memoria y la lógica de rondas
├── public/
│   ├── index.html   # Vista del jugador
│   ├── app.js       # Lógica de la vista del jugador
│   ├── profesor.html# Panel del profesor
│   ├── prof.js      # Lógica del panel del profesor
│   ├── ws-client.js # Wrapper de WebSocket para el navegador
│   └── styles.css   # Estilos compartidos (responsivo)
└── test/
    ├── run.js            # Arranca el servidor, corre la prueba y lo apaga
    ├── flujo-completo.js # Prueba de flujo completo (las 3 rondas + reglas)
    └── wsclient.js       # Mini cliente WebSocket de prueba (nativo)
```

## Pruebas

Una prueba de **flujo completo** (sin dependencias externas) simula una sesión de
clase entera: profesor + 3 jugadores, reglas de cupo, las tres rondas en secuencia,
reconexión y la tabla comparativa. Ejecútala con:

```bash
npm test
```

Arranca un servidor de prueba en un puerto aparte, verifica ~28 comprobaciones y
sale con código 0 si todo pasa. Útil para re-validar tras cualquier ajuste.

## Reglas clave implementadas

### Salas y cupos
- Dos salas independientes (**Sala 1** y **Sala 2**).
- Cada sala admite **mínimo 2** y **máximo 3** jugadores.
- Con 3 jugadores la sala queda **llena** ("Sala llena").
- Con 2 jugadores la sala es jugable pero sigue **abierta** a un tercero…
  hasta que el profesor **inicia la primera ronda**: ahí la sala se **cierra**
  y ya no admite un tercer jugador aunque tuviera cupo.

### Control del profesor
- El profesor **no juega**: entra con una clave y ve **ambas salas** a la vez.
- Para cada sala hay botones **Iniciar Ronda 1 / 2 / 3**, habilitados con ≥ 2
  jugadores. Las rondas **no** avanzan solas ni están encadenadas.
- Una ronda ya jugada muestra el botón **Reiniciar esta ronda**.
- Botón **Mostrar preguntas de discusión** (también aparecen solas al terminar
  la Ronda 3).
- El panel muestra el **estado exacto** de cada sala (esperando / jugando /
  completada) y **cuántos jugadores** tiene conectados.
- **Tabla comparativa acumulada** de las rondas jugadas, en tiempo real.

### Diferencia 2 vs. 3 jugadores (Ronda 2)
- **3 jugadores:** reparto normal → Masa, Quesos, Toppings (uno cada uno).
- **2 jugadores:** una **pantalla previa** deja que ellos decidan quién cubre
  dos estaciones y quién una, antes de arrancar el cronómetro. Menos
  "instancias" = más carga por servicio (parte de la discusión final).

### Mecánicas por ronda
- **Ronda 1 (monolito):** eligen 1 cocinero; al completar cada pizza el
  servidor tira un dado (1–6). Si sale **1 o 2**, el cocinero se **bloquea 20 s**
  (todo el "monolito" se detiene). Termina a las **5 pizzas**.
- **Ronda 2 (microservicios):** las pizzas fluyen por estaciones en paralelo.
  Tras cada pizza, si el dado saca 1 o 2 se **bloquea una estación al azar 20 s**;
  las demás siguen. Mide fallas y cuánto siguió activo el resto.
- **Ronda 3 (serverless):** 1 activo, el resto "descansando" (interfaz gris).
  Llegan pedidos normales (1 pizza) y **¡HORA PICO!** (2–3 pizzas). Los que
  descansan pueden **"Entrar a ayudar"** pagando un **cold start de 10 s**
  (barra de progreso). Si ya estaban activos, no repiten cold start. Al terminar
  la ráfaga eligen volver a descansar o seguir activos.

### Reconexión
- Si un jugador pierde la conexión y vuelve a entrar con el **mismo nombre**
  en **menos de 1 minuto**, recupera su rol y estado en la partida.

### Resultados
- Al terminar cada ronda se muestra de inmediato: tiempo total, fallas/esperas
  y un **resumen narrativo** generado por el sistema.

## Notas para ajustar la actividad

- Ingredientes, pizzas, estaciones, duración de bloqueos/cold start y las
  preguntas de discusión están todos en [`server/catalog.js`](server/catalog.js).
- Toda la lógica de rondas está comentada en [`server/game.js`](server/game.js)
  indicando qué parte simula qué concepto de arquitectura.
