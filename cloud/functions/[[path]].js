// Todas as rotas dinâmicas passam por src/app.js (ver public/_routes.json).
import { handle } from '../src/app.js';

export const onRequest = ({ request, env }) => handle(request, env);
