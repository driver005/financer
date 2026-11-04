// CI only (installed by `FINANCER_SMOKE=1 scripts/enable-embedded.sh`): before the app starts,
// start the Rust backend inside the app, import one transaction through it, read it back, and
// print one line that the emulator job looks for in logcat. Never part of a normal build.
const TAG = "FINANCER_SMOKE";
const log = (msg) => console.warn(`${TAG} ${msg}`);

// The backend answers the SDK's typed calls by name (`call(app, op, args_json) -> json_text`), the
// same calls the app makes; a refusal rejects.
const call = async (backend, op, args = {}) => JSON.parse(await backend.call("finance", op, JSON.stringify(args)));

(async () => {
  try {
    const { startEmbedded, EMPTY_EMBEDDED_SETTINGS, embeddedAvailable } = require("./src/native/embedded");
    const { toBase64 } = require("./src/native/base64");
    if (!embeddedAvailable) return log("FAIL the module is not in this build");
    const backend = await startEmbedded(EMPTY_EMBEDDED_SETTINGS);
    const csv =
      '"Buchungstag";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"Betrag"\n' +
      '"02.03.26";"Kartenzahlung";"REWE Markt";"";"-23,47"\n';
    const imp = await call(backend, "import_file", { kind: "csv", csv_base64: toBase64(new TextEncoder().encode(csv).buffer) });
    const rows = await call(backend, "list_transactions");
    const ok = Array.isArray(rows) && rows[0]?.category === "groceries";
    log(`${ok ? "OK" : "FAIL"} imported=${imp?.imported} category=${rows[0]?.category}`);
    if (ok) {
      // The screenshot job (native.yml) reuses this build: give the app demo data and open it in
      // on-phone mode, so the next start shows every screen filled in and skips the onboarding.
      try {
        const { seedDemo } = require("./scripts/demo-seed");
        const { setSecret } = require("./src/api/storage");
        const { MODE_KEY } = require("./src/api/keys");
        await setSecret(MODE_KEY, "embedded");
        console.warn(`FINANCER_DEMO ${await seedDemo((op, args) => call(backend, op, args))}`);
      } catch (e) {
        console.warn(`FINANCER_DEMO FAIL ${e && e.message ? e.message : e}`);
      }
    }
  } catch (e) {
    log(`FAIL ${e && e.stack ? e.stack : e}`);
  }
})();

require("expo-router/entry");
