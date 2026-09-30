# Windows signed-update preparation

This is the offline preparation and verification sequence for #64. It does not authorize production key creation, certificate use, database changes or publication. Follow the approved [signing policy](protocol/v3-update-signing-policy.md).

## 1. Create the initial trust root

On a trusted Windows machine with the project dependencies installed, run from the repository root:

```powershell
pnpm cert:desktop:create [<future-UTC-ISO-expiry>]
```

It creates a new `%USERPROFILE%\.thread-trust\trust-YYMMDD-HHMM` directory (local time). The default root expiry is five years ahead. `node scripts/updateTrustRoot.cjs init <new-absolute-directory> <future-UTC-ISO-expiry>` from `apps/desktop` does the same for an explicit directory. Both refuse an existing directory and a destination inside the repository. Do not retry into a partially created directory or publish it; inspect it and start in a different new location.

The command requires an interactive terminal and asks twice for the root key passphrase (12 bytes or longer). The targets, snapshot and timestamp passphrases are generated (18 random alphanumerics). Output:

| File | Content |
| --- | --- |
| `root.json` | Public self-signed root metadata |
| `root.pem` | Root private key, encrypted with the typed passphrase. The passphrase is not stored |
| `targets.pem`, `snapshot.pem`, `timestamp.pem` | Release-role private keys, encrypted with generated passphrases |
| `release-passphrases.json` | The three generated release-key passphrases |

Storing the release passphrases beside their keys is an accepted trade-off (2026-09-30): anyone who copies the directory can sign release metadata, but still needs write access to the RMS `/tuf/` repository or the HTTPS channel to reach clients, and the root key remains protected by a passphrase that is not stored. A leaked release key is recovered by a root renewal that rotates the release keys (section 5).

Keep the root passphrase in a password manager plus an independent offline copy. Back up the directory offline and exclude `~/.thread-trust` from cloud sync. Losing the root key or its passphrase prevents root renewal and key rotation; clients then fail update checks once the root expires and need a manual reinstall. Do not put any private key, passphrase or signing plan into Git, `.env`, CI or RMS. Node file mode is not a Windows ACL policy: check the destination permissions yourself. `node scripts/generatePassphrase.cjs [length]` prints a random passphrase if one is needed elsewhere.

Validate the public document before using it:

```powershell
node scripts/updateTrustRoot.cjs verify <absolute-path-to-root.json>
```

Record the reported SHA-256 and expiry. Independently compare the SHA-256 of the copy that will go into the app. Copy **only** the public `root.json` to `apps/desktop/public/resources/update-trust/root.json`. The repository generator must receive the same bytes as the app.

## 2. Build and sign the Windows installer

Build the x64 installer. Windows Authenticode signing is optional (decision 2026-09-30 18:06 KST): Thread has never shipped an OS-signed Windows installer, in-app updates carry no Mark of the Web and so trigger no SmartScreen prompt, and only a browser-downloaded first install shows the "unknown publisher" warning. If a certificate is added later, OS-sign the installer before generating the repository. TUF metadata signing and Windows Authenticode signing are separate: one does not substitute for the other. The pack hook now fails if the public root is missing, invalid, expired or differs from `build/resources/update-trust/root.json`. This prevents another rootless installer, but does not itself prove Authenticode status.

## 3. Generate and preflight a public TUF repository

Create a JSON plan outside Git. Fields:

| Field | Content |
| --- | --- |
| `root` | Current public `root.json` path |
| `keys.targets`, `keys.snapshot`, `keys.timestamp` | Encrypted release-key PEM paths |
| `passphrases` | Optional `release-passphrases.json` path. Without it the CLI prompts for each passphrase |
| `output` | New absolute directory |
| `version` | Metadata version, increasing on every generation |
| `expires.targets`, `expires.snapshot`, `expires.timestamp` | Optional future UTC ISO timestamps. Default: one year for each |
| `releases` | Signed installer file path, platform `win`, architecture `x64`, version and mandatory flag |
| `bootstrap` / `previous` | `true` for the first repository / the last published repository afterwards |

The tool requires timestamp expiry no later than snapshot, snapshot no later than targets, and targets no later than root. A beta release cannot be mandatory. Never include the root private key in this plan. Plaintext PEM files are rejected. From `apps/desktop` run:

```powershell
node scripts/updateRepository.cjs <absolute-plan-path>
```

Use the separate read-only preflight against the generated directory and the exact app root:

```powershell
node scripts/verifyUpdateRepository.cjs <absolute-generated-repository> <absolute-app-root.json> --no-authenticode
# with a code-signing certificate:
node scripts/verifyUpdateRepository.cjs <absolute-generated-repository> <absolute-app-root.json> --authenticode <signing-certificate-SHA1-thumbprint>
```

Preflight checks that every root version from `1.root.json` chains to the latest `root.json` and that the app root is one of them; self-signature, expiry and role separation; timestamp/snapshot/targets signatures; signed catalog; every listed installer hash and size; and the `READY` marker. On Windows, `--authenticode` also requires every Windows installer to carry a valid embedded, timestamped Authenticode signature from the given certificate thumbprint. For a repository with Windows installers the CLI requires an explicit choice: `--authenticode <thumbprint>` or `--no-authenticode`. It does **not** verify server TLS, database backups or actual installation. Check those separately before approval. The public repository must contain only metadata and targets, never keys or plans.

## 4. Publish and verify only after separate approval

Publish the verified public `metadata/` and `targets/` directories to the HTTPS RMS `/tuf/` repository. Compose mounts the `rms-tuf` volume read-only into RMS, so publication is a separate operator action. Then compare every served file with the preflighted local repository:

```powershell
node scripts/verifyPublishedRepository.cjs https://rms.threadapp.kr/tuf <absolute-generated-repository>
```

The check is read-only, requires HTTPS for non-local hosts, refuses redirects and reports the first missing or different file. Verify a real Windows installation as well before considering #64 complete. Existing rootless beta.2 installations need a one-time manual install of the trusted-root build; server publication alone cannot give them a trusted initial root.

For later releases, supply the last published public repository as `previous`, omit `bootstrap`, increment metadata `version`, and use a fresh output directory. `releases: []` renews metadata expiry without a new release. Keep the previous repository. Renew metadata before expiry; never replace an existing version path in place.

## 5. Renew the root or rotate keys

Renew the root before it expires, or when a key must be replaced. From the repository root:

```powershell
pnpm cert:desktop:renew <current-trust-directory> [<future-UTC-ISO-expiry>] [--rotate-release-keys] [--rotate-root-key]
```

It asks for the current root passphrase and writes root version N+1 into a new `~/.thread-trust/trust-YYMMDD-HHMM` directory. Without options the keys and `release-passphrases.json` are copied. `--rotate-release-keys` generates new release keys and passphrases (for a leaked or lost release key; the current release keys are then not needed). `--rotate-root-key` asks for a new root passphrase and signs the new root with both the old and new root keys. The current root may already be expired: installed clients still follow a root signed by the key they trust and resume updates once it is published.

Then generate the next repository with the new `root.json`, the new directory's release keys and the last published repository as `previous`. The generator accepts only root version N+1 signed by the previous root and carries every earlier `N.root.json` forward, so clients on any older root walk the chain. Publish it as in section 4, and copy the new `root.json` into `apps/desktop/public/resources/update-trust/` for later builds. Keep the previous trust directory until the new repository is published and verified.
