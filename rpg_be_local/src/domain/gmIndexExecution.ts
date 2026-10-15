export enum GmIndexUpdateMode {
  SeparateAgent = 'separate_agent',
  SameConversation = 'same_gm_conversation',
}
export const GM_INDEX_UPDATE_MODE_OPTIONS = [
  { id: GmIndexUpdateMode.SeparateAgent, label: 'Separate index agent', default: true },
  {
    id: GmIndexUpdateMode.SameConversation,
    label: 'Continue the turn GM',
    default: false,
    requiresConversation: true,
  },
] as const;
export const gmIndexUpdateModeOf = (value: { gmIndexUpdateMode?: GmIndexUpdateMode }) =>
  value.gmIndexUpdateMode ?? GmIndexUpdateMode.SeparateAgent;

export enum FinalizationResumeIntent {
  Continue = 'continue',
  SeparateIndexRecovery = 'separate_index_recovery',
}
