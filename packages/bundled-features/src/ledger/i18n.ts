import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { LedgerHandlers as H } from "./web/constants.ts";

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es live in the locale packages.
export const LEDGER_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.confirmSchedulePeriod)]: { en: "Confirm schedule period" },
  [handlerFieldLabelKey(H.confirmSchedulePeriod, "scheduleId")]: { en: "Schedule" },
  [handlerFieldLabelKey(H.confirmSchedulePeriod, "period")]: { en: "Period" },
  [handlerFieldLabelKey(H.confirmSchedulePeriod, "amount")]: { en: "Amount" },
  [handlerFieldLabelKey(H.confirmSchedulePeriod, "date")]: { en: "Booking date" },

  [handlerTitleKey(H.createTransaction)]: { en: "Book transaction" },
  [handlerFieldLabelKey(H.createTransaction, "date")]: { en: "Booking date" },
  [handlerFieldLabelKey(H.createTransaction, "description")]: { en: "Description" },
  [handlerFieldLabelKey(H.createTransaction, "reference")]: { en: "Reference" },
  [handlerFieldLabelKey(H.createTransaction, "period")]: { en: "Period" },
  [handlerFieldLabelKey(H.createTransaction, "status")]: { en: "Status" },
  [handlerFieldLabelKey(H.createTransaction, "lines")]: { en: "Posting lines" },
  [handlerFieldLabelKey(H.createTransaction, "subjectType")]: { en: "Related to" },
  [handlerFieldLabelKey(H.createTransaction, "subjectId")]: { en: "Related ID" },
  [handlerFieldLabelKey(H.createTransaction, "sourceRef")]: { en: "Source reference" },

  [handlerTitleKey(H.ensureAccounts)]: { en: "Ensure accounts" },
  [handlerFieldLabelKey(H.ensureAccounts, "accounts")]: { en: "Accounts" },

  [handlerTitleKey(H.reverseTransaction)]: { en: "Reverse transaction" },
  [handlerFieldLabelKey(H.reverseTransaction, "id")]: { en: "Transaction" },
  [handlerFieldLabelKey(H.reverseTransaction, "date")]: { en: "Booking date" },
  [handlerFieldLabelKey(H.reverseTransaction, "description")]: { en: "Description" },
};
