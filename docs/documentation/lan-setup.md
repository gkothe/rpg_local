# Windows host and Android Chrome

The PC runs PostgreSQL, the AI CLI and local transcription. Keep it awake and connect both devices to the same private network. Guest Wi-Fi/client isolation can prevent devices from reaching each other. Public tunnels and router port forwarding are outside this release.

Use the production build for phone access. The Vite proxy is for the desktop only: proxying phone requests through loopback would defeat device classification.

Find your PC's private IPv4 address with `ipconfig`, then configure it explicitly in the PowerShell session used to start the app:

```powershell
$env:RPG_LAN_HOST = 'YOUR_PRIVATE_IPV4'
npm run build
npm start
```

Typing works at `http://YOUR_PRIVATE_IPV4:4100`. Open `http://127.0.0.1:4100` on the desktop, go to Settings and create a connection code. Enter the code on the phone. Codes expire after two minutes and work once; device approval lasts twelve hours. Desktop revoke and server restart require pairing again. The phone cannot manage pairing approvals or launch arbitrary commands.

## HTTPS for the microphone

Chrome needs a trusted secure origin for recording. Dismissing a certificate warning is insufficient. A local certificate authority is one option; these are deliberate setup steps that change trust on the devices, never automatic application actions.

Install [mkcert using its Windows instructions](https://github.com/FiloSottile/mkcert#installation). Keep certificate files outside the repository. These commands install your local CA on Windows and issue a certificate for your PC address and loopback:

```powershell
$certDir = Join-Path $env:LOCALAPPDATA 'LocalRpgCertificates'
New-Item -ItemType Directory -Force -Path $certDir
mkcert -install
mkcert -cert-file "$certDir\server.pem" -key-file "$certDir\server-key.pem" YOUR_PRIVATE_IPV4 localhost 127.0.0.1
$env:RPG_TLS_CERT_PATH = "$certDir\server.pem"
$env:RPG_TLS_KEY_PATH = "$certDir\server-key.pem"
$env:RPG_HTTPS_PORT = '4443'
mkcert -CAROOT
```

Transfer only the public `rootCA.pem` from the printed CA directory to Android, renaming the copy to `rootCA.crt` if its certificate picker requires that extension. Install it as a CA certificate in Android's security/credential settings. Never transfer either private key. Restart the backend, then open `https://YOUR_PRIVATE_IPV4:4443` in Android Chrome, confirm there is no certificate error, and pair on that HTTPS page. Reissue the server certificate if the PC's address changes. [mkcert mobile-device documentation](https://github.com/FiloSottile/mkcert#mobile-devices) describes the root CA requirement.

If Windows Firewall blocks access, manually allow only the app's configured TCP port on the Private network profile, limited to your local subnet. For HTTPS that is 4443; open 4100 only if you also want LAN HTTP. PostgreSQL stays on loopback and needs no LAN rule. The app does not modify firewall rules or certificate stores.

Use [the Android test checklist](android-chrome.md) to verify pairing/reconnect, microphone permission, editable transcription and installed local voices. The Windows browser tests verified these application flows with synthetic audio and fixture HTTPS, but a physical phone's certificate trust and available voices still need this check. Dictation requires the PC runtime described in [local runtime setup](local-runtime.md).
