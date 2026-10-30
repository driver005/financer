import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BackHandler } from "react-native";

export type Tab = "search" | "deals" | "plans" | "watches" | "more";

export type Route =
  | { name: "product"; id: string }
  | { name: "compare"; ids: string[]; category: string | null }
  | { name: "weights"; category: string }
  | { name: "categories" }
  | { name: "category"; id: string }
  | { name: "watch"; query?: string; category?: string | null }
  | { name: "settings" }
  | { name: "sources" };

type Nav = {
  tab: Tab;
  setTab(t: Tab): void;
  stack: Route[];
  push(r: Route): void;
  pop(): void;
  /** Leave the module (only meaningful inside another app). */
  exit?: () => void;
};

const Ctx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav must be used inside <ShoppingModule>");
  return v;
}

export function NavProvider({ children, exit }: { children: ReactNode; exit?: () => void }) {
  const [tab, setTab] = useState<Tab>("search");
  const [stack, setStack] = useState<Route[]>([]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 0) {
        pop();
        return true;
      }
      if (tab !== "search") {
        setTab("search");
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

  return <Ctx.Provider value={{ tab, setTab, stack, push, pop, exit }}>{children}</Ctx.Provider>;
}
