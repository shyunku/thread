# Memorial

Memorial is a task and schedule manager with native desktop and mobile clients, cloud synchronization, release management, and administration services. This repository combines the former component repositories into one monorepo while retaining their Git histories.

## Repository layout

| Path | Purpose | Docker Compose |
| --- | --- | --- |
| `memorial/` | Electron and React desktop client | No |
| `memorial_mobile/` | React Native mobile client | No |
| `memorial_app_server/` | Go and Gin authentication/synchronization server | Yes |
| `memorial_rms/` | Node.js release management server | Yes |
| `memorial_admin_site/` | React administration site | Yes |
| `memorial_site/` | React public site | Yes |

The obsolete `memorial_test` prototype was intentionally removed during the monorepo migration.

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

Stop the stack with:

```powershell
docker compose down
```

To also remove local database, Redis, and release volumes:

```powershell
docker compose down --volumes
```

## Native clients

The desktop app uses npm:

```powershell
Set-Location memorial
npm install
npm run win-all
```

The mobile app retains its existing React Native scripts:

```powershell
Set-Location memorial_mobile
npm install
npm run android
```

## Imported history

The monorepo `master` branch contains subtree merge commits for every former repository. Additional historical branches and tags are namespaced under `legacy/<repository>/...`.

```powershell
git branch --list "legacy/*"
git tag --list "legacy/*"
git log --all --graph --oneline
```

Project definition and work history are maintained in `docs/project.md` and `docs/tasks.md`.
