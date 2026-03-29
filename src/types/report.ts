export interface ReportIngestInput {
  slug: string;
  date: string;
  metrics: Record<string, number>;
}
