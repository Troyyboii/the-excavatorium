// The Excavatorium — application record contracts (spec §8).

export type RecordType = "tool" | "repository" | "conversation" | "decision";

export const RECORD_TYPES: RecordType[] = ["tool", "repository", "conversation", "decision"];

export const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  tool: "Tool",
  repository: "Repository",
  conversation: "Conversation",
  decision: "Decision",
};

export const RECORD_TYPE_PLURAL: Record<RecordType, string> = {
  tool: "Tools",
  repository: "Repositories",
  conversation: "Conversations",
  decision: "Decisions",
};

export type ToolStatus =
  | "Active"
  | "Useful but dormant"
  | "Experimental"
  | "Worth revisiting"
  | "Disappointing"
  | "Buried"
  | "Grok-tier cursed";

export const TOOL_STATUSES: ToolStatus[] = [
  "Active",
  "Useful but dormant",
  "Experimental",
  "Worth revisiting",
  "Disappointing",
  "Buried",
  "Grok-tier cursed",
];

export type ToolData = {
  category: string;
  status: ToolStatus;
  whatCaughtMyEye: string;
  whatItPromised: string;
  whatActuallyHappened: string;
  whatWorked: string;
  whatFailed: string;
  whyIKeptOrStoppedUsingIt: string;
  replacementToolId: string | null;
  revisitCondition: string;
  finalVerdict: string;
  lastReviewed: string | null;
};

export type RatingLevel = "Unknown" | "Low" | "Medium" | "High" | "Very high";

export const RATING_LEVELS: RatingLevel[] = ["Unknown", "Low", "Medium", "High", "Very high"];

export type RepositoryAction =
  | "Use now"
  | "Cellar"
  | "Compare later"
  | "Extract patterns"
  | "Document only"
  | "Skip"
  | "Pour down sink";

export const REPOSITORY_ACTIONS: RepositoryAction[] = [
  "Use now",
  "Cellar",
  "Compare later",
  "Extract patterns",
  "Document only",
  "Skip",
  "Pour down sink",
];

export type RepositoryData = {
  githubUrl: string;
  whatCaughtMyEye: string;
  whatItClaims: string;
  whatItActuallyDoes: string;
  maintenanceImpression: string;
  complexity: RatingLevel;
  risk: RatingLevel;
  integrationCost: RatingLevel;
  immediateUsefulness: RatingLevel;
  longTermValue: RatingLevel;
  recommendedAction: RepositoryAction | null;
  finalVerdict: string;
  lastReviewed: string | null;
};

export type ProjectRoute = "The Forge" | "The Chamber" | "The Book" | "General" | "Do not preserve";

export const PROJECT_ROUTES: ProjectRoute[] = [
  "The Forge",
  "The Chamber",
  "The Book",
  "General",
  "Do not preserve",
];

export type ConversationData = {
  conversationDate: string | null;
  projectRoute: ProjectRoute;
  highSignalFindings: string;
  decisionsMade: string;
  openLoops: string;
  reusablePrompts: string;
  memoryCandidates: string;
  rawConversationText: string;
};

export type DecisionStatus = "Current" | "Tentative" | "Superseded" | "Reversed" | "Archived";

export const DECISION_STATUSES: DecisionStatus[] = [
  "Current",
  "Tentative",
  "Superseded",
  "Reversed",
  "Archived",
];

export type Confidence = "Low" | "Medium" | "High";

export const CONFIDENCE_LEVELS: Confidence[] = ["Low", "Medium", "High"];

export type DecisionData = {
  reason: string;
  trigger: string;
  whatWouldChangeMyMind: string;
  decisionDate: string;
  status: DecisionStatus;
  confidence: Confidence;
  supersedesDecisionId: string | null;
};

export type BaseArchiveRecord = {
  id: string;
  recordType: RecordType;
  title: string;
  summary: string;
  tags: string[];
  isExample: boolean;
  seedKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolRecord = BaseArchiveRecord & {
  recordType: "tool";
  recordData: ToolData;
};
export type RepositoryRecord = BaseArchiveRecord & {
  recordType: "repository";
  recordData: RepositoryData;
};
export type ConversationRecord = BaseArchiveRecord & {
  recordType: "conversation";
  recordData: ConversationData;
};
export type DecisionRecord = BaseArchiveRecord & {
  recordType: "decision";
  recordData: DecisionData;
};

export type ArchiveRecord = ToolRecord | RepositoryRecord | ConversationRecord | DecisionRecord;

export type ArchiveLink = {
  id: string;
  sourceId: string;
  targetId: string;
  seedKey: string | null;
  createdAt: string;
};

export type ArchiveExport = {
  application: "The Excavatorium";
  schemaVersion: 1;
  exportedAt: string;
  records: ArchiveRecord[];
  links: ArchiveLink[];
};

// Empty defaults used by new-record forms.
export const emptyToolData: ToolData = {
  category: "",
  status: "Active",
  whatCaughtMyEye: "",
  whatItPromised: "",
  whatActuallyHappened: "",
  whatWorked: "",
  whatFailed: "",
  whyIKeptOrStoppedUsingIt: "",
  replacementToolId: null,
  revisitCondition: "",
  finalVerdict: "",
  lastReviewed: null,
};

export const emptyRepositoryData: RepositoryData = {
  githubUrl: "",
  whatCaughtMyEye: "",
  whatItClaims: "",
  whatItActuallyDoes: "",
  maintenanceImpression: "",
  complexity: "Unknown",
  risk: "Unknown",
  integrationCost: "Unknown",
  immediateUsefulness: "Unknown",
  longTermValue: "Unknown",
  recommendedAction: null,
  finalVerdict: "",
  lastReviewed: null,
};

export const emptyConversationData: ConversationData = {
  conversationDate: null,
  projectRoute: "General",
  highSignalFindings: "",
  decisionsMade: "",
  openLoops: "",
  reusablePrompts: "",
  memoryCandidates: "",
  rawConversationText: "",
};

export const emptyDecisionData = (today: string): DecisionData => ({
  reason: "",
  trigger: "",
  whatWouldChangeMyMind: "",
  decisionDate: today,
  status: "Current",
  confidence: "Medium",
  supersedesDecisionId: null,
});

export function emptyRecordData(
  type: RecordType,
  today: string,
): ToolData | RepositoryData | ConversationData | DecisionData {
  switch (type) {
    case "tool":
      return { ...emptyToolData };
    case "repository":
      return { ...emptyRepositoryData };
    case "conversation":
      return { ...emptyConversationData };
    case "decision":
      return emptyDecisionData(today);
  }
}

// UUID v4 test (loose, no version enforcement) for restore validation.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
