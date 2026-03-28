import type { Transport } from "../transport.js";
import type { CreateEventInput, Event } from "../types/event.js";

export class EventsResource {
  constructor(private readonly transport: Transport) {}

  async create(tenantId: string, event: CreateEventInput): Promise<Event> {
    const res = await this.transport.post<{ event: Event }>(
      "/events",
      tenantId,
      event
    );
    return res.event;
  }
}
