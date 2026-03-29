export interface Tag {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  color: string | null;
  leadCount: number;
}

export interface TagsListParams {
  category?: string;
  search?: string;
  includeArchived?: boolean;
}

export interface TagSearchParams {
  query?: string;
  category?: string;
  limit?: number;
}
