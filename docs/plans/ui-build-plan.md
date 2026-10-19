---
status: in-progress
verified: 2026-06-30
evidence: "M1 shipped als @cosmicdrift/kumiko-headless + dispatcher-live (View-Model, Nav, Form-Controller, Batch-API); M2 teilweise als renderer-web/renderer; M3–M9 offen"
issue: kumiko-platform#443
next: M2–M4 verifizieren/abschließen (renderer-web + App-Skelett + E2E); Issue #110 geschlossen (M1-Scope)
---

# UI Build Plan — Meilensteine

> **Vor M1 lesen:** [ui-decisions.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/ui-decisions.md) — Tech-Entscheidungen (Auth-Cookie, Tailwind v3, SSE Welle 2.7) + zwei Framework-Vorarbeiten, die vor M1 erledigt werden.
>
> **M1 Stand 2026-04-22:** [ui-m1-inventur.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/ui-m1-inventur.md) — Gap-Analyse mit konkretem 5-Phasen-Schnitt. Ersetzt den ursprünglichen "M1 in einem Block"-Plan unten — zwei Framework-Bausteine (`r.screen`, `r.nav`) fehlen und müssen zwischen ui-core und View-Model eingeschoben werden.
>
> Inkrementeller Aufbau der UI-Schicht. Jeder Meilenstein ist **fuer sich testbar** — nicht alles auf einmal bauen.
> Architektur-Referenz: [ui-renderer.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/architecture/ui-renderer.md), [ui-architecture.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/architecture/ui-architecture.md), [ui-components.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/architecture/ui-components.md), [offline.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/architecture/offline.md).

## Build-Prinzip

Nicht parallel bauen. Ein Meilenstein nach dem anderen, **laufend und getestet** bevor der naechste anfaengt. So entstehen keine halbfertigen Strukturen die spaeter wieder umgebaut werden.

---

## Meilenstein 1: ui-core + Dispatcher-Contract + dispatcher-live ✅ (shipped)

> **Implementiert 2026-H1** unter dem Namen `@cosmicdrift/kumiko-headless` (früher „ui-core" im Plan). `dispatcher-live` shipped. Akzeptanzkriterien erfüllt.

**Ziel:** Pure TS Logik die ohne React/RN laeuft. Dispatcher-Contract fuer austauschbare Implementierungen. Erste Implementation (`dispatcher-live`) fuer Web/Always-Online.

### Package anlegen
- `packages/headless/` (`@cosmicdrift/kumiko-headless`) — Pure TS Logik (Plan: ui-core)
- `packages/dispatcher-live/` — HTTP-only Dispatcher (Standard fuer Web)
- Keine React/RN Dependencies, nur `zod` und `@cosmicdrift/kumiko-framework`

### Dispatcher-Contract (ui-core)

```typescript
export type Dispatcher = {
  write(qn: string, payload: unknown, opts?: WriteOpts): Promise<WriteResult>;
  query(qn: string, payload: unknown, opts?: QueryOpts): Promise<QueryResult>;
  batch(commands: Command[]): Promise<BatchResult>;

  // Status fuer UI (Online-Indicator, Sync-Badge)
  status(): "online" | "offline" | "syncing";
  onStatusChange(listener: (status: Status) => void): () => void;

  // Pending-Queue Info (nur relevant bei Savable)
  pendingWrites(): PendingWrite[];
  pendingFiles(): PendingFile[];
};
```

### dispatcher-live Implementation
- Direkter HTTP-Call an `/api/write`, `/api/query`, `/api/batch`
- Kein Store, kein Queue
- Fehler → sofort an UI zurueck
- Status: "online" normal, "offline" bei Netzwerk-Fehler

### Core-Bausteine

1. **Form-Controller** (pure TS)
   - `createFormController(opts)` → values/changes/isDirty/isUnchanged/errors/fields
   - Conditional Fields evaluieren (visible/readonly/required)
   - Zod-Validation dynamisch basierend auf visible/required
   - Changes-Only Tracking
   - Relations/Lines: Sub-Controller pro Zeile
   - Submit: erzeugt Batch-Commands, sendet via Dispatcher

2. **View-Model Builder**
   - `computeListViewModel(screenDef, data, user)` → ListViewModel
   - `computeEditViewModel(screenDef, entity, user)` → EditViewModel
   - Access-Check eingebaut

3. **Nav-Resolver**
   - `resolveNavigation(registry)` → NavTree
   - Screen-Graph aus `r.screen` + `r.nav`

4. **Asset-Resolver Interface** + **Locale-Resolver** + **Primitives-Contract**

### Batch-Endpoint im Framework
- `POST /api/batch` in `packages/framework/src/api/`
- Commands-Array, eine DB-Transaktion
- Auto-Sortierung anhand Relations (Parent → Create → Update → Delete)
- Integration-Tests

### Akzeptanzkriterium
- `yarn kumiko test` → alle ui-core Unit-Tests gruen
- `yarn kumiko test integration` → Batch-Endpoint + dispatcher-live durchlaufen
- Keine React/RN Imports in `packages/ui-core/src/` oder `packages/dispatcher-live/src/`

---

## Meilenstein 2: renderer-react (Web, nur Standard-Screens)

**Ziel:** React Web Renderer der `entityList` und `entityEdit` aus einer Config rendern kann.

### Package anlegen
- `packages/renderer-react/`
- Dependencies: `react`, `@cosmicdrift/kumiko-framework`, `@cosmicdrift/kumiko-ui-core`
- Tailwind-Config exportiert `tailwindPreset` aus ui-core

### Hooks (duenne Wrapper um ui-core)
- `useCommand(qn, payload)` — nutzt injizierten Dispatcher aus Context
- `useMutation(qn)` — fuer Writes
- `useForm(screenDef, initial)` — React Hook um Form-Controller
- `useNav()` — URL-basierte Navigation
- `useCurrentUser()`, `useLayout()`, `useTheme()`, `useTranslation()`, `useAsset()`
- `useDispatcherStatus()` — Online/Offline/Syncing Status (fuer UI-Indicator)

### Dispatcher-Context
- `<DispatcherProvider dispatcher={liveDispatcher}>` auf App-Ebene
- Hooks holen sich den Dispatcher aus Context
- App-Dev entscheidet: live oder savable

### Renderer-Registrierung
- `renderer-react/index.ts` → `defineFeature("renderer-react", r => r.registerRenderer("react", {...}))`
- `resolveAsset(qn)` → URL-Mapping

### Standard-Renderer
1. `render-list.tsx` → View-Model → HTML-Tabelle mit Tailwind
2. `render-edit.tsx` → View-Model + Form-Controller → Formular mit Sections
3. `render-field.tsx` → Field-Metadata → passendes Input
4. `render-nav.tsx` → NavTree → Sidebar

### Primitives-Contract Check
- `PrimitivesContract` Type in ui-core
- Renderer erwartet Primitives als App-Config

### Akzeptanzkriterium
- Zod-Schema + Entity + Screen-Def werden zu fertigem HTML
- Form-Controller wirkt (tippen → isDirty, submit → Batch-Call via Dispatcher)
- Tailwind-Klassen funktionieren
- Unit-Tests fuer Hooks (React Testing Library)

---

## Meilenstein 3: primitives-shadcn + App-Skelett

**Ziel:** Ein laufendes Web-App-Skelett mit Auth, Tenant-Switcher und Shell.

### primitives-shadcn
- `packages/primitives-shadcn/`
- Implementiert `PrimitivesContract` mit shadcn/ui
- Alle 10 Primitives: Button, TextInput, NumberInput, Select, Toggle, DatePicker, Modal, Toast, Badge, Card, Icon
- Icon mapped auf `lucide-react`

### apps/web
- `apps/web/` als Workspace
- Vite + React + Tailwind + React Router
- `app.ts` — `createApp({ features, primitives: shadcnPrimitives, dispatcher: liveDispatcher })`
- Auth-Flow: Login → JWT → Session (nutzt existierendes Auth-Feature)
- Tenant-Switcher (Sidebar Dropdown)
- `shell-sidebar` Feature mit Sidebar + Topbar Layout
- Boot-Sequence: Features registrieren → Registry bauen → App rendern

### Routing
- `/t/{tenant}/login`
- `/t/{tenant}/{feature}/{screen}`
- `/t/{tenant}/{feature}/{screen}/:id`

### Akzeptanzkriterium
- `yarn kumiko dev` startet API + Web
- Login → Dashboard (leerer Screen) laeuft
- Tenant-Switcher wechselt den Kontext
- Keine Features mit echten Screens noetig — nur das Skelett

---

## Meilenstein 4: Beispiel-Feature + E2E-Generator

**Ziel:** Ein vollstaendiges CRUD-Feature das komplett aus der Config gerendert wird, plus generierte E2E-Tests.

### Beispiel-Feature (basic-crud erweitern)
- `r.screen({ type: "entityList", ... })` fuer Task-Liste
- `r.screen({ type: "entityEdit", ... })` fuer Task-Bearbeitung
- `r.nav({ ... })` fuer Navigation
- In `apps/web/app.ts` einbinden

### E2E-Generator
- `packages/testing/src/e2e-generator.ts`
- Liest Registry, erzeugt Playwright Tests fuer alle entityList/entityEdit
- Fixtures aus Zod-Schemas generieren
- Helpers: Login, Tenant-Setup

### Playwright Setup
- `playwright.config.ts` gegen laufenden Dev-Server
- `yarn kumiko test e2e` → generierte + manuelle Tests

### Akzeptanzkriterium
- Task CRUD im Browser funktioniert (Create, List, Detail, Update, Delete)
- Validierung wirkt, Dirty-Tracking wirkt
- Playwright Tests laufen gruen

---

## Meilenstein 5: Custom Screen + Cross-Feature Component

**Ziel:** Custom Screen Pattern und Cross-Feature Components funktionieren.

- Custom Screen Beispiel (Dashboard mit `useCommand`, `usePrimitives`)
- Cross-Feature Component (Feature A registriert, Feature B nutzt via QN)
- Screen Extension (Audit haengt sich automatisch an jeden `entityEdit`)

### Akzeptanzkriterium
- Dashboard rendert mit Chart-Daten aus Query
- Cross-Feature Component laedt und funktioniert
- Screen Extension erscheint automatisch ohne dass basic-crud was aendert

---

## Meilenstein 6: Shell austauschen

**Ziel:** Beweisen dass Shell als Feature austauschbar ist.

- `shell-topbar` als Alternative zu `shell-sidebar`
- Zwei Builds moeglich ohne Code-Aenderung in Features

---

## Meilenstein 7: dispatcher-savable (Offline-Dispatcher)

**Ziel:** Offline-faehiger Dispatcher als eigenes Feature. **Vor** Expo gebaut damit wir ihn auf dem Web testen koennen (Connection simulieren).

### Package: dispatcher-savable
- `packages/dispatcher-savable/`
- Implementiert `Dispatcher` Contract aus ui-core

### Local Store
- Interface: `LocalStore` (get/set/delete/list pro Entity)
- Default-Implementation: IndexedDB fuer Web-Tests
- Spaeter fuer Expo: MMKV-Implementation (kommt in M8)

### Event Queue
- **Write-Queue:** FIFO pro Entity (Reihenfolge wichtig fuer gleiche Entity)
- **Parallel zwischen Entities:** tasks + orders koennen gleichzeitig syncen
- **Batch-Unit:** Ein `batch()` Call bleibt atomar in der Queue
- **Retry-Strategy:** Exponential Backoff bei Server-Fehlern

### File-Queue (separat)
- Eigene Queue fuer Uploads (groesser, langsamer, eigene Retry-Logik)
- File ist "pending" bis Upload durch → Entity behaelt temporaere ID

### Sync-Engine
- **Online-Detection:** SSE-Connection als Truth
- **Connect:** Queue abarbeiten → dann SSE subscriben
- **Reconnect:** Incremental Sync (nur Events seit letztem bekannten Timestamp)
- **Disconnect:** Queue pausieren, neue Writes sammeln

### Conflict-Handling
- `version_conflict` vom Server → Conflict-Handler aufrufen
- Default: UI zeigt "Datensatz wurde geaendert, neu laden?" (wie in optimistic-locking.md)
- Custom: Dev kann eigenen `onConflict` im Dispatcher-Setup registrieren

### Query-Strategie (Local-First)
- **Query:** Local Store first (sofortiges Ergebnis), Network im Hintergrund zum Refreshen
- **Entity existiert nicht lokal:** Network blocking
- **Network-Result:** ins Local Store schreiben → via Event-Emitter UI updaten

### Status-Tracking
- `status()` reflektiert Sync-Status
- `pendingWrites()` / `pendingFiles()` fuer UI-Badges ("3 Aenderungen warten")

### Testing (auf Web!)
- Chrome DevTools Network-Throttle fuer Offline-Simulation
- Playwright Tests:
  - Online → Write → sofort im Store
  - Offline → Write → in Queue
  - Online wieder → Queue abgearbeitet
  - Conflict → Handler aufgerufen
- Integration-Tests mit mock-Store + mock-SSE

### App-Integration
- `apps/web/app.ts` kann optional savable statt live nutzen (fuer PWA-Faelle)
- Hauptnutzung kommt in M8 (Expo)

### Akzeptanzkriterium
- Unit-Tests fuer Queue, Sync-Engine, Conflict-Handler
- Playwright E2E: Offline-Szenario komplett (Write → Offline → Reconnect → Sync)
- Status-Updates funktionieren
- Gleiche Feature-Code laeuft mit dispatcher-live und dispatcher-savable

---

## Meilenstein 8: renderer-expo (Mobile)

**Ziel:** Mobile Version der gleichen Features mit dispatcher-savable.

### primitives-paper
- `packages/primitives-paper/`
- Implementiert `PrimitivesContract` fuer React Native
- Icons via `lucide-react-native`

### renderer-expo
- `packages/renderer-expo/`
- Gleiche Hooks wie renderer-react
- Navigation via Expo Router / React Navigation
- Tailwind via NativeWind
- Standard-Renderer fuer entityList/entityEdit in Native Components

### dispatcher-savable Mobile-Store
- MMKV-Implementation des `LocalStore` Interface
- File-Queue mit RN File System
- Background-Sync wenn moeglich (Expo Background Tasks)

### apps/mobile
- `apps/mobile/` als Expo App
- Gleiche Features wie apps/web
- Bottom Tabs statt Sidebar (Shell-Feature)
- `dispatcher: savableDispatcher` als Default

### Akzeptanzkriterium
- `yarn kumiko dev` startet auch Expo
- Task CRUD funktioniert auf Simulator
- Offline-Workflow: Flugmodus → Aenderung → Flugmodus aus → Sync
- Gleiche Business-Logik wie Web (nur Darstellung anders)

---

## Meilenstein 9: E2E Mobile

**Ziel:** Mobile E2E Tests mit Maestro.

- `packages/testing/src/maestro/`
- Generator erzeugt YAML-Flows aus Registry
- Gegen Simulator/Emulator laufen lassen

### Akzeptanzkriterium
- Mobile E2E laeuft gruen
- Offline-Szenarien getestet (App schliessen waehrend Queue → wieder oeffnen → Sync)

---

## Reihenfolge zusammengefasst

```
M1: headless + Dispatcher-Contract + dispatcher-live  ✅ shipped
M2: renderer-web Standard-Renderer                 ← teilweise shipped, verifizieren
M3: primitives-shadcn + App-Skelett                  ← erste Seite im Browser
M4: Beispiel-Feature + E2E                           ← erstes CRUD mit Tests
M5: Custom + Cross-Feature                           ← Flexibilitaet beweisen
M6: Shell austauschen                                ← Feature-Architektur beweisen
M7: dispatcher-savable                               ← Offline-Dispatcher (auf Web testbar)
M8: renderer-expo mit dispatcher-savable             ← Mobile
M9: E2E Mobile                                       ← Mobile komplett
```

## Was NICHT im Grundgeruest

- SSR (spaeter als separater Renderer)
- Multi-Step Wizards (Dev baut selbst in Custom Screen)
- Visual Regression Tests (Playwright Screenshots, spaeter)
- Performance Tests (nicht generiert)
- Tenant-Theming im Mobile Renderer (erstmal Web only)
- Design-System (Figma, Style Guide) — das kommt wenn's Produkte gibt

## Definition of Done (Grundgeruest)

Nach M4 sollte das hier funktionieren:
1. `yarn kumiko dev` startet API + Web-App
2. Login funktioniert
3. Tenant-Switcher funktioniert
4. Ein Feature mit Task-CRUD ist vollstaendig bedienbar (Liste, Detail, Edit, Create, Delete)
5. Validation wirkt, Dirty-Tracking wirkt
6. Playwright E2E-Tests laufen gruen
7. Kein Screen-Code in JSX geschrieben — alles aus Config

Das ist der **Punkt ab dem Feature-Dev moeglich ist** ohne dass noch Framework-Plumbing fehlt.

## Definition of Done (Mobile + Offline)

Nach M8 sollte das hier funktionieren:
1. Mobile App laeuft auf Simulator
2. Flugmodus an → Aenderungen gehen in Queue
3. Flugmodus aus → Queue wird abgearbeitet, UI zeigt Sync-Status
4. Conflict-Handling bei parallelen Aenderungen
5. File-Upload funktioniert mit Queue



