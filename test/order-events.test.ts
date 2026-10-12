import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { FakeCarrier } from '../src/carrier/fake-carrier.ts';
import { HttpError } from '../src/errors.ts';
import { createOrderEventHandler, toShipmentRequest } from '../src/order-events.ts';
import { ShipmentStore } from '../src/shipment-store.ts';
import { FakeVtexClient } from '../src/vtex/fake-client.ts';
import { hook, order, silentLogger } from './helpers.ts';

describe('createOrderEventHandler', () => {
  let vtex: FakeVtexClient;
  let carrier: FakeCarrier;
  let shipments: ShipmentStore;
  let handle: ReturnType<typeof createOrderEventHandler>;

  beforeEach(() => {
    vtex = new FakeVtexClient([order(), order({ orderId: 'v501-01', status: 'canceled' })]);
    carrier = new FakeCarrier();
    shipments = new ShipmentStore();
    handle = createOrderEventHandler({ vtex, carrier, shipments, logger: silentLogger });
  });

  it('genera la guía y arranca la preparación cuando el pedido está listo', async () => {
    const result = await handle(hook('v500-01', 'ready-for-handling'));

    assert.equal(result.action, 'shipment-created');
    assert.equal(carrier.created.length, 1);
    assert.equal(vtex.orders.get('v500-01')?.status, 'handling');
    assert.equal(shipments.get('v500-01')?.handlingStarted, true);
  });

  it('no genera una segunda guía si el aviso se repite', async () => {
    await handle(hook('v500-01', 'ready-for-handling'));
    const second = await handle(hook('v500-01', 'ready-for-handling'));

    assert.equal(second.action, 'skipped');
    assert.equal(carrier.created.length, 1);
  });

  it('si falló el start-handling, en el reintento solo hace ese paso', async () => {
    const originalStartHandling = vtex.startHandling.bind(vtex);
    vtex.startHandling = async () => {
      throw new HttpError(503, 'https://vtex', 'timeout');
    };
    await assert.rejects(handle(hook('v500-01', 'ready-for-handling')));

    vtex.startHandling = originalStartHandling;
    const retry = await handle(hook('v500-01', 'ready-for-handling'));

    assert.equal(retry.action, 'handling-started');
    assert.equal(carrier.created.length, 1, 'no debe pedir otra guía a la paquetería');
  });

  it('ignora pedidos cancelados', async () => {
    const result = await handle(hook('v501-01', 'ready-for-handling'));

    assert.equal(result.action, 'skipped');
    assert.equal(carrier.created.length, 0);
  });

  it('manda el tracking a VTEX cuando el pedido se factura, una sola vez', async () => {
    await handle(hook('v500-01', 'ready-for-handling'));
    const trackingNumber = shipments.get('v500-01')?.trackingNumber;

    const sent = await handle(hook('v500-01', 'invoiced'));
    const again = await handle(hook('v500-01', 'invoiced'));

    assert.deepEqual(sent, { action: 'tracking-sent', orderId: 'v500-01', invoiceNumber: 'F-100', trackingNumber });
    assert.equal(again.action, 'skipped');
    assert.equal(vtex.orders.get('v500-01')?.packageAttachment.packages[0]?.trackingNumber, trackingNumber);
  });

  it('se queja (para reintentar) si VTEX avisa facturado pero la factura no aparece', async () => {
    await handle(hook('v500-01', 'ready-for-handling'));
    vtex.orders.get('v500-01')!.packageAttachment.packages = [];

    await assert.rejects(handle(hook('v500-01', 'invoiced')), /aún no tiene factura/);
  });

  it('no hace nada con estados que no le tocan', async () => {
    const result = await handle(hook('v500-01', 'payment-approved'));

    assert.equal(result.action, 'skipped');
    assert.deepEqual(vtex.calls, []);
  });
});

describe('toShipmentRequest', () => {
  it('suma el peso de los productos y usa medio kilo cuando no viene', () => {
    const request = toShipmentRequest(order());

    // 2 playeras de 250 g + 1 gorra sin peso (500 g) = 1 kg
    assert.equal(request.weightKg, 1);
    assert.equal(request.addressLine, 'Insurgentes Sur 1000, Del Valle');
    assert.equal(request.postalCode, '03100');
  });
});
