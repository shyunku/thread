import { useState } from "react";
import "./ReleaseLink.scss";

export const getReleaseLink = (baseUrl, version, category) =>
  `${baseUrl.replace(/\/+$/, "")}/default/release?${new URLSearchParams({
    version,
    category,
  })}`;

export default function ReleaseLink({ version, category }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const link = getReleaseLink(process.env.REACT_APP_RMS_ENTRY || "", version, category);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice("링크가 복사되었습니다.");
      setOpen(false);
    } catch {
      setNotice("링크를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해주세요.");
    }
  };

  return (
    <div
      className="release-link"
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.currentTarget.querySelector("button").focus();
        }
      }}
    >
      <button type="button" className={`tag clickable ${category}`}
        aria-expanded={open} aria-label={`${category} 다운로드 옵션`}
        onClick={() => { setNotice(""); setOpen(!open); }}>
        {category}
      </button>
      {open && (
        <div className="release-link-menu">
          <a href={link} onClick={() => setOpen(false)}>다운로드</a>
          <button type="button" onClick={copyLink}>링크 복사</button>
        </div>
      )}
      {notice && <span className="release-link-notice" role="status">{notice}</span>}
    </div>
  );
}
