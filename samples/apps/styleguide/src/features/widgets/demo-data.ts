import { demoMoney, demoText } from "./demo-locale";

// Statische Demo-Zeitreihe (48 Punkte à 30 Minuten) — kein Date-API,
// das Fenster ist relativ zu 0 definiert.
export const RESPONSE_POINTS = Array.from({ length: 48 }, (_, i) => ({
  atMs: i * 30 * 60 * 1000,
  value: i === 20 ? null : 120 + Math.round(80 * Math.abs(Math.sin(i / 5))),
}));

export const LOAN_START_MS = Date.UTC(2020, 0, 1);
export const LOAN_TODAY_MS = Date.UTC(2026, 5, 15);
export const LOAN_MONTHS = 240;
const LOAN_PRINCIPAL_MINOR = 25_000_000;
const LOAN_MONTHLY_RATE = 0.035 / 12;

export const loanMonthMs = (monthIndex: number): number => Date.UTC(2020, monthIndex, 1);

// Annuity loan over 20 years: remaining principal falls, cumulative interest
// grows. "Today" is a fixed date, not the clock, so the window and the
// screenshots stay stable.
const growth = (1 + LOAN_MONTHLY_RATE) ** LOAN_MONTHS;
const annuityMinor = (LOAN_PRINCIPAL_MINOR * LOAN_MONTHLY_RATE * growth) / (growth - 1);
// Month index -> extra repayment, which shortens the term below LOAN_MONTHS.
const EXTRA_REPAYMENTS_MINOR: ReadonlyMap<number, number> = new Map([
  [84, 3_000_000],
  [150, 2_000_000],
]);
let balanceMinor: number = LOAN_PRINCIPAL_MINOR;
let interestPaidMinor = 0;
let payoffMonth: number | undefined;
const LOAN_REMAINING_POINTS = [{ atMs: loanMonthMs(0), value: LOAN_PRINCIPAL_MINOR }];
const LOAN_INTEREST_POINTS = [{ atMs: loanMonthMs(0), value: 0 }];
for (let i = 1; i <= LOAN_MONTHS; i++) {
  const interest = balanceMinor * LOAN_MONTHLY_RATE;
  const extraRepayment = EXTRA_REPAYMENTS_MINOR.get(i) ?? 0;
  balanceMinor = Math.max(0, balanceMinor - (annuityMinor - interest) - extraRepayment);
  if (balanceMinor === 0) payoffMonth ??= i;
  interestPaidMinor += interest;
  LOAN_REMAINING_POINTS.push({ atMs: loanMonthMs(i), value: Math.round(balanceMinor) });
  LOAN_INTEREST_POINTS.push({ atMs: loanMonthMs(i), value: Math.round(interestPaidMinor) });
}
export const LOAN_SERIES = [
  { key: "remaining", label: "widgets:dashboard:loan-remaining", points: LOAN_REMAINING_POINTS },
  { key: "interest", label: "widgets:dashboard:loan-interest", points: LOAN_INTEREST_POINTS },
];
export const LOAN_MARKERS = [
  ...[...EXTRA_REPAYMENTS_MINOR.keys()].map((monthIndex, i) => ({
    atMs: loanMonthMs(monthIndex),
    label: { i18nKey: `widgets:dashboard:marker-extra-${i + 1}` },
    kind: "extra",
  })),
  {
    atMs: loanMonthMs(payoffMonth ?? LOAN_MONTHS),
    label: { i18nKey: "widgets:dashboard:marker-payoff" },
    kind: "payoff",
  },
];

const SENDERS = ["William Smith", "Alice Smith", "Bob Johnson", "Emily Davis"] as const;
const SUBJECTS = ["Meeting Tomorrow", "Re: Project Update", "Weekend Plans", "Re: Budget"] as const;

// Static demo inbox (18 messages) for the InfinityList demo — enough
// rows to load several pages beyond pageSize=6.
export const INBOX_MESSAGES = Array.from({ length: 18 }, (_, i) => ({
  id: `m${i + 1}`,
  // Cast is sound: `i % SENDERS.length` is always in [0, SENDERS.length) —
  // noUncheckedIndexedAccess can't see that from a computed index, unlike
  // the removed `as string` this replaces (which had no such guarantee).
  sender: SENDERS[i % SENDERS.length] as (typeof SENDERS)[number],
  subject: SUBJECTS[i % SUBJECTS.length] as (typeof SUBJECTS)[number],
  snippet: "Hi team, just a reminder about our meeting tomorrow at 10 AM.",
  // % 4 statt % 3: bleibt an der sender/subject-Rotation ausgerichtet, sonst
  // ist irgendwann jede Kombination mal unread und der Filter zeigt visuell
  // keinen Unterschied.
  unread: i % 4 === 0,
}));

export function openAmount(amount: number, locale: string): string {
  return demoText("widgets:dashboard:demo-amount-open", locale).replace(
    "{amount}",
    demoMoney(amount, "EUR", locale),
  );
}
