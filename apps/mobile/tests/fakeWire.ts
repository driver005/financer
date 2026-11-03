import { bind, type App } from "../../../packages/wire/src";
import { Api, ApiError } from "../src/api/client";

export type Call = { app: App; op: string; args: Record<string, unknown> };

/** A refusal as the generated bindings raise it. */
export const refusal = (status: number, message: string, problems: string[] = []) => Object.assign(new Error("Api"), { inner: { status, message, problems } });

/**
 * The finance API over a wire that answers with `answer(op, args)`: a JSON value, `undefined` for a
 * call that answers nothing, or an Error to refuse. Every call is remembered.
 */
export function apiWith(answer: (op: string, args: Record<string, unknown>, call: Call) => unknown = () => ({})) {
  const calls: Call[] = [];
  const wire = {
    async call(app: App, op: string, args: string) {
      const call = { app, op, args: JSON.parse(args) as Record<string, unknown> };
      calls.push(call);
      const a = answer(op, call.args, call);
      if (a instanceof Error) throw a;
      return a === undefined ? "null" : JSON.stringify(a);
    },
  };
  return { api: new Api(bind(wire, "finance", ApiError)), calls };
}
