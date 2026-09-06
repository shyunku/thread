import { render, screen } from "@testing-library/react";
import TopBanner from "./TopBanner";

test("shows Thread branding and uses the public logo under PUBLIC_URL", () => {
  const original = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = "/console";
  try {
    const { container } = render(<TopBanner />);
    expect(screen.getByText("Thread")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    const logo = container.querySelector(".logo img");
    expect(logo).toHaveAttribute("src", "/console/logo192.png");
    expect(logo).toHaveAttribute("width", "28");
    expect(logo).toHaveAttribute("alt", "");
    expect(container).not.toHaveTextContent("memorial");
  } finally {
    if (original === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = original;
  }
});
