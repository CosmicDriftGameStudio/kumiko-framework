import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import {
  CHECKOUT_CONSENT_RECORDED_EVENT_SHORT,
  checkoutConsentRecordedPayloadSchema,
} from "../events.js";

export function registerConsumerProtection(r: FeatureRegistrar): void {
  // delivery is not used yet; the confirmation-mail step builds on it.
  r.requires("template-resolver", "delivery");
  r.defineEvent(CHECKOUT_CONSENT_RECORDED_EVENT_SHORT, checkoutConsentRecordedPayloadSchema, {
    piiFields: "none",
  });
}
