export type HomeAttentionCopy = {
  heading: string;
  explanation: string;
};

export function homeAttentionCopy(hasAttention: boolean): HomeAttentionCopy {
  return hasAttention
    ? {
        heading: "Attention is needed.",
        explanation:
          "The Archive flags these records from their saved status and content. Each entry shows the matching reason.",
      }
    : {
        heading: "Nothing stirs.",
        explanation:
          "No archive records currently need your attention under the checks available here.",
      };
}
