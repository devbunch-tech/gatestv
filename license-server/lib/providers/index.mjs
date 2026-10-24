// Loja usada para conferir os pagamentos: STORE_PROVIDER=checkout (padrão: checkout próprio + Asaas), nuvemshop ou shopify.
import { config } from '../config.mjs';
import * as checkout from './checkout.mjs';
import * as nuvemshop from './nuvemshop.mjs';
import * as shopify from './shopify.mjs';

const ALL = { checkout, nuvemshop, shopify };
export const provider = ALL[config.storeProvider] || checkout;
