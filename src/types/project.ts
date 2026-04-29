export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Imported / read-only project: UI hides creation/drag affordances. */
  archived: boolean;
  /** User-controlled order in the sidebar (dense, 0..n-1). */
  position: number;
}
