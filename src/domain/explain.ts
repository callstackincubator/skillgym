import type { StackFrameLocation } from "../reporters/stack-frame.js";

export interface ExplainQuestionArtifact {
  question: string;
  source: StackFrameLocation;
}

export interface ExplainArtifact {
  suitePath: string;
  caseId: string;
  runnerId: string;
  cwd: string;
  sessionId?: string;
  questions: ExplainQuestionArtifact[];
}

export interface ExplanationQuestionArtifact extends ExplainQuestionArtifact {
  answer: string;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  rawArtifacts: {
    stdoutPath?: string;
    stderrPath?: string;
    sessionPath?: string;
    exportPath?: string;
  };
}

export interface ExplanationsArtifact {
  suitePath: string;
  caseId: string;
  runnerId: string;
  cwd: string;
  sessionId: string;
  createdAt: string;
  questions: ExplanationQuestionArtifact[];
}
