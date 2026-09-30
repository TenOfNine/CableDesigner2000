# Harness Designer

Web-basierter Kabelbaum-Designer für private Projekte – angelehnt an harness.design.
Selbst gehostet (Docker), mehrere Benutzerkonten, Projekte mit Unterprojekten, Freigaben, Bauteilbibliothek,
Schaltplan- und Layout-Ansicht mit automatischer Leitungslängen-Berechnung sowie Export als Druck/PDF, Bild und Excel.

---

## Funktionsumfang (Version 0.1)

**Konten & Projekte**
- Ersteinrichtung legt den ersten Administrator an; weitere Konten legt ein Administrator unter *Verwaltung* an.
- Projekte mit beliebig tief verschachtelten Unterprojekten; in jeder Ebene beliebig viele Kabelbäume.
- Freigabe eines Projekts (inkl. aller Unterprojekte) an andere Konten mit *Lesen* oder *Bearbeiten*.
  Administratoren sehen fremde Projekte nur über Freigaben.
- Kabelbäume umbenennen, duplizieren, verschieben, als JSON exportieren/importieren.
- Automatisches Speichern mit Konflikterkennung (zwei Personen bearbeiten gleichzeitig).

**Schaltplan**
- Steckverbinder (frei oder aus der Bibliothek), Terminals (Ringkabelschuh, Gabelkabelschuh, Aderendhülse,
  Flachstecker, Flachsteckhülse, offenes Ende), Spleiße, Diode, Widerstand, Notizen.
- Leitungen per Ziehen von Pin zu Pin; Farbe (IEC 60757) mit Kennfarbe, Querschnitt (mm² mit AWG-Anzeige), Leitungstyp.
- Steckverbinder-Paarung (z. B. Schottstecker E ⇄ C) – Stromkreise werden über die Paarung verfolgt.
- Hervorhebung einer Leitung beim Überfahren, Auswahlrahmen, Duplizieren, Rückgängig/Wiederholen.

**Layout / Formboard**
- Segmente zwischen Bauteilen und Abzweigpunkten ziehen, T-Abzweige durch Ziehen auf ein Segment,
  Knickpunkte, Segmentlängen in mm, Ummantelungen (Wellrohr, Band, Geflecht, Schrumpfschlauch).
- Jede Leitung wird automatisch durch das Segmentnetz geführt (kürzester Weg); daraus ergibt sich die Länge.
  Leitungen laufen über Abzweigpunkte und an Spleißen/Bauelementen vorbei, aber nicht durch Steckverbinder oder Terminals.
- Je Steckverbinder einblendbar: Teilebild, Steckgesicht (Kammeranordnung) und Leitungstabelle.
- Geschätzter Bündeldurchmesser je Segment (Warnung, wenn größer als die Ummantelung).

**Leitungslänge**

```
Länge = Weg im Layout × (1 + Zuschlag %) + 2 × Zugabe je Leitungsende + Zusatzlänge der Leitung
```

Zuschlag und Zugabe stellst du in den Kabelbaum-Einstellungen (⚙) ein. Pro Leitung kann zusätzlich eine feste Länge
eingetragen werden, die die Berechnung ersetzt.

**Listen & Exporte**
- Leitungsliste, Stückliste (inkl. Kontakte je belegter Kammer und Sekundärverriegelung), Pinbelegung, Segmente, Prüfhinweise.
- **Drucken / PDF**: Schaltplan und Layout seitenfüllend mit Schriftfeld (Zeichnungsnummer, Revision, Bearbeiter, Datum),
  dazu wählbare Listen; A4/A3, Hoch/Quer. Im Druckdialog des Browsers „Als PDF speichern“ wählen.
- **Bild**: PNG (1×/2×/3×) oder SVG, hell oder dunkel.
- **Excel** (.xlsx): Blätter *Leitungsliste*, *Stückliste*, *Pinbelegung*, *Segmente*, *Info*.

**Bauteilbibliothek**
- Globale Bibliothek (für alle Konten, von Administratoren gepflegt) und eigene Teile je Konto, jeweils mit Bild-Upload.
- Vorbefüllt mit TE DEUTSCH DT (2/3/4/6/8/12-polig) und DTM (2/4/6), Molex Micro-Fit 3.0 (2/4/6/8),
  JST XH (2–6) und PH (2–4) jeweils mit Kontakt-Teilenummer, dazu FLRY-B-Leitungen, Terminals, Spleiße,
  Ummantelungen, Dioden/Widerstand.
- Beim Zuordnen wird eine Kopie der Teiledaten im Kabelbaum gespeichert – spätere Bibliotheksänderungen verändern
  bestehende Kabelbäume nicht.

> **Hinweis:** Die Steckgesicht-Anordnungen der vorbefüllten Teile sind schematisch. Kammernummerierung und Kontaktauswahl
> vor der Fertigung immer mit dem Herstellerdatenblatt abgleichen.

---

## Installation mit Docker

Voraussetzung: Docker mit Compose-Plugin.

```bash
# Projektordner entpacken, dann darin:
docker compose up -d --build
```

Danach ist die Oberfläche unter `http://<server>:8080` erreichbar. Beim ersten Aufruf erscheint die **Ersteinrichtung**
für das Administratorkonto.

Alle Daten (Benutzer, Projekte, Kabelbäume, Bibliothek inkl. Bilder) liegen in einer SQLite-Datei im Volume
`harness-data` (`/data/harness.db` im Container).

### Einstellungen (Umgebungsvariablen)

| Variable        | Standard | Bedeutung |
|-----------------|----------|-----------|
| `PORT`          | `8080`   | Port im Container |
| `DATA_DIR`      | `/data`  | Speicherort der Datenbank |
| `COOKIE_SECURE` | `false`  | `true` setzen, sobald nur noch per HTTPS zugegriffen wird |
| `TRUST_PROXY`   | leer     | Hinter einem Reverse Proxy z. B. `1` (korrekte Client-IP für die Login-Drosselung) |
| `SESSION_DAYS`  | `30`     | Gültigkeit einer Anmeldung in Tagen (verlängert sich bei Nutzung) |

### Betrieb hinter einem Reverse Proxy (empfohlen bei Zugriff von außen)

Beispiel Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 10m;
}
```

Dann in `docker-compose.yml` `COOKIE_SECURE: "true"` und `TRUST_PROXY: "1"` setzen.

### Sicherung und Wiederherstellung

- **Sicherung:** *Verwaltung → Datenbank-Backup* lädt eine konsistente Kopie der Datenbank herunter
  (funktioniert im laufenden Betrieb).
- **Wiederherstellung:** Container stoppen, Sicherungsdatei als `harness.db` in das Volume kopieren, Container starten:

```bash
docker compose stop
docker run --rm -v harness-designer_harness-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/harness.db-wal /data/harness.db-shm && cp /backup/harness-designer-backup-XXXX.db /data/harness.db && chown 1000:1000 /data/harness.db"
docker compose start
```

(Der Volume-Name setzt sich aus Ordnername und `harness-data` zusammen; `docker volume ls` zeigt ihn an.)

### Aktualisieren

Neue Version entpacken und erneut `docker compose up -d --build` ausführen. Die Datenbank wird beim Start automatisch
auf den neuen Stand gebracht.

---

## Bedienung in Kürze

1. **Projekt** anlegen → optional **Unterprojekte** → **Kabelbaum** anlegen.
2. **Schaltplan:** Rechtsklick auf die Fläche (oder Leiste links) → Steckverbinder/Terminals/Spleiße hinzufügen.
   Pins im Eigenschaften-Bereich benennen (z. B. „BAT +“, „INJ 1“). Leitungen durch Ziehen von Pin zu Pin anlegen.
3. **Layout:** Werkzeug *Segment zeichnen* (Taste **S**) oder am ＋-Griff eines Bauteils ziehen.
   Auf freie Fläche ziehen = neuer Abzweigpunkt, auf ein Segment ziehen = T-Abzweig. Länge direkt eintippen
   (Doppelklick auf die Längenangabe zum Ändern). Rechtsklick auf ein Segment: Abzweig-/Knickpunkt, Ummantelung.
4. **Listen:** Leitungsliste, Stückliste, Pinbelegung, Segmente und **Prüfung** (z. B. nicht verlegte Leitungen,
   Segmente ohne Länge, Doppelanschläge).
5. **Export:** Drucken/PDF, Bild, Excel.

| Taste | Funktion |
|-------|----------|
| Entf | Auswahl löschen |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| Strg+D | Bauteile duplizieren (inkl. Leitungen zwischen ihnen) |
| Strg+A | Alles auswählen |
| F | Ansicht einpassen |
| 1 / 2 / 3 | Schaltplan / Layout / Listen |
| V / S | Layout: Auswählen / Segment zeichnen |
| Shift+Ziehen | Auswahlrahmen |
| Mausrad | Zoom, Hintergrund ziehen = Verschieben |

**Beispiel:** `examples/beispiel-zuendung-einspritzung.harness.json` lässt sich in einem Projekt über
*⋯ → Kabelbaum importieren (JSON)* laden (Einspritzung & Zündung mit Schottstecker, zwei ECUs, Armaturenbrett).

---

## Entwicklung

```bash
npm install
npm run dev      # Server auf :8080 + Vite-Dev-Server auf :5173 (mit API-Proxy)
npm run build    # Frontend nach dist/ bauen
npm start        # Produktionsserver (liefert dist/ aus)
```

Aufbau:

- `server/` – Express + SQLite (better-sqlite3): Anmeldung (scrypt, HttpOnly-Session-Cookie), Benutzer, Projekte,
  Freigaben, Kabelbaum-Dokumente (JSON mit Versionszähler), Bibliothek, Backup.
- `client/src/editor/` – Editor: `model.js` (Datenmodell), `derive.js` (Routing, Längen, Stromkreise, Stückliste,
  Prüfungen), `SchematicScene.jsx`/`LayoutScene.jsx` (reine SVG-Darstellung, auch für Druck/Export),
  `SchematicView.jsx`/`LayoutView.jsx` (Interaktion), `exports.jsx`/`PrintView.jsx` (Exporte).
- Ein Kabelbaum ist ein JSON-Dokument (`components`, `wires`, `nodes`, `segments`, `notes`, `settings`) –
  das erleichtert spätere Erweiterungen und den JSON-Export/Import.

## Mögliche nächste Erweiterungen

- Mehradrige Leitungen (Mantelleitungen) und verdrillte Paare als eigene Objekte
- Eingebettete Unter-Kabelbäume („Embed Harness“)
- Formboard-Druck im Maßstab 1:1 über mehrere Seiten
- Weitere Bibliotheksteile / Import von Teilelisten (CSV)
- Revisionsverlauf je Kabelbaum
