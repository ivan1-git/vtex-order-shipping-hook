# vtex-order-shipping-hook

[![CI](https://github.com/ivan1-git/vtex-order-shipping-hook/actions/workflows/ci.yml/badge.svg)](https://github.com/ivan1-git/vtex-order-shipping-hook/actions/workflows/ci.yml)
![Node 22.18+](https://img.shields.io/badge/Node-22.18%2B-5fa04e)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

Un servicio pequeño en Node.js que escucha los avisos de pedidos de VTEX y se encarga
de la parte logística que normalmente alguien hace a mano:

1. Cuando un pedido queda **listo para preparar**, genera la guía con la paquetería y le
   avisa a VTEX que el pedido ya está en preparación.
2. Cuando el pedido se **factura**, le manda a VTEX el número de rastreo para que el
   cliente lo vea en "Mis pedidos".

Corre sin cuenta de VTEX: trae un modo demo con pedidos de ejemplo y una paquetería de
mentira que a veces "se cae", para ver los reintentos funcionando.

> Proyecto personal para mi portafolio. No tiene código de clientes ni de empresas donde he trabajado.

## La idea

En e-commerce casi todo lo que pasa después de la compra se resuelve igual: VTEX avisa que
algo cambió y alguien (o algo) tiene que reaccionar. El problema es que esos avisos
pueden llegar repetidos, en desorden o justo cuando la API de la paquetería está caída.

Este repo es mi forma de resolver ese patrón:

- **Contestar rápido.** El endpoint valida, encola y responde. No espera a la paquetería.
- **No duplicar.** Si VTEX manda dos veces el mismo aviso, la guía se genera una sola vez.
- **Respetar el orden por pedido.** Si "facturado" llega pegado a "listo para preparar",
  primero se termina la guía y después se manda el tracking.
- **Reintentar solo lo que vale la pena.** Un 503 o un 429 se reintenta con espera
  exponencial; un 404 o un pedido sin código postal no.

## Cómo correrlo

Necesitas **Node 22.18 o más nuevo** (o Node 24). No hay paso de build: Node ejecuta los
`.ts` directamente.

```bash
npm install
npm run dev
```

En otra terminal, simula a VTEX mandando avisos:

```bash
npm run simulate
```

Vas a ver algo así:

```
→ Ping de configuración                            200 {"ok":true}
→ v1001-01 listo para preparar                     200 {"received":true,"duplicate":false}
→ v1001-01 otra vez (VTEX reintenta)               200 {"received":true,"duplicate":true}
→ v1002-01 pago aprobado (no requiere acción)      200 {"received":true,"duplicate":false}
→ v1002-01 listo para preparar                     200 {"received":true,"duplicate":false}
→ v1003-01 listo, pero el pedido está cancelado    200 {"received":true,"duplicate":false}
→ v1001-01 facturado                               200 {"received":true,"duplicate":false}

Guías generadas:
┌─────────┬────────────┬────────────────┬─────────────────┬────────────────────────┐
│ (index) │ orderId    │ trackingNumber │ handlingStarted │ trackingSentForInvoice │
├─────────┼────────────┼────────────────┼─────────────────┼────────────────────────┤
│ 0       │ 'v1001-01' │ 'ENV067001001' │ true            │ 'F-2026-0001'          │
│ 1       │ 'v1002-01' │ 'ENV640001002' │ true            │ null                   │
└─────────┴────────────┴────────────────┴─────────────────┴────────────────────────┘
```

Y en la terminal del servicio, los reintentos cuando la paquetería falla:

```
[16:09:06] WARN: Falló, se reintenta
    key: "v1001-01:ready-for-handling"
    attempt: 1
    retryInMs: 1000
    error: "HTTP 503 en fake://carrier/shipments: Servicio temporalmente no disponible"
[16:09:07] INFO: Guía generada
    orderId: "v1001-01"
    trackingNumber: "ENV067001002"
```

La configuración está en [`.env.example`](.env.example). Cópialo a `.env` si quieres cambiar algo.

## Endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `POST` | `/webhooks/vtex/orders` | Aquí apunta el hook de VTEX. Pide el header `x-hook-secret` |
| `GET` | `/shipments` | Las guías generadas y en qué paso va cada una |
| `GET` | `/status` | Pendientes, procesados y eventos que fallaron |
| `GET` | `/health` | Health check |

## Cómo se conecta con VTEX de verdad

Con `MODE=live` el servicio usa la API real del OMS
(`GET /api/oms/pvt/orders/{id}`, `POST .../start-handling` y `PATCH .../invoice/{factura}`)
con un AppKey y AppToken. Para que VTEX mande los avisos, se registra el hook en la
configuración de Feed/Hook de pedidos de la cuenta, apuntando a `/webhooks/vtex/orders`,
con el header `x-hook-secret` y filtrando los estados `ready-for-handling` e `invoiced`.

La paquetería sigue siendo de mentira. En un proyecto real ahí va la API de la paquetería
del cliente, implementando la interfaz `CarrierClient` (un solo método).

## Cómo está organizado

```
src/
├── index.ts            arranque: arma las piezas según el modo (demo o live)
├── routes.ts           endpoints de Fastify y validación del aviso con zod
├── job-queue.ts        cola con deduplicación, orden por pedido y reintentos
├── order-events.ts     la lógica: qué hacer en cada estado del pedido
├── shipment-store.ts   qué pedidos ya tienen guía (idempotencia)
├── errors.ts           qué errores se reintentan y cuáles no
├── vtex/               cliente HTTP real del OMS + versión en memoria
└── carrier/            interfaz de paquetería + paquetería de mentira
```

La lógica de negocio no sabe nada de HTTP ni de Fastify: recibe un evento y unas
dependencias. Por eso las pruebas usan las versiones en memoria de VTEX y la paquetería,
sin mocks complicados.

## Pruebas

```bash
npm test
npm run typecheck
```

18 pruebas con el test runner que ya trae Node (`node:test`): la cola (reintentos, orden,
duplicados), la lógica de pedidos (incluido el caso de "la guía se generó pero falló el
start-handling") y los endpoints con `fastify.inject`. Corren en GitHub Actions en cada push.

## Lo que cambiaría para producción

- **Cola y estado persistentes.** Hoy todo vive en memoria: si el proceso se reinicia,
  se pierde lo pendiente. Lo movería a Redis (BullMQ) o a una cola administrada como SQS,
  y las guías a una base de datos.
- **Varias instancias.** Con más de una réplica, la deduplicación y el orden por pedido
  tienen que vivir en Redis o en la base, no en un `Map`.
- **Alertas.** Los eventos que fallan después de todos los intentos quedan en `/status`;
  en un proyecto real mandarían una alerta a Slack o correo.
- **Concurrencia.** Ahora no hay límite de pedidos procesándose a la vez. Con muchos pedidos
  le pondría un tope para no saturar la API de VTEX, que tiene rate limit.

## Stack

Node.js 24 · TypeScript (strict, sin build) · Fastify 5 · zod · pino · node:test · Docker · GitHub Actions

---

Hecho por **Iván Uriel Jiménez Granados** ·
[ivan-solutions-l2az.vercel.app](https://ivan-solutions-l2az.vercel.app) ·
uriel130granados@gmail.com
