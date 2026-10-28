import { CONTACT } from "./Privacy";

const SUBJECT = "Thread 계정 삭제 요청";

function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

// Account deletion (#92): the address given to Google Play. People with the app delete in
// it; people without it ask by email.
export default function DeleteAccount() {
  return (
    <main className="policy container">
      <h1>계정 삭제</h1>
      <p className="muted">Thread 계정과 데이터를 지우는 방법이에요.</p>
      <p className="lead">
        계정을 삭제하면 서버에 있는 <b>계정, 암호화된 할 일 데이터, 연결된 기기와 로그인 정보</b>가 모두 지워져요.
        삭제한 뒤에는 되돌릴 수 없고, 운영자도 데이터를 되살릴 수 없어요.
      </p>

      <h2>앱에서 삭제하기</h2>
      <p>
        로그인한 앱이 있다면 바로 지울 수 있어요. 할 일을 남겨 두려면 먼저 PC 앱의 <b>설정 → 데이터 → 데이터 백업</b>으로
        내보내세요.
      </p>
      <div className="steps">
        <section className="steps__card">
          <h3>
            <Icon><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon>
            PC 앱
          </h3>
          <ol>
            <li>왼쪽 아래 이름 옆의 <b>설정</b>(톱니바퀴)을 열어요.</li>
            <li><b>계정</b> 탭 맨 아래의 <b>계정 삭제</b>를 눌러요.</li>
            <li>지워지는 내용을 확인하고 "이해했어요"에 체크해요.</li>
            <li>Windows Hello(없으면 보관함 비밀번호)로 본인 확인을 하면 바로 삭제돼요.</li>
          </ol>
        </section>
        <section className="steps__card">
          <h3>
            <Icon><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18h2" /></Icon>
            휴대폰 앱
          </h3>
          <ol>
            <li>아래쪽 <b>설정</b> 탭을 열어요.</li>
            <li><b>계정</b> 묶음의 <b>계정 삭제</b>를 눌러요.</li>
            <li>지워지는 내용을 확인하고 "이해했어요"에 체크해요.</li>
            <li>지문·PIN으로 본인 확인을 하면 바로 삭제돼요.</li>
          </ol>
        </section>
      </div>

      <h2>앱이 없을 때: 이메일로 요청하기</h2>
      <p>
        앱을 지웠거나 기기를 잃어버려 앱에서 지울 수 없다면 이메일로 요청해 주세요. 확인한 뒤 지체 없이 삭제하고 결과를 메일로
        알려 드려요.
      </p>
      <div className="mail">
        <dl>
          <dt>받는 사람</dt><dd><code>{CONTACT}</code></dd>
          <dt>제목</dt><dd>{SUBJECT}</dd>
          <dt>적을 내용</dt>
          <dd>
            가입한 <b>아이디</b> 또는 <b>Google 이메일</b>. Google 계정이라면 그 Google 이메일로 보내 주시면 확인이
            빨라요.
          </dd>
        </dl>
        <div className="mail__actions">
          <a className="button button--primary" href={`mailto:${CONTACT}?subject=${encodeURIComponent(SUBJECT)}`}>메일 쓰기</a>
          <span>비밀번호나 복구 코드는 절대 보내지 마세요.</span>
        </div>
      </div>

      <h2>삭제되는 것과 시기</h2>
      <table className="when">
        <thead><tr><th>항목</th><th>삭제 시기</th></tr></thead>
        <tbody>
          <tr><td>계정 정보(아이디, 사용자 이름, 비밀번호 해시, Google 연결 정보)</td><td className="now">삭제하는 즉시</td></tr>
          <tr><td>암호화된 할 일 데이터, 복구용 정보</td><td className="now">삭제하는 즉시</td></tr>
          <tr><td>연결된 기기, 기기 공개키, 로그인 세션</td><td className="now">삭제하는 즉시</td></tr>
          <tr><td>장애 복구용 데이터베이스 백업에 남은 사본</td><td>30일 안에 사라져요</td></tr>
        </tbody>
      </table>
      <p>
        다른 기기는 다음에 앱을 열 때 로그아웃돼요. 개인정보 처리에 관한 자세한 내용은{" "}
        <a href="/privacy">개인정보처리방침</a>을 보세요.
      </p>
    </main>
  );
}
