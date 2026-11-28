import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

// Cloudflare Turnstile (PRE-165): the bot check the API asks for before it
// mails a sign-in link. It stays invisible unless Cloudflare wants the
// person to click, and each token works once, so the form resets it after
// every send.

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      size: "flexible";
      theme: "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "before-interactive-callback": () => void;
    },
  ) => string;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// How long a send waits for a token still on its way.
const WAIT_MS = 10_000;

let loading: Promise<TurnstileApi> | null = null;
const loadTurnstile = () =>
  (loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error());
    script.onerror = () => {
      loading = null;
      reject(new Error());
    };
    document.head.appendChild(script);
  }));

export type TurnstileHandle = {
  /** The current token, waiting briefly for one; null if none came. */
  token: () => Promise<string | null>;
  /** Asks for a fresh token, after one was spent. */
  reset: () => void;
};

export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string }>(
  function Turnstile({ siteKey }, ref) {
    const container = useRef<HTMLDivElement>(null);
    const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
    const token = useRef<string | null>(null);
    const waiting = useRef<((token: string | null) => void)[]>([]);
    // Until Cloudflare asks for a click the widget is empty, and the
    // negative margin takes back the form's gap it would otherwise leave.
    const [shown, setShown] = useState(false);

    useEffect(() => {
      let gone = false;
      const settle = (value: string | null) => {
        token.current = value;
        if (value)
          for (const resolve of waiting.current.splice(0)) resolve(value);
      };
      void loadTurnstile()
        .then((api) => {
          if (gone || !container.current) return;
          widget.current = {
            api,
            id: api.render(container.current, {
              sitekey: siteKey,
              appearance: "interaction-only",
              size: "flexible",
              theme: document.documentElement.classList.contains("dark")
                ? "dark"
                : "light",
              callback: settle,
              "expired-callback": () => settle(null),
              "error-callback": () => settle(null),
              "before-interactive-callback": () => setShown(true),
            }),
          };
        })
        .catch(() => undefined);
      return () => {
        gone = true;
        if (widget.current) widget.current.api.remove(widget.current.id);
        widget.current = null;
      };
    }, [siteKey]);

    useImperativeHandle(ref, () => ({
      token: () =>
        token.current
          ? Promise.resolve(token.current)
          : new Promise((resolve) => {
              waiting.current.push(resolve);
              window.setTimeout(() => resolve(token.current), WAIT_MS);
            }),
      reset: () => {
        token.current = null;
        if (widget.current) widget.current.api.reset(widget.current.id);
      },
    }));

    return <div className={shown ? undefined : "-mt-6"} ref={container} />;
  },
);
