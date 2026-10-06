export const SETTINGS_CONTRACT_VERSION = 1;
export const GM_RESPONSE_SCHEMA_VERSION = 1;
export const DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION = 2;
export const LEGACY_ARCHIVE_FORMAT_VERSION = 1;
export const DICE_ARCHIVE_FORMAT_VERSION = 2;
export const RULE_BOOK_PACKAGE_VERSION = 1;
export const RULE_BACKUP_FORMAT_VERSION = 1;
export const RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION = 3;
export const RULE_ARCHIVE_FORMAT_VERSION = 3;
export const ARCHIVE_FORMAT_ID = 'local-rpg';

export const KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION = 4;
export const KNOWLEDGE_ARCHIVE_FORMAT_VERSION = 4;
export const AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION = 5;
export const AUDITED_ARCHIVE_FORMAT_VERSION = 5;
export const NPC_RETRIEVAL_ARCHIVE_FORMAT_VERSION = 6;
export const AUDITED_GAMEPLAY_DIGEST_VERSION = 3;

export const LEGACY_GAMEPLAY_DIGEST_VERSION = 1;
export const KNOWLEDGE_GAMEPLAY_DIGEST_VERSION = 2;

// Version 6 adds individual combat identity for new actions and exports.
export const COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION = 6;
export const COMBAT_GAMEPLAY_DIGEST_VERSION = 4;
export const COMBAT_ARCHIVE_FORMAT_VERSION = 7;
export const ENABLED_GAMEPLAY_RESPONSE_SCHEMA_VERSION: number =
  COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION;
export const ARCHIVE_FORMAT_VERSION = COMBAT_ARCHIVE_FORMAT_VERSION;

/** Versions 5 and 6 share audited provenance, privacy, source recall and narrative editing. */
export function usesAuditedContract(version: number | undefined): boolean {
  return (
    version === AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION ||
    version === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION
  );
}
export function usesCombatContract(version: number | undefined): boolean {
  return version === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION;
}
/** Knowledge records keep the version 5 contract; version 6 adds no knowledge fields. */
export function knowledgeContractVersion(version: number): number {
  return usesAuditedContract(version) ? AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION : version;
}
export function gameplayDigestVersion(version: number | undefined): number {
  return version === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ? COMBAT_GAMEPLAY_DIGEST_VERSION
    : version === AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION
      ? AUDITED_GAMEPLAY_DIGEST_VERSION
      : (version ?? 0) >= KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION
        ? KNOWLEDGE_GAMEPLAY_DIGEST_VERSION
        : LEGACY_GAMEPLAY_DIGEST_VERSION;
}
