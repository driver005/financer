import { registerRootComponent } from "expo";

import { registerIndexService } from "../../packages/shopping/src";
import App from "./src/App";

// Android keeps the app alive during an index run only while a foreground service runs: this has
// to be registered before the first render.
registerIndexService();
registerRootComponent(App);
