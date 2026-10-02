# Book gameplay effort selection

Removed the extra book-mode effort allowlist for every provider. Rule-tool capability,
model-native effort support and existing input/tool budgets still apply. Default
(null effort) is accepted, and the picker always offers it. Rules capability metadata
now reports the model's effort list rather than a tested subset. Frontend readiness
does not reject an effort based on historical rules metadata.

The existing Vampire campaign was blocked because it selected Antigravity Gemini
3.8 Flash High. Its saved selection was preserved. No gameplay turn was submitted.

Validation: eight backend provider tests, 48 frontend unit tests, six Windows Chrome
browser tests, root lint and production build. Backend tests cover Low, Medium, High,
XHigh, Max and Default; browser checks cover High and Default against the former
Medium-only capability metadata. These checks do not claim live AI acceptance for
every effort. Runtime CLI failures remain visible through existing turn errors.
