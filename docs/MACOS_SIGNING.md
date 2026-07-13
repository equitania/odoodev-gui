# macOS Code Signing & Notarization

Goal: release builds that macOS Gatekeeper accepts without the
`xattr -cr` workaround ("app is damaged" on unsigned downloads).

Two independent steps are required — **signing** (proves who built it) and
**notarization** (Apple scans the binary server-side). Signed-but-not-notarized
apps still trigger a Gatekeeper warning; do both.

The release workflow (`.github/workflows/release.yml`) intentionally ships
WITHOUT the `APPLE_*` env vars today: tauri-action attempts a keychain import
as soon as `APPLE_CERTIFICATE` is set, and an empty secret makes every macOS
build fail. Add the secrets first (steps 1–3), then enable the env block
(step 4).

## Prerequisites

- A **Developer ID Application** certificate in the local keychain.
  Find its exact identity string and Team ID with:

  ```bash
  security find-identity -v -p codesigning
  # → Developer ID Application: <Company Name> (<TEAM_ID>)
  ```

  (Only a **Developer ID Application** identity works for distribution
  outside the App Store — "Apple Development"/"Mac Developer" do not.
  Do NOT paste the real identity string or Team ID into this file or any
  other committed file — they belong exclusively in GitHub secrets.)

## Step 1 — Export the certificate as .p12 (format matters!)

`security import` on the CI runners accepts ONLY the classic 3DES/SHA1
PKCS12 encoding. Both other formats fail with the misleading error
`MAC verification failed during PKCS12 import (wrong password?)`:

- Keychain Access exports (ancient RC2-40-CBC) → rejected
- OpenSSL 3 default exports (modern PBES2/AES-256) → rejected
- `openssl pkcs12 -export -legacy` (3DES/SHA1) → **works**

1. Open **Keychain Access** → *login* keychain → *My Certificates* →
   right-click the **Developer ID Application** entry (must contain the
   private key) → **Export** → `.p12` with a temporary password.
2. Re-encode it into the runner-compatible format and TEST the import
   locally exactly like the runner does, before uploading:

   ```bash
   openssl pkcs12 -in DeveloperID.p12 -nodes -legacy -out /tmp/devid.pem
   openssl pkcs12 -export -legacy -in /tmp/devid.pem -out DeveloperID-ci.p12
   rm /tmp/devid.pem

   # Local dry-run of the CI import (must print "1 identity imported"):
   security create-keychain -p citest /tmp/ci-test.keychain
   security import DeveloperID-ci.p12 -k /tmp/ci-test.keychain -P '<CI-PASSWORT>' -T /usr/bin/codesign
   security delete-keychain /tmp/ci-test.keychain
   ```

   Use a plain alphanumeric CI password — special characters risk being
   mangled on their way into the secret.
3. Base64-encode for GitHub: `base64 -i DeveloperID-ci.p12 | pbcopy`
4. Delete both .p12 files afterwards (`rm`) — never commit them, never
   leave them in Downloads.

## Step 2 — Create notarization credentials

Recommended: Apple-ID + app-specific password (simplest, works with
tauri-action out of the box).

1. Sign in at <https://account.apple.com> → *Sign-In and Security*
   → **App-Specific Passwords** → generate one (e.g. name `odoodev-gui-ci`).
2. Note the generated password (`xxxx-xxxx-xxxx-xxxx`).
3. The Team ID is the value in parentheses in the certificate identity
   (see `security find-identity` above).

Alternative (more setup, no personal Apple-ID in CI): an App Store Connect
API key (`APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH`) —
see the tauri-action docs if we ever want to switch.

## Step 3 — Add GitHub secrets

Repo: `github.com/equitania/odoodev-gui` → *Settings* → *Secrets and variables*
→ *Actions* → **New repository secret**, or via CLI:

```bash
gh secret set APPLE_CERTIFICATE          --repo equitania/odoodev-gui  # paste base64 from step 1
gh secret set APPLE_CERTIFICATE_PASSWORD --repo equitania/odoodev-gui  # .p12 export password
gh secret set APPLE_SIGNING_IDENTITY     --repo equitania/odoodev-gui \
  --body "Developer ID Application: <Company Name> (<TEAM_ID>)"
gh secret set APPLE_ID                   --repo equitania/odoodev-gui  # Apple-ID e-mail
gh secret set APPLE_PASSWORD             --repo equitania/odoodev-gui  # app-specific password
gh secret set APPLE_TEAM_ID              --repo equitania/odoodev-gui --body "<TEAM_ID>"
```

## Step 4 — Enable signing in release.yml

Once ALL six secrets exist, add these lines to the `env:` block of the
`tauri-apps/tauri-action@v0` step in `.github/workflows/release.yml`
(replacing the explanatory comment there):

```yaml
          # macOS code signing + notarization
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Notarization adds ~5–15 minutes to the macOS job (Apple's scan queue).

## Step 5 — Verify after the next release

Download the fresh .dmg from the GitHub release on a Mac and check:

```bash
codesign -dv --verbose=2 /Applications/odoodev-gui.app   # shows the identity
spctl -a -vv /Applications/odoodev-gui.app               # "accepted / notarized"
xcrun stapler validate /Applications/odoodev-gui.app     # staple ticket ok
```

The app must open by double-click with no "damaged"/"cannot be checked"
dialog and without `xattr -cr`.

## Notes

- The Tauri **updater** signature (minisign, `TAURI_SIGNING_PRIVATE_KEY`)
  is a separate mechanism and stays unchanged — it protects updates,
  Apple signing protects first installs.
- Certificate expiry: Developer ID certificates last 5 years; on renewal,
  re-export the .p12 and update `APPLE_CERTIFICATE`/`_PASSWORD`.
- If a macOS build fails right after enabling the env block, check the
  "import certificate" step in the job log first (usually a wrong .p12
  password or truncated base64).
