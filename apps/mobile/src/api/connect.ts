import { bind, type WireLike } from "../../../../packages/wire/src";
import { wireFor } from "../../../../packages/wire/src/connect";

import { Api, ApiError, type ApiConfig } from "./client";

export { NO_SDK } from "../../../../packages/wire/src/connect";

/** The finance API of a server, through the Rust SDK. Rejects when this build has none. */
export async function connectApi(config: ApiConfig): Promise<Api> {
  const wire = await wireFor(config);
  return new Api(bind(wire, "finance", ApiError), () => wire.health());
}

/** The finance API of the backend inside the app (it answers the same calls, in process). */
export function embeddedApi(backend: WireLike): Api {
  return new Api(bind(backend, "finance", ApiError));
}
