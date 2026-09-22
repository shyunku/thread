# Desktop execution

- When an agent launches the desktop app, use secure logging: `pnpm dev:desktop:secure` from the repository root on Windows, or add `--secure-logs` to the Electron/app invocation.
- Normal logging intentionally retains detailed diagnostics for the user. Do not inspect existing personal logs, databases or secret environment files without authorization.
- Synthetic tests may inspect only their own fixture logs. Use `--secure-logs` for Electron smoke tests as well.
