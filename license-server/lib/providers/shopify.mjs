// Conector Shopify (mantido como alternativa à Nuvemshop).
import { config, shopifyConfigured } from '../config.mjs';
export { fetchCustomerByEmail, fetchOrderEmail, checkConnection, registerWebhooks } from '../shopify.mjs';
export const name = 'shopify';
export const label = 'Shopify';
export const configured = () => shopifyConfigured() || !!config.shopify.apiBase;
