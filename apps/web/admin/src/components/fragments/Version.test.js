import axios from "axios";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
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

test("mandatory policy is independent but only allowed for verified non-beta releases", async () => {
  axios.get.mockResolvedValue({data:{code:313}});
  axios.put.mockResolvedValue({data:{code:200}});
  const ref=createRef();
  const {container}=render(<Version ref={ref}/>);
  await act(async()=>ref.current.setState({create_new_draft:true,new_version_input:"2.0.0"}));
  const [beta,verified,mandatory]=container.querySelectorAll(".release-option input");
  expect(mandatory).toBeDisabled();
  fireEvent.click(verified);
  expect(mandatory).not.toBeDisabled();
  fireEvent.click(mandatory);
  expect(mandatory).toBeChecked();
  fireEvent.click(beta);
  expect(verified).toBeChecked();
  expect(mandatory).not.toBeChecked();
  expect(mandatory).toBeDisabled();
  fireEvent.click(beta);
  fireEvent.click(mandatory);
  await act(async()=>ref.current.releaseNewVersion());
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/version"),expect.objectContaining({
    version:"2.0.0",beta:false,verified:true,not_compatible:true,
  }));
});
