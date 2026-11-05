import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BackHandler } from "react-native";

import type { TemplateKind } from "../api/types";

export type Tab = "chats" | "calendar" | "templates" | "mailbox";

export type Route =
  | { name: "chat"; key: string }
  /** A new message: the people it goes to and the subject are filled in when known. */
  | { name: "compose"; to?: string; subject?: string }
  | { name: "template"; id?: number; kind?: TemplateKind };

type Nav = {
  tab: Tab;
  setTab(t: Tab): void;
  stack: Route[];
  push(r: Route): void;
  pop(): void;
  /** Back to the tab's own screen. */
  reset(): void;
  exit?: () => void;
};

const Ctx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav must be used inside <MailModule>");
  return v;
}

export function NavProvider({ children, exit: hostExit, embedded }: { children: ReactNode; exit?: () => void; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("chats");
  const [stack, setStack] = useState<Route[]>([]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const reset = useCallback(() => setStack([]), []);
  // in a host's tab the module has no way out of its own; the other tabs go back to the chats
  const exit = embedded ? (tab !== "chats" ? () => setTab("chats") : undefined) : hostExit;

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 0) {
        pop();
        return true;
      }
      if (tab !== "chats") {
        setTab("chats");
        return true;
      }
      if (exit) {
        exit();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack, tab, pop, exit]);

  return <Ctx.Provider value={{ tab, setTab, stack, push, pop, reset, exit }}>{children}</Ctx.Provider>;
}
