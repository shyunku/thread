import appScreenshot from "../assets/app-main.png";
import { formatSize, useLatestRelease } from "../release";

const FEATURES = [
  {
    title: "리스트·캘린더·타임라인",
    body: "같은 할 일을 목록, 달력, 시간 흐름으로 바꿔 보며 오늘 할 일과 이번 달 일정을 한눈에 확인해요.",
    icon: <path d="M4 5h16M4 12h16M4 19h10" />,
  },
  {
    title: "카테고리·하위 할 일·반복",
    body: "업무와 생활을 카테고리로 나누고, 큰 일은 하위 할 일로 쪼개고, 매일 하는 일은 반복으로 등록해요.",
    icon: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12l3 3 5-6" /></>,
  },
  {
    title: "여러 기기에서 같은 데이터",
    body: "이미 쓰고 있는 기기에서 새 기기를 승인하면, 암호화된 데이터가 기기 사이에 동기화돼요.",
    icon: <><rect x="3" y="5" width="13" height="10" rx="2" /><rect x="15" y="9" width="6" height="10" rx="1.5" /></>,
  },
  {
    title: "빠른 검색",
    body: "Ctrl K로 할 일, 메모, 카테고리를 바로 찾아요.",
    icon: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  },
];

const SECURITY = [
  {
    title: "기기에서 암호화한 뒤 보내요",
    body: "할 일 제목, 메모, 날짜 같은 내용은 기기에서 암호화된 다음 서버로 전송돼요. 서버에는 암호문만 저장되고, 운영자도 내용을 읽을 수 없어요.",
  },
  {
    title: "새 기기는 기존 기기가 승인해요",
    body: "로그인만으로는 데이터를 열 수 없어요. 이미 쓰고 있는 기기에서 QR 코드나 연결 파일로 승인해야 새 기기가 데이터를 풀 수 있어요.",
  },
  {
    title: "복구 코드는 꼭 보관하세요",
    body: "모든 기기를 잃어버렸을 때 데이터를 되살리는 방법은 처음 설정할 때 만든 복구 코드와 복구 파일뿐이에요. 운영자는 이 코드를 갖고 있지 않아서 대신 복구해 드릴 수 없어요.",
  },
  {
    title: "서명된 업데이트만 설치해요",
    body: "앱 안에서 받는 업데이트는 서버에 두지 않는 키로 서명돼 있고, 앱이 서명을 확인한 파일만 설치해요.",
  },
];

function Icon({ children }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

function DownloadButton({ state, large }) {
  const { status, release } = state;
  if (status !== "ready") {
    return (
      <span className={`button button--primary${large ? " button--large" : ""}`} aria-disabled="true">
        {status === "loading" ? "최신 버전 확인 중…" : "Windows용 다운로드"}
      </span>
    );
  }
  return (
    <a className={`button button--primary${large ? " button--large" : ""}`} href={release.url}>
      Windows용 다운로드 <span className="button__meta">v{release.version}</span>
    </a>
  );
}

export default function Landing() {
  const latest = useLatestRelease();
  const { status, release } = latest;
  return (
    <main>
      <section className="hero">
        <div className="container hero__inner">
          <h1>할 일과 일정을 한 곳에서,<br />나만 볼 수 있게.</h1>
          <p className="hero__lead">
            Thread는 할 일과 일정을 관리하는 데스크톱 앱이에요. 내용은 기기에서 암호화된 뒤 동기화돼서 서버도 읽을 수 없어요.
          </p>
          <div className="hero__actions">
            <DownloadButton state={latest} large />
            <a className="button button--ghost button--large" href="#security">보안 방식 보기</a>
          </div>
          <p className="hero__note">Windows 10·11 (64비트) · 무료 · macOS와 모바일은 준비 중이에요</p>
        </div>
        <div className="container">
          <figure className="screenshot">
            <img src={appScreenshot} width="1440" height="900" alt="Thread 메인 화면: 왼쪽 카테고리, 가운데 할 일 목록, 오른쪽 월간 캘린더" />
          </figure>
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <h2>매일 쓰기 편하게</h2>
          <div className="grid grid--4">
            {FEATURES.map((feature) => (
              <article className="card" key={feature.title}>
                <Icon>{feature.icon}</Icon>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt" id="security">
        <div className="container">
          <h2>내 데이터는 나만 열 수 있어요</h2>
          <p className="section__lead">
            서버는 동기화를 위해 암호문을 보관할 뿐, 열쇠는 내 기기에만 있어요.
          </p>
          <div className="grid grid--2">
            {SECURITY.map((item) => (
              <article className="card card--plain" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <p className="fineprint">
            서버는 동기화에 필요한 정보(계정, 데이터 개수와 크기, 동기화 순서 등)는 볼 수 있어요. 2.0 이전 버전(1.x)에서 동기화한 데이터는 암호화 전 형태로 서버에 남아 있으며,
            요청하면 삭제해 드려요. 자세한 내용은 <a href="/privacy">개인정보처리방침</a>에 있어요.
          </p>
        </div>
      </section>

      <section className="section" id="download">
        <div className="container">
          <h2>다운로드</h2>
          <div className="download">
            <div className="download__main">
              <h3>Windows</h3>
              {status === "ready" ? (
                <dl className="download__facts">
                  <div><dt>버전</dt><dd>{release.version}</dd></div>
                  <div><dt>크기</dt><dd>{formatSize(release.size)}</dd></div>
                  <div><dt>지원</dt><dd>Windows 10·11 (64비트)</dd></div>
                  <div className="download__hash"><dt>SHA-256</dt><dd><code>{release.sha256}</code></dd></div>
                </dl>
              ) : (
                <p className="muted" role={status === "error" ? "alert" : undefined}>
                  {status === "loading" ? "최신 버전 정보를 불러오는 중이에요…" : "최신 버전 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."}
                </p>
              )}
              <DownloadButton state={latest} />
              <p className="muted">설치한 뒤에는 앱이 새 버전을 알려 주고, 앱 안에서 바로 업데이트할 수 있어요.</p>
            </div>
            <div className="download__guide">
              <h3>"Windows의 PC 보호" 창이 뜨면</h3>
              <p>Thread는 아직 Windows 코드 서명 인증서를 쓰지 않아서, 브라우저로 받은 설치 파일을 처음 실행할 때 경고가 나와요.</p>
              <ol>
                <li><strong>추가 정보</strong>를 눌러요.</li>
                <li>게시자가 "알 수 없음"으로 표시된 것을 확인하고 <strong>실행</strong>을 눌러요.</li>
              </ol>
              <p className="muted">받은 파일이 맞는지 확인하려면 PowerShell에서 <code>Get-FileHash 파일경로</code>를 실행해 위 SHA-256과 비교해 보세요.</p>
            </div>
          </div>
          <div className="soon">
            <div><strong>macOS</strong><span>준비 중</span></div>
            <div><strong>Android·iOS</strong><span>준비 중</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
