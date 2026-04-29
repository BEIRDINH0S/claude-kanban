export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Imported / read-only project: UI hides creation/drag affordances. */
  archived: boolean;
}
