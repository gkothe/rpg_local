# Dice Rolling & Combat Resolution Architecture

This is an earlier brainstorm, not a verified implementation contract. The user-approved scope and maintained implementation plan are in [Trusted dice](../../docs/plans/trusted-dice.md). That plan supersedes the alternatives and assumptions below.

---

## 1. The Problem & Requirements

In tabletop RPGs, resolving actions frequently requires mechanical dice checks (e.g., attack rolls, damage rolls, saving throws, skill checks).

### Key Concerns:

1. **Token Waste:** If a turn must stop, invoke external dice generation, and restart an LLM session, re-sending the full campaign context (rules, characters, history) would rapidly multiply input token usage.
2. **Context Loss & Session Boundaries:** The game must maintain a coherent narrative and state transition without breaking session isolation.
3. **Multi-Combatant Pacing:** In a combat round involving multiple entities (e.g., Player, Ally X, Enemy Y, Enemy Z), resolving all actions sequentially could introduce latency or token blow-up.

---

## 2. In-Session Tool Calling (Local MCP)

The preferred approach for authentic TTRPG feel is **in-session tool calling** via a local MCP (Model Context Protocol) tool.

### Design:

- A lightweight, isolated local dice tool is exposed to the CLI runner. The original notation sketch below is illustrative; the selected plan uses numeric dice groups and returns faces only, with modifiers interpreted by the GM.
- **Security & Isolation:** The CLI remains strictly sandboxed (no arbitrary file system or shell execution). The tool only performs cryptographically random number generation (`crypto.randomInt`).
- **Agency:** The GM model decides _when_ a check is needed, establishes the Difficulty Class (DC) or target Armor Class (AC), requests the roll, and dynamically resolves the outcome.

```text
[Turn Start: Player attacks Enemy X]
   │
   ├─► LLM evaluates turn context
   ├─► LLM emits: roll_dice({ notation: "1d20+5", reason: "Player attack on Enemy X" })
   │
[Local Tool Execution: Returns individual random faces; GM interprets hit]
   │
   ├─► LLM emits: roll_dice({ notation: "1d8+3", reason: "Player slashing damage" })
   │
[Local Tool Execution: Returns individual random faces; GM interprets damage]
   │
   ├─► LLM evaluates Enemy X reaction / turn
   └─► LLM emits subsequent combatant rolls or writes final narrative
```

---

## 3. Caching and latency — verify during implementation

Keeping one CLI invocation open during a game turn avoids an application restart for every dice call. It does not guarantee cache hits, a particular discount, subscription-token savings or fixed response times. Additional model steps still use subscription allowance. Measure context size, reported usage and elapsed time separately for each verified provider/version.

The user does not require live dice events, a combat ticker, animations or streaming narration. Wait for the complete answer and show all recorded dice with it. A batch of independent dice groups may be requested together; dependent rolls remain separate, and application I/O stays sequential.

---

## 4. Historical alternatives — not selected

These alternatives were considered before clarification. Neither is in the selected scope:

1. **Player-Side Dice Tray:**  
   The player can roll in the UI (or type `/roll 1d20+3`) when submitting their action. The roll result accompanies the player's prompt, resolving player checks in 0 extra steps.
2. **The "Entropy Ledger" (Pre-Rolled Pool):**  
   The backend injects an array of pre-generated random rolls into the turn's prompt context (e.g. `d20: [14, 3, 19, 8]`). The GM model consumes them sequentially for NPC actions, but exposing future results to the GM permits outcome selection. The selected plan generates faces only when requested.
