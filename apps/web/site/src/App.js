import { useEffect } from "react";
import logo from "./assets/logo.png";
import Landing from "./pages/Landing";
import Privacy, { CONTACT } from "./pages/Privacy";

const PAGES = {
  "/": { title: "Thread — 나만 볼 수 있는 할 일·일정 관리", Page: Landing },
  "/privacy": { title: "개인정보처리방침 — Thread", Page: Privacy },
};

function NotFound() {
  return (
    <main className="policy container">
      <h1>페이지를 찾을 수 없어요</h1>
      <p><a href="/">처음으로 돌아가기</a></p>
    </main>
  );
}

export default function App({ path = window.location.pathname }) {
  const normalized = path.replace(/\/+$/, "") || "/";
  const page = PAGES[normalized];
  useEffect(() => {
    document.title = page?.title || "Thread";
  }, [page]);
  const Page = page?.Page || NotFound;
  const onLanding = normalized === "/";
  return (
    <div className="site">
      <header className="nav">
        <div className="container nav__inner">
          <a className="nav__brand" href="/">
            <img src={logo} width="28" height="28" alt="" />
            <span>Thread</span>
          </a>
          <nav aria-label="주요 메뉴" className="nav__links">
            <a href={onLanding ? "#features" : "/#features"}>기능</a>
            <a href={onLanding ? "#security" : "/#security"}>보안</a>
            <a className="nav__cta" href={onLanding ? "#download" : "/#download"}>다운로드</a>
          </nav>
        </div>
      </header>
      <Page />
      <footer className="footer">
        <div className="container footer__inner">
          <span>© Thread</span>
          <a href="/privacy">개인정보처리방침</a>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </div>
      </footer>
    </div>
  );
}
