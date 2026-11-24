"use client";

import type { LottieRefCurrentProps } from "lottie-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";

import { spiralFastData, spiralSlowData } from "./spiral-loader-data";
import { cn } from "./utils/cn";

const FAST_REPEATS = 4;
const SLOW_REPEATS = 2;

type LottieComponent = ComponentType<{
  lottieRef?: React.RefObject<LottieRefCurrentProps | null>;
  animationData: unknown;
  loop?: boolean;
  autoplay?: boolean;
  onComplete?: () => void;
  style?: React.CSSProperties;
}>;

export type SpiralLoaderProps = {
  size?: number;
  className?: string;
};

function useIsDark() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function SpiralLoader({ size = 16, className }: SpiralLoaderProps) {
  const [Lottie, setLottie] = useState<LottieComponent | null>(null);
  const [phase, setPhase] = useState<"fast" | "slow">("fast");
  const repeatCountRef = useRef(0);
  const fastRef = useRef<LottieRefCurrentProps | null>(null);
  const slowRef = useRef<LottieRefCurrentProps | null>(null);
  const isDark = useIsDark();

  useEffect(() => {
    let cancelled = false;
    void import("lottie-react").then((mod) => {
      if (cancelled) return;
      // Vite/CJS interop can nest the component under default.default.
      const exported = mod.default as unknown;
      const nested =
        exported !== null &&
        typeof exported === "object" &&
        "default" in exported
          ? (exported as { default: unknown }).default
          : null;
      const candidate =
        typeof exported === "function"
          ? exported
          : typeof nested === "function"
            ? nested
            : null;
      if (candidate) {
        setLottie(() => candidate as LottieComponent);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const startFastPhase = useCallback(() => {
    repeatCountRef.current = 0;
    setPhase("fast");
    slowRef.current?.stop();
    fastRef.current?.goToAndPlay(0, true);
  }, []);

  const startSlowPhase = useCallback(() => {
    repeatCountRef.current = 0;
    setPhase("slow");
    fastRef.current?.stop();
    slowRef.current?.goToAndPlay(0, true);
  }, []);

  const handleFastComplete = useCallback(() => {
    repeatCountRef.current += 1;
    if (repeatCountRef.current < FAST_REPEATS) {
      fastRef.current?.goToAndPlay(0, true);
    } else {
      startSlowPhase();
    }
  }, [startSlowPhase]);

  const handleSlowComplete = useCallback(() => {
    repeatCountRef.current += 1;
    if (repeatCountRef.current < SLOW_REPEATS) {
      slowRef.current?.goToAndPlay(0, true);
    } else {
      startFastPhase();
    }
  }, [startFastPhase]);

  if (!Lottie) return null;
  const needsInvert = !isDark;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-75",
          needsInvert && "invert",
          phase === "fast" ? "opacity-100" : "opacity-0",
        )}
      >
        <Lottie
          lottieRef={fastRef}
          animationData={spiralFastData}
          loop={false}
          autoplay={true}
          onComplete={handleFastComplete}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-75",
          needsInvert && "invert",
          phase === "slow" ? "opacity-100" : "opacity-0",
        )}
      >
        <Lottie
          lottieRef={slowRef}
          animationData={spiralSlowData}
          loop={false}
          autoplay={false}
          onComplete={handleSlowComplete}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
