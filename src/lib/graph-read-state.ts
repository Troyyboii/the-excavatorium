export type GraphLinkReadState = "ready" | "pending" | "error" | "cold-offline";

export function getGraphLinkReadState({
  pending,
  error,
  coldOffline,
}: {
  pending: boolean;
  error: unknown;
  coldOffline: boolean;
}): GraphLinkReadState {
  if (coldOffline) return "cold-offline";
  if (pending) return "pending";
  return error ? "error" : "ready";
}

export function graphLinkEvidenceLabel(state: GraphLinkReadState, linkCount: number): string {
  if (state === "pending") return "persisted links are being retrieved";
  if (state === "error") return "persisted link evidence is unavailable";
  if (state === "cold-offline") return "no cached persisted link evidence is available";
  return `${linkCount} persisted links`;
}
