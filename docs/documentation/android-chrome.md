# Android Chrome play and audio

Build the frontend and open the backend's approved HTTPS LAN URL on your Android phone. Keep the Windows host awake and both devices on the same Wi-Fi. Use the [LAN setup guide](lan-setup.md) for certificate and network setup; the Vite development proxy must stay loopback-only.

Chrome must trust the certificate for the LAN address. Merely dismissing a certificate warning does not prove microphone access will work. Certificate installation and Windows Private-network firewall configuration are explicit local setup steps; the app does not change either automatically.

On the desktop, open Settings and create a connection code. On the phone, enter it in Connect this device. A code is single-use and expires. Revoking devices on the desktop forces a new code; unsent form drafts remain while the current browser page stays open. Reloading or closing the page can discard unsaved text, so save notes and copy long actions before doing that.

## Verify on the physical phone

1. Create/open a test campaign, save a personal note, reload and confirm it remains.
2. Type an unsent action. Revoke devices on the desktop, trigger a phone request and pair again. Confirm the action remains.
3. Tap Dictate and approve Chrome's microphone permission. Speak a short action, tap Stop recording, and verify the text appears in Your action. Correct it before tapping Send. Dictation must not send a turn automatically.
4. Start another recording and tap Discard audio. Confirm it adds no text. Deny microphone permission once and confirm typing still works. Review Chrome's site permissions if permission must be restored.
5. Open Read aloud on a committed GM response. Choose an installed local voice and check Read, Pause, Resume and Stop. Leaving the campaign or undoing the message should stop playback.

Read aloud only lists voices that Chrome reports as local. Android voice availability varies by installed speech engine/language data; download offline language data in the Android speech settings if needed, then reopen the page. If Chrome reports no local voice, the app shows that limitation and continues with text; it never silently switches to an online voice.

Local transcription runs on Windows, so the phone needs no Whisper model or AI CLI. Whisper adds no API bill; the resulting text uses normal GM input context when explicitly sent. Reading existing text uses no GM tokens.

Windows installed-Chrome tests passed real NIC HTTPS pairing/reconnect, local installed-voice playback and synthetic audio through MediaRecorder/local Whisper. These are browser/runtime checks, not a claim that a physical Android device has been tested.
