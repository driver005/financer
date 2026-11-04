// CI only (installed by `FINANCER_SMOKE=1 scripts/enable-embedded.sh`): before the app starts,
// start the Rust backend inside the app, import one transaction through it, read it back, and
// print one line that the emulator job looks for in logcat. Never part of a normal build.
const TAG = "FINANCER_SMOKE";
const log = (msg) => console.warn(`${TAG} ${msg}`);

(async () => {
  try {
    const { startEmbedded, EMPTY_EMBEDDED_SETTINGS, embeddedAvailable } = require("./src/native/embedded");
    const { embeddedApi } = require("./src/api/connect");
    if (!embeddedAvailable) return log("FAIL the module is not in this build");
    const backend = await startEmbedded(EMPTY_EMBEDDED_SETTINGS);
    // the same calls the screens make: by name, through the backend inside the app
    const api = embeddedApi(backend);
    const csv =
      '"Buchungstag";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"Betrag"\n' +
      '"02.03.26";"Kartenzahlung";"REWE Markt";"";"-23,47"\n';
    const bytes = Uint8Array.from(csv, (c) => c.charCodeAt(0)); // ASCII only
    const imp = await api.importFile("csv", bytes.buffer);
    const rows = await api.transactions();
    const ok = imp.imported === 1 && rows[0]?.category === "groceries";
    log(`${ok ? "OK" : "FAIL"} imported=${imp.imported} category=${rows[0]?.category}`);
    if (ok) {
      // The screenshot job (native.yml) reuses this build: give the app demo data and open it in
      // on-phone mode, so the next start shows every screen filled in and skips the onboarding.
      try {
        const { seedDemo } = require("./scripts/demo-seed");
        const { setSecret } = require("./src/api/storage");
        const { MODE_KEY } = require("./src/api/keys");
        await setSecret(MODE_KEY, "embedded");
        console.warn(`FINANCER_DEMO ${await seedDemo(api)}`);
      } catch (e) {
        console.warn(`FINANCER_DEMO FAIL ${e && e.message ? e.message : e}`);
      }
    }
  } catch (e) {
    log(`FAIL ${e && e.stack ? e.stack : e}`);
  }
})();

require("expo-router/entry");
