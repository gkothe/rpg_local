export const JOURNAL_SECTIONS = [
  {
    id: 'notes',
    label: 'Personal notes',
    information:
      'Your private notebook for reminders, theories and plans. Save notes to keep them with this campaign.',
    gmEffect:
      'Personal notes are never sent to the GM. Writing or saving here does not change what the GM knows or how the story unfolds. Tell the GM through your action when you want to share something.',
  },
  {
    id: 'knowledge',
    label: 'Campaign knowledge',
    information:
      'A record of people, places, promises, debts, objectives and discoveries your character knows about. Entries show their certainty, current or past status, connections and supporting evidence.',
    gmEffect:
      'The GM uses saved knowledge to maintain continuity and can look up older facts. Rumors remain uncertain and completed matters remain historical. Accepting a correction changes the fact used in future GM context and invalidates summaries that could repeat the mistake.',
    usage:
      'Open an entry to inspect its evidence or flag a mistake. Fill from past conversations recovers missing entries using your provider allowance. Checking a mistake stages a proposal; it changes nothing until you accept it.',
  },
  {
    id: 'memory',
    label: 'Campaign memory',
    information:
      'A compact summary of earlier completed conversations. Full conversations remain saved, and character sheets and campaign knowledge are stored separately.',
    gmEffect:
      'Memory helps the GM remember older events without rereading the entire transcript in each prompt. With selective history off, the GM receives the full current memory alongside recent turns. A summary does not override saved character state or corrected facts.',
    usage:
      'Rebuild memory uses your provider allowance to create a draft from the original conversations. Review it before applying; only Apply replaces the current memory.',
  },
  {
    id: 'history',
    label: 'History recall',
    information:
      'Controls how older conversations are summarized, searched and selected for the GM. You can inspect coverage and protect important knowledge, history sections or memory checkpoints.',
    gmEffect:
      'After you activate selective history, the GM receives a compact overview, protected material, relevant older sections and recent conversations. It can search and read the original older conversations when needed. Turning selective history off returns new actions to the full-memory prompt. Nothing is deleted.',
    usage:
      'Prepare compact history uses your provider allowance and stages a draft for review. It takes effect only when you activate it. Protected items stay in context while available, even if they exceed the soft size target.',
  },
  {
    id: 'advancement',
    label: 'Advancement',
    information:
      'Reviews completed, unreviewed conversations for rewards under your game system. You can review and edit a proposal, apply awards to the ledger, or reverse the latest applied review.',
    gmEffect:
      'Starting your first review switches the campaign to manual advancement: the gameplay GM leaves progression awards to this separate review. Applied awards and the retained progression policy inform later GM context and reviews. Applying awards records them but does not update your character sheet; update it yourself.',
    usage:
      'Review advancement uses your provider allowance. A proposal awards nothing until you apply it. Reversing a review removes its awards and coverage; reconcile any manual sheet changes yourself.',
  },
] as const;

export type JournalSection = (typeof JOURNAL_SECTIONS)[number];
