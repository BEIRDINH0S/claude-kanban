export type CardColumn =
  | "todo"
  | "in_progress"
  | "review"
  | "idle"
  | "done";

export interface Card {
  id: string;
  title: string;
  column: CardColumn;
  position: number;
  sessionId: string | null;
  projectPath: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  lastState: string | null;
}
