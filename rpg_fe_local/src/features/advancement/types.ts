export interface Award {
  characterId: string;
  kind: string;
  unitKey: string;
  unitLabel: string;
  amount: number | null;
  reason: string;
  basis: string;
  basisKind: string;
  evidenceTurnIds: string[];
}
export interface Proposal {
  outcome: string;
  rewardSystem: { key: string; label: string; editionLabel: string | null };
  explanation: string;
  progressionBasis: string;
  progressionBasisKind: string;
  awards: Award[];
  cumulativeSummary: string;
  pendingObjectives: string[];
  ruleEvidence: { receiptId: string; quote: string }[];
}
export interface Review {
  id: string;
  campaignId: string;
  requestId: string;
  status: string;
  imported: boolean;
  proposal: Proposal | null;
  proposalDigest: string | null;
  adjustmentReason: string | null;
  safeError: string | null;
  reviewedTurnIds: string[];
  appliedAt: string | null;
  awards: (Award & { id: string; recipientName: string; currencyId: string })[];
}
export interface AdvancementSummary {
  players: {
    characterId: string;
    totals: {
      currencyId: string;
      systemLabel: string;
      unitLabel: string;
      kind: string;
      total: number;
    }[];
  }[];
  ledger: unknown[];
  ledgerDigest: string;
}
export interface ReviewList {
  reviews: Review[];
  outstandingTurnCount: number;
  nextCursor: string | null;
}
