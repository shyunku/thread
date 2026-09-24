# v3 데이터 보호

- [전체 설계](v3-design.md)
- [API 계약](protocol/v3-api.md) · [이관 계약](protocol/v3-migration-prepare.md) · [업데이트 서명 정책](protocol/v3-update-signing-policy.md)
- [출시 전 검증 기록](../../reports/2026-09-23-v3-release-rehearsal.md) · [진행 중 태스크](../../tasks.md)

`protocol/`은 서버·클라이언트가 동일하게 해석해야 하는 메시지 형식, 서명·키 규칙, 이관 상태 전이와 테스트 벡터를 담는다. 계획·진행 기록과 구분하며 JSON 벡터는 코드 테스트에서도 사용한다.
