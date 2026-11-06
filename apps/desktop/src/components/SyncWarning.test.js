import { render, screen } from "@testing-library/react";
import SyncWarning from "./SyncWarning";

test.each([null, { connected: true, pending: 0, seq: "1" }, { connected: false, pending: 2, seq: "1" }])(
  "does not show routine sync telemetry: %j", (status) => {
    const { container } = render(<SyncWarning status={status} />);
    expect(container).toBeEmptyDOMElement();
  }
);

test("keeps error details and recovery warnings", () => {
  render(<SyncWarning status={{ error: "SYNC_UNAVAILABLE", detail: "SOURCE_REVIEW", recovery: [{}] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("동기화를 보류했습니다. · SYNC_UNAVAILABLE");
  expect(screen.getByRole("status")).toHaveTextContent("SOURCE_REVIEW");
  expect(screen.getByRole("status")).toHaveTextContent("복구 검토 1개");
});

test("keeps errors without routine telemetry", () => {
  render(<SyncWarning status={{ error: "NETWORK_ERROR", pending: 2, seq: "1" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("NETWORK_ERROR");
  expect(screen.getByRole("status")).not.toHaveTextContent("cursor");
});

test("keeps recovery warnings even without an error code", () => {
  render(<SyncWarning status={{ recovery: [{}] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("복구 검토가 필요합니다.");
});
