// User-facing text for error codes (same wording style as the desktop).
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: '아이디 또는 비밀번호가 맞지 않아요.',
  INVALID_CREDENTIALS_OR_LINK_EXPIRED:
    '아이디·비밀번호가 맞지 않거나 Google 확인이 만료됐어요. 다시 시도해주세요.',
  ID_TAKEN: '이미 사용 중인 아이디예요.',
  GOOGLE_ALREADY_LINKED: '이 Google 계정은 이미 다른 계정에 연결돼 있어요.',
  GOOGLE_CANCELLED: 'Google 로그인을 취소했어요.',
  GOOGLE_NOT_CONFIGURED: 'Google 로그인이 아직 설정되지 않았어요.',
  GOOGLE_TOKEN_REJECTED: 'Google 확인에 실패했어요. 다시 시도해주세요.',
  PLAY_SERVICES_UNAVAILABLE: 'Google Play 서비스를 사용할 수 없어요.',
  NETWORK_UNAVAILABLE: '서버에 연결할 수 없어요. 인터넷 연결을 확인해주세요.',
  NETWORK_TIMEOUT: '서버 응답이 늦어요. 잠시 후 다시 시도해주세요.',
  SYNC_UNAVAILABLE: '서버에 연결할 수 없어요. 인터넷 연결을 확인해주세요.',
  AUTH_REQUIRED: '로그인이 만료됐어요. 다시 로그인해주세요.',
  AUTH_FAILED_OR_CANCELLED: '확인을 취소했거나 실패했어요.',
  AUTH_CANCELLED: '확인을 취소했어요.',
  INVALID_VAULT_PASSWORD: '비밀번호는 12자 이상이어야 해요.',
  INVALID_PASSWORD_OR_DAMAGED_KEY: '비밀번호가 맞지 않아요.',
  PASSWORD_NOT_SET: '비밀번호를 설정하지 않았어요.',
  RECOVERY_CODE_CHECKSUM: '복구 코드를 다시 확인해주세요.',
  RECOVERY_CONTENT_MISMATCH: '이 복구 파일은 지금 계정의 것이 아니에요.',
  INVALID_RECOVERY_FILE: '복구 파일(.trec)을 열 수 없어요.',
  PAIRING_SCOPE_MISMATCH:
    '다른 계정의 연결 요청이에요. 같은 계정으로 로그인했는지 확인해주세요.',
  PAIRING_MISMATCH: '연결 정보가 바뀌었어요. 처음부터 다시 시도해주세요.',
  PAIRING_AUTHORITY_REQUIRED:
    '이 기기에서는 새 기기를 승인할 수 없어요. 처음 만든 기기에서 승인해주세요.',
  VAULT_BUSY: '다른 작업이 진행 중이에요. 잠시 후 다시 시도해주세요.',
  UPDATE_REQUIRED: '앱을 최신 버전으로 업데이트해주세요.',
  DEVICE_FORBIDDEN: '이 기기는 더 이상 연결돼 있지 않아요.',
};

export function messageFor(error: unknown): string {
  const code = (error as any)?.code ?? (error as any)?.message ?? String(error);
  return MESSAGES[code] ?? `문제가 생겼어요 (${code}).`;
}
