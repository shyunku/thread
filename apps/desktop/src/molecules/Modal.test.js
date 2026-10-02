import { act, fireEvent, render } from "@testing-library/react";
import Modal, { Modaler, openModal } from "./Modal";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const setup = (onCancel) => {
  const closed = jest.fn();
  const utils = render(
    <Modaler>
      <Modal id="FIXTURE" onClose={() => "closed"} onCancel={onCancel}>body</Modal>
    </Modaler>
  );
  act(() => openModal("FIXTURE", closed));
  return { ...utils, closed, modal: utils.container.querySelector("#modal-FIXTURE") };
};

test("closing plays an exit animation before the modal is hidden", async () => {
  const { modal, closed } = setup();
  expect(modal).toHaveClass("active");
  await act(async () => { fireEvent.click(modal.querySelector(".close-button")); });
  expect(closed).toHaveBeenCalledWith("closed");
  expect(modal).toHaveClass("active", "closing");
  act(() => jest.advanceTimersByTime(200));
  expect(modal).not.toHaveClass("active");
  expect(modal).not.toHaveClass("closing");
});

test("a cancellable modal closes on backdrop click and Escape", async () => {
  const { modal, closed } = setup(() => "cancelled");
  await act(async () => { fireEvent.click(modal.querySelector(".modal-back-panel")); });
  expect(closed).toHaveBeenCalledWith("cancelled");
  act(() => jest.advanceTimersByTime(200));
  act(() => openModal("FIXTURE", closed));
  await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
  expect(closed).toHaveBeenCalledTimes(2);
});

test("onCancel returning false keeps the modal open", async () => {
  const { modal, closed } = setup(() => false);
  await act(async () => { fireEvent.click(modal.querySelector(".modal-back-panel")); });
  await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
  expect(closed).not.toHaveBeenCalled();
  expect(modal).toHaveClass("active");
  expect(modal).not.toHaveClass("closing");
});

test("a modal without onCancel ignores Escape", async () => {
  const { modal, closed } = setup();
  await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
  expect(closed).not.toHaveBeenCalled();
  expect(modal).toHaveClass("active");
});
