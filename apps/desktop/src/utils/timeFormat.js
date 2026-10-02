import { useSelector } from "react-redux";
import { prefsSelector } from "store/prefsSlice";

// Converts a 12-hour moment pattern ("a h:mm", "A h시") to 24-hour when requested.
export function withTimeFormat(pattern, timeFormat) {
  if (timeFormat !== "24") return pattern;
  return pattern.replace(/[aA] h:/g, "HH:").replace(/[aA] h/g, "H");
}

// 설정 > 일반 > 시간 표시 ("12" | "24").
export function useTimeFormat() {
  return useSelector(prefsSelector).timeFormat === "24" ? "24" : "12";
}
