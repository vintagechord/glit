import {
  openInicisCardPopup,
  type InicisPopupContext,
} from "@/lib/inicis/popup";
import { openMobiliansCardPopup } from "@/lib/mobilians/popup";
import { getClientCardPaymentProvider } from "./provider";

type OpenCardPaymentPopupOptions = {
  context: InicisPopupContext;
  submissionId?: string;
  guestToken?: string;
  orderId?: string;
  requestId?: string;
  popupName?: string;
  preferRedirectOnMobile?: boolean;
};

export const openCardPaymentPopup = (options: OpenCardPaymentPopupOptions) => {
  const provider = getClientCardPaymentProvider();
  if (provider === "inicis") {
    return openInicisCardPopup(options);
  }
  return openMobiliansCardPopup(options);
};

