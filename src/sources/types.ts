export interface RawPosting {
  sourceId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  postedAt: number | null;
}

export interface FetchParams {
  keywords: string;
  geo: string;
  count: number;
}

export interface FetchResult {
  postings: RawPosting[];
  /** Rows the adapter could not turn into a RawPosting. Reported, never hidden. */
  unparseable: number;
}

export interface JobSource {
  readonly name: string;
  fetch(params: FetchParams): Promise<FetchResult>;
}
