// <define:__ROUTES__>
var define_ROUTES_default = {
  version: 1,
  include: [
    "/api/*",
    "/admin/api/*",
    "/webhooks/*",
    "/health",
    "/d/*",
    "/tv",
    "/tv/*"
  ],
  exclude: []
};

// ../../../../AppData/Local/npm-cache/_npx/3750d4a998b75d79/node_modules/wrangler/templates/pages-dev-pipeline.ts
import worker from "C:\\Users\\paula\\Documents\\projects\\gates-iptv\\.wrangler\\tmp\\pages-d6mOzG\\functionsWorker-0.283101440954028.mjs";
import { isRoutingRuleMatch } from "C:\\Users\\paula\\AppData\\Local\\npm-cache\\_npx\\3750d4a998b75d79\\node_modules\\wrangler\\templates\\pages-dev-util.ts";
export * from "C:\\Users\\paula\\Documents\\projects\\gates-iptv\\.wrangler\\tmp\\pages-d6mOzG\\functionsWorker-0.283101440954028.mjs";
var routes = define_ROUTES_default;
var pages_dev_pipeline_default = {
  fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    for (const exclude of routes.exclude) {
      if (isRoutingRuleMatch(pathname, exclude)) {
        return env.ASSETS.fetch(request);
      }
    }
    for (const include of routes.include) {
      if (isRoutingRuleMatch(pathname, include)) {
        const workerAsHandler = worker;
        if (workerAsHandler.fetch === void 0) {
          throw new TypeError("Entry point missing `fetch` handler");
        }
        return workerAsHandler.fetch(request, env, context);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  pages_dev_pipeline_default as default
};
//# sourceMappingURL=r28d0agr49.js.map
