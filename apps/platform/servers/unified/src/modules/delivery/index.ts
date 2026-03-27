import { Router } from 'express';
import { initDeliveryDb } from './dbService.js';
import { createDeliveryRoutes } from './routes.js';

export async function initDelivery() {
  await initDeliveryDb();
  console.log('[Delivery] Module initialized');
}

export function createDeliveryRouter(): Router {
  return createDeliveryRoutes();
}
