---
"@cosmicdrift/kumiko-renderer-web": patch
---

fix(renderer-web): doppelter Kalender-Header im Date-/Timestamp-Picker

react-day-picker v9 rendert im `captionLayout="dropdown"`-Modus je Monat/Jahr
ein `<select>` UND ein begleitendes `aria-hidden`-`<span>` mit demselben Label;
sichtbar wird nur eines, weil rdps eigene `style.css` das `<select>` transparent
darüberlegt. Da `CalendarPopover` die rdp-Klassen mit eigenen Tokens überschreibt,
greift diese Positionierung nicht → Monat/Jahr doppelt (Folgebug aus #369).

Fix: rdps `Dropdown` per `components`-Prop durch ein einzelnes gestyltes `<select>`
ersetzen — kein Begleit-Span mehr, CSS-unabhängig korrekt. Neuer Browser-e2e
(`date-picker.spec.ts`) pinnt es (genau 2 Selects, kein aria-hidden-Label daneben,
plus Tippen→ISO und Jahres-Sprung). Betrifft `date`- und `timestamp`-Picker
gleichermaßen (geteilter `CalendarPopover`).
