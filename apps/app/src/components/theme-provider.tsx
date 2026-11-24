import { ScriptOnce } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: "dark" | "light" | undefined;
  setTheme: (theme: Theme) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined,
);

function getStoredTheme(storageKey: string): Theme | null {
  let stored: string | null = null;

  try {
    stored = window.localStorage?.getItem(storageKey) ?? null;
  } catch {
    // Cookie fallback below covers storage-denied browser contexts.
  }

  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${storageKey}=`))
    ?.slice(storageKey.length + 1);

  return cookie === "light" || cookie === "dark" || cookie === "system"
    ? cookie
    : null;
}

function storeTheme(storageKey: string, theme: Theme) {
  try {
    window.localStorage?.setItem(storageKey, theme);
  } catch {
    // Privacy-restricted contexts fall through to the cookie below.
  }
  // Always mirror to a cookie so SSR/future loads can agree with ThemeScript.
  document.cookie = `${storageKey}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

function resolveTheme(theme: Theme): "dark" | "light" {
  return theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
}

function applyTheme(theme: Theme) {
  const resolvedTheme = resolveTheme(theme);
  const root = document.documentElement;
  if (!root.classList.contains(resolvedTheme)) {
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }
  root.style.colorScheme = resolvedTheme;
  root.style.backgroundColor = "var(--surface-1)";
  return resolvedTheme;
}

function getThemeScript(storageKey: string, defaultTheme: Theme) {
  const key = JSON.stringify(storageKey);
  const fallback = JSON.stringify(defaultTheme);

  return `(function(){try{var t=null;try{t=localStorage.getItem(${key})}catch(e){}if(t!=='light'&&t!=='dark'&&t!=='system'){var p=${key}+'=';var c=document.cookie.split('; ').find(function(v){return v.indexOf(p)===0});t=c?c.slice(p.length):${fallback}}if(t!=='light'&&t!=='dark'&&t!=='system'){t=${fallback}}var d=matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='system'?(d?'dark':'light'):t;var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;e.style.backgroundColor='var(--surface-1)'}catch(e){var r=${fallback}==='dark'?'dark':'light';var d=document.documentElement;d.classList.remove('light','dark');d.classList.add(r);d.style.colorScheme=r;d.style.backgroundColor='var(--surface-1)'}})();`;
}

function ThemeScript({
  defaultTheme = "system",
  storageKey = "preprocess-theme",
}: Omit<ThemeProviderProps, "children">) {
  return <ScriptOnce>{getThemeScript(storageKey, defaultTheme)}</ScriptOnce>;
}

function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "preprocess-theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<
    "dark" | "light" | undefined
  >(undefined);
  const [mounted, setMounted] = useState(false);

  // Sync before paint so chrome that waits on resolvedTheme never shows the
  // wrong glyph. ThemeScript already set the document class.
  useLayoutEffect(() => {
    const nextTheme = getStoredTheme(storageKey) ?? defaultTheme;
    setThemeState(nextTheme);
    setResolvedTheme(applyTheme(nextTheme));
    setMounted(true);
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    if (!mounted) return;
    setResolvedTheme(applyTheme(theme));
  }, [mounted, theme]);

  useEffect(() => {
    if (!mounted || theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mounted, theme]);

  const setTheme = (nextTheme: Theme) => {
    storeTheme(storageKey, nextTheme);
    setThemeState(nextTheme);
  };

  return (
    <ThemeProviderContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export { ThemeProvider, ThemeScript, useTheme };
