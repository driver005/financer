// Android: lets Notifee's foreground service run as a "data sync" service, which Android 14 and
// later require to be declared, and adds the permissions that goes with it. Without this the
// progress notification still works; the index run then pauses when the app is not in front.
// This file lives outside the app, so `require("expo/config-plugins")` would look in the wrong
// place: resolve it from the app that is being built (the working directory of the Expo CLI).
const { withAndroidManifest, AndroidConfig } = require(require.resolve("expo/config-plugins", { paths: [process.cwd()] }));

const PERMISSIONS = ["android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_DATA_SYNC", "android.permission.POST_NOTIFICATIONS"];

function withIndexService(config) {
  config = withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] ?? "http://schemas.android.com/tools";
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== "app.notifee.core.ForegroundService");
    app.service.push({
      $: {
        "android:name": "app.notifee.core.ForegroundService",
        "android:foregroundServiceType": "dataSync",
        "android:exported": "false",
        "tools:replace": "android:foregroundServiceType",
      },
    });
    return c;
  });
  return AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
}

module.exports = withIndexService;
