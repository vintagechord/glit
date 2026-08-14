export const CENTERED_DIALOG_REQUEST_EVENT =
  "onside:centered-dialog-request";

export type CenteredDialogKind = "alert" | "confirm";

export type CenteredDialogRequest = {
  id: string;
  kind: CenteredDialogKind;
  message: string;
  title?: string;
  resolve: (confirmed: boolean) => void;
};

let fallbackSequence = 0;

const createRequestId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  fallbackSequence += 1;
  return `dialog-${Date.now()}-${fallbackSequence}`;
};

const requestCenteredDialog = (
  kind: CenteredDialogKind,
  message: unknown,
  title?: string,
) => {
  const normalizedMessage = String(message ?? "");
  if (typeof window === "undefined") {
    return Promise.resolve(kind === "alert");
  }

  const isHostReady =
    document.documentElement.dataset.centeredDialogReady === "true";
  if (!isHostReady) {
    if (kind === "confirm") {
      return Promise.resolve(window.confirm(normalizedMessage));
    }
    window.alert(normalizedMessage);
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const detail: CenteredDialogRequest = {
      id: createRequestId(),
      kind,
      message: normalizedMessage,
      title,
      resolve,
    };
    window.dispatchEvent(
      new CustomEvent<CenteredDialogRequest>(CENTERED_DIALOG_REQUEST_EVENT, {
        detail,
      }),
    );
  });
};

export const showCenteredAlert = async (
  message: unknown,
  options?: { title?: string },
) => {
  await requestCenteredDialog("alert", message, options?.title);
};

export const showCenteredConfirm = (
  message: unknown,
  options?: { title?: string },
) => requestCenteredDialog("confirm", message, options?.title);
