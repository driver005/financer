export declare const LOCAL_HOSTS: string[];
export declare function isLocalHost(host: string): boolean;
export declare function parseSeedArgs(
  argv: string[],
  env: Record<string, string | undefined>,
):
  | { ok: true; reset: boolean; allowRemote: boolean; host: string; url: string; key: string }
  | { ok: false; error: string };
export declare function defaultCategoriesFromSchema(
  sql: string,
): { name: string; kind: string; color: string }[];
