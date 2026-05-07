import type { StackFrameLocation } from "../reporters/stack-frame.js";

export interface ExplainQuestionArtifact {
  question: string;
  source: StackFrameLocation;
}

export interface ExplainArtifact {
  suitePath: string;
  caseId: string;
  runnerId: string;
  sessionId?: string;
  questions: ExplainQuestionArtifact[];
}
