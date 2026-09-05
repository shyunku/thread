import axios from "axios";
import { render, screen } from "@testing-library/react";
import Version from "./Version";

jest.mock("axios");
jest.mock("static/js/util", () => ({
  fastInterval: jest.fn(),
}));

test("Windows latest card renders the version and timestamp inside response data", async () => {
  const release = { version: "1.0.4", updated_timestamp: 1788600000000 };
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("category=win")
      ? { code: 200, data: release }
      : { code: 313 },
  }));
  render(<Version />);
  await screen.findByText("1.0.4");
  const card = screen.getByText("Latest Windows Version").parentElement;
  expect(card.textContent).toContain("1.0.4");
  expect(card.textContent).not.toContain("Invalid date");
  expect(card.textContent).not.toContain("?");
});
