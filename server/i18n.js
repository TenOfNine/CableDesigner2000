// Server-side translations. English is the source language; German strings live here.
// The client sends its UI language in the `X-Lang` header.

const DE = {
  'Not signed in.': 'Nicht angemeldet.',
  'Administrators only.': 'Nur für Administratoren.',
  'Password must be at least 8 characters long.': 'Das Passwort muss mindestens 8 Zeichen lang sein.',
  'Password is too long.': 'Das Passwort ist zu lang.',
  'Username: 2–40 characters; letters, digits, dot, underscore and hyphen are allowed.':
    'Benutzername: 2–40 Zeichen, erlaubt sind Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.',
  'Setup has already been completed.': 'Die Einrichtung wurde bereits abgeschlossen.',
  'Too many failed attempts. Please try again in 15 minutes.': 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
  'Wrong username or password.': 'Benutzername oder Passwort ist falsch.',
  'This account is disabled.': 'Dieses Konto ist deaktiviert.',
  'The current password is wrong.': 'Das aktuelle Passwort ist falsch.',
  'Display name must not be empty.': 'Anzeigename darf nicht leer sein.',
  'Unsupported language.': 'Nicht unterstützte Sprache.',
  'This username is already taken.': 'Dieser Benutzername ist bereits vergeben.',
  'User not found.': 'Benutzer nicht gefunden.',
  'At least one active administrator must remain.': 'Es muss mindestens ein aktiver Administrator bestehen bleiben.',
  'You cannot disable yourself.': 'Du kannst dich nicht selbst deaktivieren.',
  'You cannot delete your own account.': 'Du kannst dein eigenes Konto nicht löschen.',
  'Project not found.': 'Projekt nicht gefunden.',
  'No write permission for this project.': 'Keine Schreibberechtigung für dieses Projekt.',
  'Please enter a name.': 'Bitte einen Namen angeben.',
  'No write permission for the parent project.': 'Keine Schreibberechtigung für das übergeordnete Projekt.',
  'Only the owner can move projects.': 'Nur der Eigentümer kann Projekte verschieben.',
  'The target must be one of your own projects.': 'Ziel muss ein eigenes Projekt sein.',
  'A project cannot be moved into itself.': 'Ein Projekt kann nicht in sich selbst verschoben werden.',
  'Only the owner can delete projects.': 'Nur der Eigentümer kann Projekte löschen.',
  'Only the owner can manage shares.': 'Nur der Eigentümer kann Freigaben verwalten.',
  'Invalid permission.': 'Ungültige Berechtigung.',
  'The owner already has full access.': 'Der Eigentümer hat bereits Vollzugriff.',
  'Harness not found.': 'Kabelbaum nicht gefunden.',
  'No write permission.': 'Keine Schreibberechtigung.',
  'The harness was changed in the meantime by {name}.': 'Der Kabelbaum wurde zwischenzeitlich von {name} geändert.',
  'someone else': 'jemand anderem',
  'No write permission for the target project.': 'Keine Schreibberechtigung für das Zielprojekt.',
  '{name} (copy)': '{name} (Kopie)',
  'Invalid category.': 'Ungültige Kategorie.',
  'Too much additional data.': 'Zu viele Zusatzdaten.',
  'Please enter a part number or a description.': 'Bitte Teilenummer oder Beschreibung angeben.',
  'Only administrators can create global parts.': 'Nur Administratoren können globale Teile anlegen.',
  'Part not found.': 'Teil nicht gefunden.',
  'No permission to edit.': 'Keine Berechtigung zum Bearbeiten.',
  'No permission to delete.': 'Keine Berechtigung zum Löschen.',
  'No permission.': 'Keine Berechtigung.',
  'PNG, JPEG, WebP or GIF up to 3 MB only.': 'Nur PNG, JPEG, WebP oder GIF bis 3 MB.',
  'Invalid request.': 'Ungültige Anfrage.',
  'Unknown endpoint.': 'Unbekannter Endpunkt.',
  'The data is too large.': 'Die Daten sind zu groß.',
  'Invalid JSON.': 'Ungültiges JSON.',
  'Internal server error.': 'Interner Serverfehler.',
  'Invalid document.': 'Ungültiges Dokument.',
  'Document without schema version.': 'Dokument ohne Schema-Version.',
  'The document was created by a newer program version.': 'Das Dokument stammt aus einer neueren Programmversion.',
  'Incomplete document: "{key}" is missing.': 'Dokument unvollständig: „{key}“ fehlt.',
  'Revision not found.': 'Revision nicht gefunden.',
  'Please enter a name for the revision.': 'Bitte einen Namen für die Revision angeben.',
  'Restored from revision "{name}"': 'Wiederhergestellt aus Revision „{name}“',
  'Automatic backup before restoring "{name}"': 'Automatische Sicherung vor Wiederherstellung von „{name}“',
  'A harness cannot embed itself.': 'Ein Kabelbaum kann sich nicht selbst einbetten.',
  'Embedding would create a loop ({path}).': 'Die Einbettung würde eine Schleife erzeugen ({path}).',
  'The CSV file contains no rows.': 'Die CSV-Datei enthält keine Zeilen.',
  'Too many rows (max. {n}).': 'Zu viele Zeilen (max. {n}).',
};

const DICTS = { de: DE };
export const LANGUAGES = ['de', 'en'];

export function langOf(req) {
  const h = String(req.headers['x-lang'] || '').toLowerCase();
  if (LANGUAGES.includes(h)) return h;
  if (req.user?.language && LANGUAGES.includes(req.user.language)) return req.user.language;
  const al = String(req.headers['accept-language'] || '').slice(0, 2).toLowerCase();
  return LANGUAGES.includes(al) ? al : 'de';
}

export function fill(s, params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

export function t(req, s, params) {
  const dict = DICTS[langOf(req)];
  return fill((dict && dict[s]) || s, params);
}
