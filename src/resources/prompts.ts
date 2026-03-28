import type { Transport } from "../transport.js";

export interface Prompt {
  id: string;
  slug: string;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export class PromptsResource {
  constructor(private readonly transport: Transport) {}

  async get(slug: string, tenantId: string = ""): Promise<Prompt | null> {
    try {
      return await this.transport.get<Prompt>(
        "/prompts",
        tenantId,
        { slug }
      );
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error && (error as { statusCode: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}
