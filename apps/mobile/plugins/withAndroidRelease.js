// Release builds of the Android app are not shrunk or obfuscated.
//
// Expo SDK 58's generated project turns R8 on for release builds (android.enableMinifyInReleaseBuilds=true).
// With it the app crashed on start, before any of our code ran: AndroidX WorkManager (used by the
// background task) could not create its Room database ("Failed to create an instance of class
// androidx.work.impl.WorkDatabase"), because the shrinker removed what Room looks up by name. SDK 57
// did not shrink, and this app is installed from a file, not shipped through the Play Store, so
// the size saving is not worth that risk. Set this to "true" again only together with keep rules
// for Room and WorkManager, and check on an emulator (the android-emulator job in native.yml).
const { withGradleProperties } = require("expo/config-plugins");

const PROPERTIES = {
  "android.enableMinifyInReleaseBuilds": "false",
  "android.enableShrinkResourcesInReleaseBuilds": "false",
};

function setProperties(modResults) {
  const rest = modResults.filter((item) => !(item.type === "property" && item.key in PROPERTIES));
  return [...rest, ...Object.entries(PROPERTIES).map(([key, value]) => ({ type: "property", key, value }))];
}

module.exports = function withAndroidRelease(config) {
  return withGradleProperties(config, (c) => {
    c.modResults = setProperties(c.modResults);
    return c;
  });
};
module.exports.setProperties = setProperties;
