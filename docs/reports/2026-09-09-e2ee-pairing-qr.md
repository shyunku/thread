# Pairing request QR

기록: 2026-09-09 23:24 (KST).

개발 보관함의 QR·파일로 기기 연결에 요청 QR 표시와 연결 QR 이미지 열기를 추가했다. QR은 기존 서명된 공개 요청과 동일하며 비밀키/복구 코드/키 전달 암호문은 포함하지 않는다. 승인 이후 키 전달은 기존 .thread-key-transfer 파일 경로를 유지한다.

main의 requestQR은 파일 경로와 같은 durable 요청을 재사용한다. previewQR은 길이/접두사/canonical base64url/서명/만료를 다시 검사하고 기존 승인 preview로 연결한다. 이미지에서 읽은 문자열만 신뢰해 자동 승인하지 않는다.

이미지는 renderer에서만 판독하며 서버로 업로드하지 않는다. PNG/JPEG/WebP, 파일 5 MiB, decoded dimension 8192 이하, 판독 canvas 최대 변 2048로 제한한다. 관련 없는 QR은 거부하며 bitmap은 성공/실패 모두 close한다. QR 생성 완료가 늦게 도착해도 만료/화면 제거 뒤 표시하지 않는다.

검증: Node 관련 9개, React 7개, 새 파일 lint, renderer production build 통과(기존 경고). 실제 QR module을 RGBA 픽셀로 렌더링한 뒤 jsQR로 읽어 원본 서명 요청과 일치함을 확인했다. 만료·늦은 렌더링, 잘못된 이미지 형식/크기, bitmap 정리도 검사했다. 주 JS gzip 크기는 약 55.75 KiB 증가했다.

라이브러리는 [qrcode 공식 사용법](https://github.com/soldair/node-qrcode)과 [jsQR 공식 사용법](https://github.com/cozmo/jsQR)에 따라 qrcode 1.5.4/jsqr 1.4.0으로 고정하고 pnpm lockfile을 갱신했다. 설치 scripts는 실행하지 않았다.

실시간 카메라/추가 카메라 권한은 구현하지 않았으며 이번 경로는 저장된 QR 이미지 입력이다. 모바일 UI·실제 두 기기 연결·일반 암호화 sync 연결은 미완료다. 사용자 이미지/키/운영 서버는 테스트에 사용하지 않았다. #50 WIP 유지.
