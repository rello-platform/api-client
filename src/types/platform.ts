/** Info about a registered platform app, returned by the app registry endpoint. */
export interface AppInfo {
  /** Unique slug identifier (e.g., "property-engine"). */
  slug: string;
  /** Human-readable name (e.g., "Property Engine"). */
  name: string;
  /** Production base URL (e.g., "https://property-engine-production.up.railway.app"). Null if not configured. */
  baseUrl: string | null;
  /** Health check URL. Null if not configured. */
  healthUrl: string | null;
  /** App status: "STABLE", "BETA", etc. DEVELOPMENT/DEPRECATED/RETIRED are not returned (404). */
  status: string;
  /** Normalized source key for signal routing (e.g., "PROPERTY_ENGINE"). Null if not set. */
  appSourceKey: string | null;
}
