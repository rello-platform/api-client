import type { Transport } from "../transport.js";
import type { Tag, TagsListParams, TagSearchParams } from "../types/tag.js";

export class TagsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * List all tags for a tenant.
   *
   * GET /api/v1/tags
   */
  async list(tenantId: string, params: TagsListParams = {}): Promise<Tag[]> {
    const query: Record<string, string | undefined> = {};
    if (params.category) query.category = params.category;
    if (params.search) query.search = params.search;
    if (params.includeArchived) query.includeArchived = "true";

    const res = await this.transport.get<{ success: boolean; tags: Tag[] } | Tag[]>(
      "/tags",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.tags;
  }

  /**
   * Search tags by name with lead counts.
   *
   * GET /api/v1/tags/search
   *
   * Performs fuzzy matching on tag name and slug.
   */
  async search(tenantId: string, params: TagSearchParams = {}): Promise<Tag[]> {
    const query: Record<string, string | undefined> = {};
    if (params.query) query.q = params.query;
    if (params.category) query.category = params.category;
    if (params.limit !== undefined) query.limit = String(params.limit);

    const res = await this.transport.get<{ tags: Tag[] } | Tag[]>(
      "/tags/search",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.tags;
  }
}
