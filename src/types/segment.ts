export interface SegmentRules {
  includeTags: string[];
  excludeTags?: string[];
  operator: "AND" | "OR";
}

export interface Segment {
  id: string;
  name: string;
  rules: SegmentRules;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSegmentInput {
  name: string;
  rules: SegmentRules;
}
