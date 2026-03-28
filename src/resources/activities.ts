import type { Transport } from "../transport.js";
import type { CreateActivityInput } from "../types/activity.js";
import type { Event } from "../types/event.js";

export class ActivitiesResource {
  constructor(private readonly transport: Transport) {}

  async create(tenantId: string, activity: CreateActivityInput): Promise<Event> {
    const res = await this.transport.post<{ event: Event }>(
      "/activities",
      tenantId,
      activity
    );
    return res.event;
  }
}
