import type { VtexOrder } from '../types.ts';

export interface TrackingUpdate {
  trackingNumber: string;
  trackingUrl: string;
  courier: string;
}

/** Las tres llamadas al OMS de VTEX que necesita este flujo. */
export interface VtexClient {
  getOrder(orderId: string): Promise<VtexOrder>;
  startHandling(orderId: string): Promise<void>;
  updateTracking(orderId: string, invoiceNumber: string, tracking: TrackingUpdate): Promise<void>;
}
