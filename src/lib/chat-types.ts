export type Turn = {
  id: string;
  content: string;
  reply: string;
  status: "pending" | "complete" | "failed";
  error: string | null;
  attempt: number;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ModelSettings = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  source: "environment" | "settings" | "demo";
};

export type ChatSnapshot = { turns: Turn[]; settings: ModelSettings };
export type ChatEvent =
  | { type: "snapshot"; turns: Turn[] }
  | { type: "delta"; id: string; text: string }
  | { type: "done"; turns: Turn[] }
  | { type: "error"; error: string; turns: Turn[] };
