// Live-Events-Contract, plattform-neutral. Die Plattform (Web mit
// EventSource, Native mit polyfill) liefert einen `LiveEventSubscriber`
// via `<LiveEventsProvider value={...}>`; der shared-Layer konsumiert
// nur das Interface.
//
// Warum ein Context statt Module-Singleton wie vor dem Split: ein
// Module-Singleton koppelt an eine globale Verbindung. Mit Context
// kann der Caller pro Tree eine andere Subscribe-Quelle durchreichen
// — nützlich in Tests (Fake-Feed), bei Multi-Tenant-Bridges, und
// beim Native-Renderer wo die Verbindungs-Lifecycle oft nicht dem
// App-Lifecycle entspricht.

import { createContext, type ReactNode, useContext } from "react";

export type LiveEvent = {
  readonly type: string;
  readonly data: {
    readonly id: string;
    readonly aggregateType: string;
    readonly version: number;
    readonly payload: unknown;
    readonly createdAt: string;
  };
};

/** Abonniert Live-Events für eine Entity (aggregateType). Returnt die
 *  Unsubscribe-Funktion. Mehrere Subscriptions parallel auf dieselbe
 *  Entity sind erlaubt — jede bekommt ihr eigenes Event. */
export type LiveEventSubscriber = (
  entityName: string,
  listener: (event: LiveEvent) => void,
) => () => void;

// Wenn kein Provider da ist, liefern wir einen No-op-Subscriber statt
// zu crashen. Grund: useQuery({ live: true }) kann optimistisch
// ausgehakt werden ohne den ganzen Baum abzureißen, wenn die Plattform
// z.B. SSE temporär deaktiviert hat. Fehler-Signale würden stumm
// geschluckt — das ist explizit dokumentiert.
const noopSubscriber: LiveEventSubscriber = () => () => {};

const LiveEventsContext = createContext<LiveEventSubscriber>(noopSubscriber);

export type LiveEventsProviderProps = {
  readonly children: ReactNode;
  readonly value: LiveEventSubscriber;
};

export function LiveEventsProvider({ children, value }: LiveEventsProviderProps): ReactNode {
  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

/** Hook für useQuery-like Consumer. Liefert die Subscribe-Function
 *  aus dem Context. Wenn kein Provider da ist, ist's ein No-op. */
export function useLiveEvents(): LiveEventSubscriber {
  return useContext(LiveEventsContext);
}
