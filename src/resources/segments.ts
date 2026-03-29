import type { Transport } from "../transport.js";
import type { Segment, CreateSegmentInput } from "../types/segment.js";

export class SegmentsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * List saved segments for a tenant.
   *
   * GET /api/v1/segments
   */
  async list(tenantId: string): Promise<Segment[]> {
    const res = await this.transport.get<{ segments: Segment[] } | Segment[]>(
      "/segments",
      tenantId
    );
    return Array.isArray(res) ? res : res.segments;
  }

  /**
   * Create a new saved segment.
   *
   * POST /api/v1/segments
   */
  async create(tenantId: string, data: CreateSegmentInput): Promise<Segment> {
    const res = await this.transport.post<{ segment: Segment } | Segment>(
      "/segments",
      tenantId,
      data
    );
    return "segment" in res ? res.segment : res;
  }
}
