import { useEffect } from "react";
import { Linking, Platform } from "react-native";
import { Box, Button, ScanFrame, Spinner, Text } from "@financer/ui";

import { loadCamera } from "@/native/camera";
import { BARCODE_TYPES } from "@/scan";

type CameraModule = NonNullable<ReturnType<typeof loadCamera>>;

/** True where a camera can be offered at all (not on the web, not without the native module). */
export function cameraAvailable(): boolean {
  return loadCamera() !== null;
}

/**
 * Live camera view that reports every barcode it reads (also the same one many times; the
 * caller filters). Handles the permission: asks, and explains how to turn it on again when the
 * person has said no for good.
 */
export function BarcodeScanner({ onCode }: { onCode: (data: string) => void }) {
  const cam = loadCamera();
  if (!cam) return null;
  return <Scanner cam={cam} onCode={onCode} />;
}

function Scanner({ cam, onCode }: { cam: CameraModule; onCode: (data: string) => void }) {
  const [permission, request] = cam.useCameraPermissions();

  useEffect(() => {
    // first time: ask right away, the person just pressed "Scan with camera"
    if (permission && !permission.granted && permission.canAskAgain && permission.status === "undetermined") {
      void request();
    }
  }, [permission, request]);

  if (!permission) return <Spinner />;

  if (!permission.granted) {
    return (
      <Box gap="sm">
        <Text variant="bodyStrong">Camera access is off</Text>
        <Text variant="label" tone="muted">
          {permission.canAskAgain
            ? "Financer needs the camera to read barcodes. Nothing is recorded or uploaded; only the number is looked up."
            : "You turned camera access off for Financer. Turn it on in the system settings, or type the number under the barcode."}
        </Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" icon="camera" onPress={() => void request()} />
        ) : Platform.OS !== "web" ? (
          <Button label="Open system settings" icon="cog-outline" variant="outline" onPress={() => void Linking.openSettings()} />
        ) : null}
      </Box>
    );
  }

  return (
    <ScanFrame
      live
      tall
      hint="Hold the barcode inside the frame"
      camera={cam.CameraView as never}
      cameraProps={{
        facing: "back",
        barcodeScannerSettings: { barcodeTypes: [...BARCODE_TYPES] },
        onBarcodeScanned: (e: { data: string }) => onCode(e.data),
        accessibilityLabel: "Camera view for scanning a barcode",
      }}
    />
  );
}
