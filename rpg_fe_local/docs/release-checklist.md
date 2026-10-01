# Frontend release checks

- [x] Local API only; no login/user/community/map/adventure UI or cloud LLM clients.
- [x] Fresh source rather than old Git history/private campaign copying.
- [x] Real build, strict typecheck, ESLint/Prettier and nonempty synthetic test suites.
- [x] Installed Windows Chrome synthetic browser and isolated PostgreSQL manual workflow smoke.
- [x] Responsive width sweep and desktop/mobile visual inspection.
- [x] Root-coordinated source/bundle scan; zero findings and no inherited history.
- [x] Real Antigravity browser turn/model-switch/context/undo; cancellation covered by synthetic/SQL regressions. Other providers remain explicitly unverified or disabled.
- [x] Actual native/scanned/mixed/Portuguese extraction and manual correction.
- [x] Windows installed local browser voice playback with synthetic GM text; no AI call.
- [x] Windows Chrome synthetic audio capture through actual MediaRecorder/local Faster-Whisper into an editable composer; zero GM submissions.
- [x] Real NIC HTTPS paired browser, Secure/HttpOnly device cookie, revoke/re-pair with unsent draft retention and PostgreSQL notes after reload.
- [ ] Actual phone LAN/HTTPS/device-pairing and reconnect validation.
- [x] Fresh-source/lockfile Windows installation and production build; no remote clone/publication.

Browser fixtures are confined to tests. Synthetic audio capture tests never use a personal microphone. The HTTPS fixture bypasses certificate errors only in explicitly created test browser contexts; it does not establish Android certificate trust. No live AI request, firewall/certificate-trust change or publication was performed by frontend tests.
