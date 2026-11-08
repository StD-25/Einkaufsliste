# Einkaufsliste

Eine gemeinsame Einkaufsliste für die Familie, die man als App aufs Handy installiert (PWA). Jeder trägt ein, was fehlt, mit Artikel, Menge, Name und Zeitpunkt. Wer einkauft, hakt ab. Änderungen erscheinen sofort bei allen und funktionieren auch offline.

Der Aufbau entspricht der Besprechungs-App: Vanilla JS, GitHub Pages, kein Build-Schritt. Gemeinsamer Speicher ist **Firebase Firestore** (kostenloser Spark-Tarif).

Ohne Firebase-Konfiguration läuft die App im **Demo-Modus**. Dann bleiben die Daten nur auf dem jeweiligen Gerät.

## Einmalige Einrichtung von Firebase (ca. 10 Minuten)

1. Auf https://console.firebase.google.com mit einem Google-Konto anmelden und **Projekt hinzufügen** wählen, Name „Einkaufsliste“. Google Analytics wird nicht gebraucht.
2. **Web-App hinzufügen** (Symbol `</>`), Name „Einkaufsliste“, *kein* Firebase Hosting. Die angezeigten Werte (`apiKey`, `authDomain`, `projectId` …) in [js/firebase-config.js](js/firebase-config.js) eintragen.
3. **Build → Authentication → Jetzt starten → Anmeldemethode „Anonym“ aktivieren.**
4. **Build → Firestore Database → Datenbank erstellen**, Standort `europe-west3 (Frankfurt)`, im Produktionsmodus starten.
5. Im Reiter **Regeln** von Firestore den Inhalt von [firestore.rules](firestore.rules) einfügen und auf **Veröffentlichen** klicken.
6. **Authentication → Einstellungen → Autorisierte Domains:** `std-25.github.io` hinzufügen.

## Veröffentlichen auf GitHub Pages

1. Auf GitHub ein neues Repository `Einkaufsliste` anlegen (öffentlich).
2. Alle Dateien dieses Ordners hochladen bzw. pushen.
3. Unter **Settings → Pages** die Quelle `Deploy from a branch`, Branch `main` und Ordner `/ (root)` wählen.
4. Die App läuft danach unter https://std-25.github.io/Einkaufsliste/

Nach jeder Code-Änderung in [service-worker.js](service-worker.js) die Versionsnummer `CACHE` erhöhen, damit die Handys die neue Fassung laden.

## Installieren auf dem Handy

- **Android (Chrome):** Link öffnen, dann Menü ⋮ → „App installieren“.
- **iPhone (Safari):** Link öffnen, dann Teilen-Symbol → „Zum Home-Bildschirm“.

Beim ersten Start fragt die App nach dem Namen. Er lässt sich unter *Einstellungen* ändern.

## Familien-Code (Zugriffsschutz)

Jede Liste hat einen geheimen, zufälligen Code aus 24 Zeichen. Die Einträge liegen in Firestore unter `listen/<code>/items`. Wer den Code nicht kennt, kann die Liste weder finden noch lesen, auch nicht mit den öffentlichen Firebase-Zugangsdaten. Der Code steht nicht im Quellcode.

1. Die erste Person öffnet die App und tippt auf **„Neue Liste anlegen“**.
2. Unter **Einstellungen → Familie einladen** steht der Einladungslink (`…/Einkaufsliste/?liste=<code>`). Diesen Link nur an die Familie schicken.
3. Wer den Link öffnet, ist sofort in der Liste. Die App merkt sich den Code.
4. Fragt die installierte App auf dem iPhone trotzdem nach dem Code, dort einfach den Einladungslink einfügen.

## Bedienung

- **Offen:** Artikel und Menge eintragen, dann „Hinzufügen“. Mit dem Kreis links wird ein Artikel abgehakt, im Hinweis unten lässt sich das rückgängig machen.
- **Tipp auf einen Eintrag:** Artikel und Menge ändern oder den Eintrag löschen.
- **Erledigt:** zeigt, wer was wann gekauft hat. „Erledigte löschen“ räumt die Liste auf.

## Gefrierschrank

Zweiter Reiter ❄️ **Gefrierschrank** mit 8 Fächern. Die Namen der Fächer lassen sich unter Einstellungen ändern.

- **Einlagern:** Artikel, Anzahl, Einheit, Fach, *haltbar bis* (Schnellwahl +3/+6/+12 Monate) und optional der Grundbestand. Jede Einlagerung ist ein eigener Posten, mit Datum und Name.
- **Entnehmen:** im Fach beim Posten oder in „Alle Artikel“. Dort wird zuerst genommen, was am frühesten abläuft. Bei 0 verschwindet der Posten.
- **Hinweise oben:** abgelaufen (rot), läuft in den nächsten 30 Tagen ab (orange), unter Grundbestand (blau, mit Knopf „Auf Einkaufsliste“).
- **Zähler am Reiter** und Hinweis im Reiter Einkauf, wenn etwas abgelaufen ist oder bald abläuft.
- **Verlauf:** alle Bewegungen (eingelagert, entnommen, korrigiert, umgelagert, gelöscht). Einträge, die älter als 12 Monate sind, werden automatisch entfernt.

Daten in Firestore unter `listen/<code>/`: `gefrier`, `grundbestand`, `verlauf`, `einstellungen/faecher`.

## Kisten

Dritter Reiter 📦 **Kisten**: frei angelegte Bereiche (z. B. Werkstatt, Garage, Keller) mit nummerierten Kisten.

- **Bereich anlegen:** Name und Kürzel. Aus dem Kürzel entstehen die Kistennummern (G → G01, G02 …). Ein Bereich lässt sich erst löschen, wenn er leer ist.
- **Kiste:** bis zu 20 Fotos und eine Inhaltsliste (Text, optional Anzahl). Fotos werden im Handy auf ca. 250 KB verkleinert. Tipp auf ein Foto: groß ansehen, als Titelbild setzen oder löschen. Unter „Bearbeiten“ lassen sich Nummer, Bezeichnung, Notiz und Bereich ändern (Kiste umziehen) oder die Kiste löschen.
- **Türme (freiwillig):** In jedem Bereich lassen sich Türme anlegen, z. B. benannt nach der obersten Kiste. Jede Turm-Karte zeigt die Kisten als Stapel von oben nach unten (mit Vorschaubild). Die Reihenfolge ändert ihr unter Einstellungen → Türme: Eintrag lange drücken und schieben. Neu zugeordnete Kisten kommen oben drauf. In der großen Bildansicht wechselt Wischen nach oben/unten zur Kiste darunter/darüber im selben Turm. Im Turm-Fenster werden die Kisten per Häkchen zugeordnet; ein Tipp auf eine Nummer übernimmt sie als Turmnamen. Beim Anlegen und Bearbeiten einer Kiste lässt sich der Turm wählen. Wird ein Turm gelöscht, bleiben die Kisten erhalten („Ohne Turm“).
- **Suche:** über Nummer, Bezeichnung, Notiz und Inhalt. Alle Suchwörter müssen vorkommen. Mit den Bereichs-Knöpfen lässt sich die Suche auf ausgewählte Bereiche einschränken.

Daten in Firestore unter `listen/<code>/`: `bereiche` (mit Liste `tuerme`), `kisten` (Feld `turm`), `bilder`. Die Fotos liegen direkt in Firestore (kostenloser Tarif: 1 GiB, reicht für ca. 3.000 Fotos).

## Lokal testen

```bash
python -m http.server 8080
```

Danach http://localhost:8080 öffnen. Mit `http://localhost:8080/?demo` läuft die App im Demo-Modus, ohne Firebase-Daten zu berühren. Für Firebase im lokalen Test muss `localhost` unter den autorisierten Domains stehen (das ist der Standard).

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Gerüst: Kopfzeile, Inhalt, Tabbar |
| `css/app.css` | Gestaltung (hell/dunkel) |
| `js/app.js` | Einkauf, Einstellungen, Routing, Start |
| `js/freezer.js` | Gefrierschrank |
| `js/boxes.js` | Kisten |
| `js/ui.js` | Gemeinsame Bausteine (Dialoge, Hinweise, Datumsformate) |
| `js/store.js` | Speicher: Firestore oder Demo-Modus |
| `js/firebase-config.js` | Firebase-Zugangsdaten (öffentlich, geschützt durch Regeln) |
| `firestore.rules` | Sicherheitsregeln für Firestore |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | PWA (installierbar, offline) |
