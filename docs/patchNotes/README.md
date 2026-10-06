# Patch notes

What changed in each release, shown in the apps after an update and under Settings (#99).

## Files

One file per platform and version, written after a release is decided and before the release build:

```
docs/patchNotes/
  desktop/win/<version>.json
  desktop/mac/<version>.json
  mobile/android/<version>.json
  mobile/ios/<version>.json
```

```json
{
  "version": "2.0.10",
  "date": "2026-10-20",
  "summary": "앱 실행 최적화 및 동기화 오류 수정",
  "sections": [
    { "kind": "improved", "items": [
      { "title": "앱 실행이 빨라졌어요.", "detail": ["할 일이 많아도 처음 열 때 기다리는 시간이 크게 줄었어요."] }
    ] },
    { "kind": "fixed", "items": [
      { "title": "자잘한 문제를 고쳤어요." }
    ] }
  ]
}
```

- `version` matches the file name. `date` is the release date (KST, `YYYY-MM-DD`).
- `kind` is `new` (새 기능), `improved` (개선) or `fixed` (수정). The apps always show them in that order.
- `detail` is optional. Each entry is one line.

After adding or changing a file, run `node scripts/patchNotes.cjs` and commit the generated files (`apps/desktop/src/generated/patchNotes.json`, `apps/mobile/src/generated/patchNotes.json`). Tests fail when they are out of date. The Windows release build (`pnpm build:desktop`) fails when the current desktop version has no `desktop/win` notes. The apps keep the newest 12 versions.

## Writing rules

- Write only what users notice. No internal mechanisms, numbers or implementation details.
- `summary` ends with a noun phrase, e.g. "캘린더 UI 개선", "앱 실행 최적화 및 버그 수정".
- Each item `title` is one sentence ending in "~요.", e.g. "동기화 오류를 고쳤어요."
- Use `detail` only when it helps, one sentence per line.
