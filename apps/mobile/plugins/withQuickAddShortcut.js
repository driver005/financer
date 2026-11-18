const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const SHORTCUTS = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
    android:shortcutId="quick_add"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/quick_add_short"
    android:shortcutLongLabel="@string/quick_add_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="pantry://quickadd" />
  </shortcut>
</shortcuts>
`;

/** Adds a long-press app shortcut that deep-links into the quick-add screen. */
module.exports = function withQuickAddShortcut(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    app["meta-data"] = app["meta-data"] || [];
    app["meta-data"].push({
      $: {
        "android:name": "android.app.shortcuts",
        "android:resource": "@xml/shortcuts",
      },
    });
    return mod;
  });

  config = withDangerousMod(config, [
    "android",
    (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "shortcuts.xml"), SHORTCUTS);

      const valuesDir = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res/values");
      fs.mkdirSync(valuesDir, { recursive: true });
      const stringsPath = path.join(valuesDir, "shortcuts-strings.xml");
      fs.writeFileSync(
        stringsPath,
        `<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="quick_add_short">Add</string><string name="quick_add_long">Add transaction</string></resources>\n`,
      );
      return mod;
    },
  ]);

  return config;
};
