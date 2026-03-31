// Gateway model catalog discovery for plugins (same data as `models.list`).

export { DEFAULT_PROVIDER } from "../agents/defaults.js";
export type { ModelCatalogEntry } from "../agents/model-catalog.js";
export { buildAllowedModelSet } from "../agents/model-selection.js";
export {
  __resetModelCatalogCacheForTest,
  loadGatewayModelCatalog,
  type GatewayModelChoice,
} from "../gateway/server-model-catalog.js";
