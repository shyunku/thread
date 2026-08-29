# Thread

Thread is a task and schedule manager with native desktop and mobile clients, cloud synchronization, release management, and administration services. This repository combines the former component repositories into one monorepo while retaining their Git histories.

**Track. Handle. Remember. Execute. And Deliver.**

Website: `https://threadapp.kr`

## Repository layout

| Path              | Purpose                                          | Docker Compose |
| ----------------- | ------------------------------------------------ | -------------- |
| `apps/desktop/`   | Electron and React desktop client                | No             |
| `apps/mobile/`    | React Native mobile client                       | No             |
| `apps/web/site/`  | React public site                                | Yes            |
| `apps/web/admin/` | React administration site                        | Yes            |
| `services/api/`   | Go and Gin authentication/synchronization server | Yes            |
| `services/rms/`   | Node.js release management server                | Yes            |

## Docker Compose quick start

Docker Compose runs MySQL, Redis, the application server, RMS, the public site, and the administration site. Desktop and mobile clients remain native development targets.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Local endpoints:

- Public site: `http://localhost:3000`
- Administration site: `http://localhost:3001`
- Application server: `http://localhost:4033`
- RMS: `http://localhost:4034`

The example credentials are development-only defaults. Replace the database and JWT secrets before using the stack outside a local machine. Google OAuth also requires real client credentials and a matching redirect URL.

The root `.env` belongs exclusively to the Compose stack. Native clients do not read it. Desktop uses an ignored `apps/desktop/.env` for development and the packaged `apps/desktop/.env.production` for production. Create the development file from its template:

```powershell
Copy-Item apps/desktop/.env.example apps/desktop/.env
```

Mobile reads `apps/mobile/.env`, which must be created from its local template.

macOS notarization credentials are private Desktop build settings. Create the ignored local file before packaging for macOS:

```powershell
Copy-Item apps/desktop/.env.local.example apps/desktop/.env.local
```

```powershell
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

When Android Emulator connects to an API running on the Windows host, set `APP_SERVER_ENDPOINT=http://10.0.2.2:4033`. Use `http://localhost:4033` for an iOS simulator, or the host's LAN address for a physical device. Client env files are bundled into applications, so never place server secrets in them.

Stop the stack with:

```powershell
docker compose down
```

To also remove local database, Redis, and release volumes:

```powershell
docker compose down --volumes
```

## Native clients

Each Node.js project has its own pnpm lockfile so installing one application does not run lifecycle scripts from another service. Enable pnpm once, then install only the application you need from the repository root:

```powershell
corepack enable
pnpm install:desktop
```

Run the desktop app on Windows:

```powershell
pnpm dev:desktop
```

Run the Android app with Metro in a separate terminal:

```powershell
pnpm install:mobile
pnpm --dir apps/mobile start
pnpm dev:mobile
```

Run the web clients locally:

```powershell
pnpm install:site
pnpm install:admin
pnpm dev:site
pnpm dev:admin
```

## Imported history

The monorepo `master` branch contains subtree merge commits for every former repository. Additional historical branches and tags are namespaced under `legacy/<repository>/...`.

```powershell
git branch --list "legacy/*"
git tag --list "legacy/*"
git log --all --graph --oneline
```

Project definition and work history are maintained in `docs/project.md` and `docs/tasks.md`.
