// CI only (installed by `FINANCER_SMOKE=1 scripts/enable-embedded.sh`): before the app starts,
// start the Rust backend inside the app, import one transaction through it, read it back, and
// print one line that the emulator job looks for in logcat. Never part of a normal build.
const TAG = "FINANCER_SMOKE";
const log = (msg) => console.warn(`${TAG} ${msg}`);

(async () => {
  try {
    const { startEmbedded, EMPTY_EMBEDDED_SETTINGS, embeddedAvailable } = require("./src/native/embedded");
    const { EmbeddedTransport } = require("./src/api/transport");
    if (!embeddedAvailable) return log("FAIL the module is not in this build");
    const backend = await startEmbedded(EMPTY_EMBEDDED_SETTINGS);
    const t = new EmbeddedTransport(backend);
    const health = await t.send({ method: "GET", path: "/health" });
    const csv =
      '"Buchungstag";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"Betrag"\n' +
      '"02.03.26";"Kartenzahlung";"REWE Markt";"";"-23,47"\n';
    const imp = await t.send({ method: "POST", path: "/v1/transactions/import", headers: { "Content-Type": "text/csv" }, body: csv });
    const list = await t.send({ method: "GET", path: "/v1/transactions" });
    const rows = JSON.parse(list.text);
    const ok = health.status === 200 && health.text === "ok" && imp.status === 200 && rows[0]?.category === "groceries";
    log(`${ok ? "OK" : "FAIL"} health=${health.status}:${health.text} import=${imp.status} category=${rows[0]?.category}`);
  } catch (e) {
    log(`FAIL ${e && e.stack ? e.stack : e}`);
  }
})();

require("expo-router/entry");
