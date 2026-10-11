# Mascot (Rive)

The Today screen has a mascot slot (`apps/mobile/src/components/Mascot.tsx`). Today it shows a
pig emoji that bobs and reacts to a **mood** (`happy`, `cheer`, `worried`, chosen from your real
data in `moodFor`, unit-tested). The plan is to replace the emoji with a Rive character, the tool
Duolingo uses for its mascots. This needs a file only you can get, and a native build.

## 1. Get a mascot

Rive marketplace: <https://rive.app/marketplace> (search "mascot"). Look for a listing that
- includes a **state machine** with expressions (happy / celebrating / sad or worried),
- gives you the **`.riv` file** (some listings only allow viewing; one report says exporting `.riv`
  from your own Rive account needs a paid plan),
- has a licence that allows use in an app.

Alternatives: a Rive freelancer (about $300 to $4,000+ depending on scope), or build one with
Rive's own tutorials.

## 2. What the app expects

Put the file at `apps/mobile/assets/mascot.riv`. The app will drive it with one state-machine
input named `mood` (number): `0` happy, `1` cheer, `2` worried. If your file uses other input
names or triggers, tell me the names and I will map them.

## 3. Runtime

Rive's React Native runtime is a native module, so it **does not run in Expo Go**. It needs a
custom build (`eas build` or a local dev build, see `EMBEDDED.md`, which already needs one). I
have not verified which Rive package version works with Expo SDK 57, so the first step after you
send the file is to install and check that, then wire `Mascot.tsx` with the emoji as fallback for
Expo Go and the web build.
