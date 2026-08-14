import { timingSafeEqual } from "node:crypto";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const getStoredInicisCallbackState = (rawResponse: unknown) => {
  if (!isRecord(rawResponse)) return null;
  const value = rawResponse.closeState;
  return typeof value === "string" ? value : null;
};

export const verifyInicisCallbackState = ({
  storedState,
  receivedState,
}: {
  storedState: string | null | undefined;
  receivedState: string | null | undefined;
}) => {
  if (
    typeof storedState !== "string" ||
    typeof receivedState !== "string" ||
    storedState.length < 32 ||
    storedState.length > 200 ||
    receivedState.length !== storedState.length
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(storedState, "utf8"),
    Buffer.from(receivedState, "utf8"),
  );
};
