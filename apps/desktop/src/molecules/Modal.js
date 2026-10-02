import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import "./Modal.scss";
import { sendEvent, uuidv4 } from "../utils/Common";
import { IoClose } from "react-icons/io5";

const Modal = forwardRef(
  ({ children, id, active, onClose, onCancel, className, ...rest }, ref) => {
    const modalRef = useRef(null);
    const closeHandler = async () => {
      const modalElem = modalRef.current;
      if (!modalElem) return;
      const modalUuid = modalElem.getAttribute("data-uuid");
      if (!modalUuid) return;
      const modalCloseTopic = `modal_close_signal_${modalUuid}`;
      let data = await onClose?.();
      sendEvent(modalCloseTopic, data);
    };

    const cancelHandler = async () => {
      const modalElem = modalRef.current;
      if (!modalElem) return;
      if (!onCancel) return;
      const modalUuid = modalElem.getAttribute("data-uuid");
      if (!modalUuid) return;
      const modalCloseTopic = `modal_close_signal_${modalUuid}`;
      let data = await onCancel?.();
      // onCancel can return false to keep the modal open (e.g. a child dialog is showing).
      if (data === false) return;
      sendEvent(modalCloseTopic, data);
    };

    // Cancellable modals also close on Escape, but only the top-most open one and only
    // when nothing above it (a prompt or a child dialog that stopped the event) handled it.
    useEffect(() => {
      if (!onCancel) return;
      const onKey = (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const modalElem = modalRef.current;
        if (!modalElem?.classList.contains("active") || modalElem.classList.contains("closing")) return;
        if (document.querySelector(".custom-prompt-wrapper.visible")) return;
        const open = [...document.querySelectorAll(".modal.active:not(.closing)")];
        const top = open.reduce((a, b) => (Number(b.style.zIndex) > Number(a.style.zIndex) ? b : a), open[0]);
        if (top !== modalElem) return;
        void cancelHandler();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    });

    useImperativeHandle(ref, () => ({
      close: closeHandler,
      cancel: cancelHandler,
    }));

    return (
      <div className={"modal" + (active ? " active" : "")} id={`modal-${id}`} ref={modalRef} {...rest}>
        <div className={"modal-back-panel"} onClick={cancelHandler}></div>
        <div className={"modal-content " + className}>
          <>
            <div className={"close-button"} onClick={closeHandler}>
              <IoClose />
            </div>
            {children}
          </>
        </div>
      </div>
    );
  }
);

const MODAL_CLOSE_MS = 160;

export const Modaler = ({ children }) => {
  const [activeModals, setActiveModals] = useState({});
  const [closeListeners, setCloseListeners] = useState({});

  useEffect(() => {
    const openListener = (e) => {
      const modalData = e.data;
      const { modalId, uuid, modalCloseTopic } = modalData;
      const realModalId = `modal-${modalId}`;
      // check if modal is already opened
      if (activeModals[modalId]) {
        console.log(`Modal with id ${modalId} is already opened.`);
        return;
      }

      const targetModalElement = document.querySelector(
        `.modal#${realModalId}`
      );
      if (!targetModalElement) {
        console.error(`Modal with id ${modalId} not found.`);
        return;
      }
      clearTimeout(targetModalElement.closeTimer);
      targetModalElement.classList.remove("closing");
      targetModalElement.classList.add("active");
      targetModalElement.setAttribute("data-uuid", uuid);
      targetModalElement.setAttribute("data-close-topic", modalCloseTopic);
      targetModalElement.style.zIndex = 102 + Object.keys(activeModals).length;
      setActiveModals((prev) => {
        return { ...prev, [modalId]: uuid };
      });

      const closeSignalId = `modal_close_signal_${uuid}`;
      const closeListener = (e2) => {
        if (!targetModalElement) {
          console.error(`Modal with id ${modalId} not found.`);
          return;
        }
        // Play the closing animation before hiding the modal.
        targetModalElement.classList.add("closing");
        clearTimeout(targetModalElement.closeTimer);
        targetModalElement.closeTimer = setTimeout(() => {
          targetModalElement.classList.remove("active", "closing");
        }, MODAL_CLOSE_MS);
        targetModalElement.removeAttribute("data-uuid");
        targetModalElement.removeAttribute("data-close-topic");
        setActiveModals((prev) => {
          const { [modalId]: removed, ...rest } = prev;
          return rest;
        });
        document.removeEventListener(closeSignalId, closeListener);
        setCloseListeners((prev) => {
          const { [modalId]: removed, ...rest } = prev;
          return rest;
        });
        // send closed
        const modalCloseTopic = `modal_close_${uuid}`;
        sendEvent(modalCloseTopic, e2.data);
      };
      document.addEventListener(closeSignalId, closeListener);
      setCloseListeners((prev) => {
        return { ...prev, [modalId]: closeListener };
      });
    };
    document.addEventListener("open_modal", openListener);
    return () => {
      document.removeEventListener("open_modal", openListener);
      Object.keys(closeListeners).forEach((modalId) => {
        const closeListener = closeListeners[modalId];
        document.removeEventListener(
          `modal_close_signal_${modalId}`,
          closeListener
        );
      });
    };
  }, [activeModals]);

  return <div className={"modal-container"}>{children}</div>;
};

export const openModal = (modalId, closeHandler = null) => {
  const modalUuid = uuidv4();
  const modalCloseTopic = `modal_close_${modalUuid}`;
  sendEvent("open_modal", {
    modalId,
    uuid: modalUuid,
    modalCloseTopic,
  });
  const onModalClose = (e) => {
    const retData = e.data;
    closeHandler?.(retData);
    document.removeEventListener(modalCloseTopic, onModalClose);
  };
  document.addEventListener(modalCloseTopic, onModalClose);
};

export default Modal;
