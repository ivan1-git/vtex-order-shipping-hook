/**
 * Hace de VTEX: manda avisos de pedidos al servicio que está corriendo en local.
 * Uso: en una terminal `npm run dev` y en otra `npm run simulate`.
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.HOOK_SECRET ?? 'cambia-este-secreto';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hook(orderId: string, state: string, lastState: string) {
  return {
    Domain: 'Fulfillment',
    OrderId: orderId,
    State: state,
    LastState: lastState,
    LastChange: new Date().toISOString(),
    CurrentChange: new Date().toISOString(),
    Origin: { Account: 'tiendademo', Key: 'vtexappkey-tiendademo-XXXX' },
  };
}

async function send(label: string, body: unknown) {
  const response = await fetch(`${BASE_URL}/webhooks/vtex/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hook-secret': SECRET },
    body: JSON.stringify(body),
  });
  console.log(`→ ${label.padEnd(48)} ${response.status} ${await response.text()}`);
  await sleep(300);
}

await send('Ping de configuración', { hookConfig: 'ping' });
await send('v1001-01 listo para preparar', hook('v1001-01', 'ready-for-handling', 'payment-approved'));
await send('v1001-01 otra vez (VTEX reintenta)', hook('v1001-01', 'ready-for-handling', 'payment-approved'));
await send('v1002-01 pago aprobado (no requiere acción)', hook('v1002-01', 'payment-approved', 'payment-pending'));
await send('v1002-01 listo para preparar', hook('v1002-01', 'ready-for-handling', 'payment-approved'));
await send('v1003-01 listo, pero el pedido está cancelado', hook('v1003-01', 'ready-for-handling', 'payment-approved'));
await send('v1001-01 facturado', hook('v1001-01', 'invoiced', 'handling'));

console.log('\nEsperando a que la cola termine (puede haber reintentos)...');
for (;;) {
  const status = (await (await fetch(`${BASE_URL}/status`)).json()) as { pending: number; failed: unknown[] };
  if (status.pending === 0) {
    if (status.failed.length > 0) {
      console.log('Eventos que no se pudieron procesar:', status.failed);
    }
    break;
  }
  await sleep(500);
}

const shipments = await (await fetch(`${BASE_URL}/shipments`)).json();
console.log('\nGuías generadas:');
console.table(
  (shipments as Array<Record<string, unknown>>).map(({ orderId, trackingNumber, handlingStarted, trackingSentForInvoice }) => ({
    orderId,
    trackingNumber,
    handlingStarted,
    trackingSentForInvoice,
  })),
);
