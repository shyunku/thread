# Windows signed-update preparation

This is the offline preparation and verification sequence for #64. It does not authorize production key creation, certificate use, database changes or publication. Follow the approved [signing policy](protocol/v3-update-signing-policy.md).

## 1. Create the initial trust root

On a trusted offline Windows machine with the project dependencies installed, choose a new absolute directory outside the Thread checkout, CI, RMS and cloud-synced folders. Protect the disk and account first. From `apps/desktop` run:

```powershell
node scripts/updateTrustRoot.cjs init <new-absolute-directory> <future-UTC-ISO-expiry>
```

The command requires an interactive terminal. It asks twice for a separate 16-byte-or-longer passphrase for each of the root, targets, snapshot and timestamp Ed25519 keys. The passphrases do not appear in arguments or environment variables. Output is a self-signed public `root.json` plus four encrypted `*.key.pem` files. It refuses an existing directory and a destination inside the repository. Do not retry into a partially created directory or publish it; inspect it and start in a different new location.

Keep the root private key and an independently protected backup offline. Record the passphrases in a separate secure password manager. Losing the root key and backup prevents normal trust-root renewal; exposing it permits unauthorized key changes. Do not put any private key, passphrase or signing plan into Git, `.env`, CI or RMS. Node file mode is not a Windows ACL policy: check the destination permissions yourself.

Validate the public document before using it:

```powershell
node scripts/updateTrustRoot.cjs verify <absolute-path-to-root.json>
```

Record the reported SHA-256 and expiry. Independently compare the SHA-256 of the copy that will go into the app. Copy **only** the public `root.json` to `apps/desktop/public/resources/update-trust/root.json`. The repository generator must receive the same bytes as the app; do not replace this root later without a signed root-rotation workflow.

## 2. Build and sign the Windows installer

Obtain a Windows code-signing certificate through the separately approved process, then build and OS-sign the x64 installer. TUF metadata signing and Windows Authenticode signing are separate: one does not substitute for the other. The pack hook now fails if the public root is missing, invalid, expired or differs from `build/resources/update-trust/root.json`. This prevents another rootless installer, but does not itself prove Authenticode status.

## 3. Generate and preflight a public TUF repository

Create a JSON plan outside Git. Its fields are `root` (signed public root path), `keys.targets`, `keys.snapshot`, `keys.timestamp` (encrypted PEM paths), `output` (new absolute directory), `version` (metadata version), `expires.targets`, `expires.snapshot`, `expires.timestamp` (future UTC ISO timestamps), `releases` (signed installer file path, platform `win`, architecture `x64`, version and mandatory flag), and `bootstrap: true` for the first repository. The tool requires timestamp expiry no later than snapshot, snapshot no later than targets, and targets no later than root. A beta release cannot be mandatory. Never include the root private key in this plan.

From `apps/desktop` run the existing generator. It now prompts for the encrypted targets, snapshot and timestamp key passphrases; plaintext PEM files are rejected by this CLI:

```powershell
node scripts/updateRepository.cjs <absolute-plan-path>
```

Use the separate read-only preflight against the generated directory and the exact app root:

```powershell
node scripts/verifyUpdateRepository.cjs <absolute-generated-repository> <absolute-app-root.json>
```

Preflight checks root byte equality, self-signature, expiry and role separation; timestamp/snapshot/targets signatures; signed catalog; every listed installer hash and size; and the `READY` marker. It does **not** verify Authenticode, server TLS, database backups or actual installation. Check those separately before approval. The public repository must contain only metadata and targets, never keys or plans.

## 4. Publish and verify only after separate approval

Publish the verified public `metadata/` and `targets/` directories to the HTTPS RMS `/tuf/` repository. Compose mounts the `rms-tuf` volume read-only into RMS, so publication is a separate operator action. Verify the served bytes and a real Windows installation before considering #64 complete. Existing rootless beta.2 installations need a one-time manual install of the trusted-root build; server publication alone cannot give them a trusted initial root.

For later releases, supply the last published public repository as `previous`, omit `bootstrap`, increment metadata `version`, and use a fresh output directory. Keep the previous repository and all numbered root versions. Root key rotation is a separate old-and-new-root-signed workflow and is not supported by the initial generator. Renew metadata before expiry; never replace an existing version path in place.
