import type { Turn } from "./chat-types";

export function mergeHistory(server: Turn[], local: Turn[]): Turn[] {
  const known = new Set(server.map((turn) => turn.id));
  return [
    ...server,
    ...local.filter((turn) => turn.status === "failed" && !known.has(turn.id)),
  ];
}
