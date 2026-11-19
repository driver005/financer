const { withGradleProperties } = require("@expo/config-plugins");

/** Plaid's native SDK requires minSdk 25. Expo SDK 58 reads it from a Gradle property. */
module.exports = function withMinSdk(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter((item) => item.key !== "android.minSdkVersion");
    mod.modResults.push({ type: "property", key: "android.minSdkVersion", value: "25" });
    return mod;
  });
};
