"use client";

import * as React from "react";
import { useTheme } from "next-themes";

type OscilloscopeCurtainBackgroundProps = {
  className?: string;
};

type Palette = {
  top: string;
  bottom: string;
  centerQuiet: string;
  edgeFog: string;
  ribbonA: string;
  ribbonB: string;
  ribbonC: string;
  band: string;
  vignette: string;
};

const MAX_DPR = 2;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function createPalette(isDark: boolean): Palette {
  if (isDark) {
    return {
      top: "#0a111b",
      bottom: "#131c2b",
      centerQuiet: "rgba(5, 10, 18, 0.5)",
      edgeFog: "rgba(18, 31, 45, 0.28)",
      ribbonA: "rgba(94, 220, 212, 0.25)",
      ribbonB: "rgba(183, 225, 131, 0.2)",
      ribbonC: "rgba(241, 179, 96, 0.18)",
      band: "rgba(128, 193, 216, 0.08)",
      vignette: "rgba(1, 4, 9, 0.52)",
    };
  }

  return {
    top: "#f5f7fb",
    bottom: "#e8edf4",
    centerQuiet: "rgba(255, 255, 255, 0.48)",
    edgeFog: "rgba(189, 203, 221, 0.28)",
    ribbonA: "rgba(39, 79, 124, 0.2)",
    ribbonB: "rgba(62, 102, 87, 0.18)",
    ribbonC: "rgba(111, 90, 57, 0.16)",
    band: "rgba(90, 128, 167, 0.07)",
    vignette: "rgba(26, 39, 54, 0.16)",
  };
}

function addReducedMotionListener(
  callback: (isReduced: boolean) => void,
) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);

  const handleChange = () => {
    callback(mediaQuery.matches);
  };

  handleChange();

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }

  mediaQuery.addListener(handleChange);
  return () => mediaQuery.removeListener(handleChange);
}

export function OscilloscopeCurtainBackground({
  className,
}: OscilloscopeCurtainBackgroundProps) {
  const { resolvedTheme } = useTheme();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    let reducedMotion = false;
    let animationFrame = 0;
    const seed = Math.random() * 1000;
    const palette = createPalette(resolvedTheme !== "light");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawScene = (time: number) => {
      context.clearRect(0, 0, cssWidth, cssHeight);

      const centerX = cssWidth * 0.5;
      const centerY = cssHeight * 0.5;
      const minSide = Math.min(cssWidth, cssHeight);
      const maxSide = Math.max(cssWidth, cssHeight);

      const bgGradient = context.createLinearGradient(0, 0, 0, cssHeight);
      bgGradient.addColorStop(0, palette.top);
      bgGradient.addColorStop(1, palette.bottom);
      context.fillStyle = bgGradient;
      context.fillRect(0, 0, cssWidth, cssHeight);

      const fog = context.createRadialGradient(
        centerX,
        centerY,
        minSide * 0.2,
        centerX,
        centerY,
        maxSide * 0.82,
      );
      fog.addColorStop(0, "rgba(0, 0, 0, 0)");
      fog.addColorStop(1, palette.edgeFog);
      context.fillStyle = fog;
      context.fillRect(0, 0, cssWidth, cssHeight);

      const curtainCount = Math.max(9, Math.round(cssWidth / 140));
      const yStep = clamp(cssHeight / 90, 7, 14);
      const ribbons = [palette.ribbonA, palette.ribbonB, palette.ribbonC];

      for (let i = 0; i < curtainCount; i += 1) {
        const u = curtainCount === 1 ? 0.5 : i / (curtainCount - 1);
        const edgeDistance = Math.abs(u - 0.5) * 2;
        const centerMask = smoothstep(0.1, 0.9, edgeDistance);
        const alpha = (0.05 + 0.16 * centerMask) * (reducedMotion ? 0.9 : 1);
        const baseX =
          cssWidth * u +
          Math.sin(time * 0.09 + seed * 0.15 + i * 0.37) * (14 + edgeDistance * 20);
        const amplitude = 16 + edgeDistance * 48;
        const frequency = 0.006 + i * 0.00043;
        const speed = 0.35 + edgeDistance * 0.65;
        const lissajousSpread = 0.5 + edgeDistance * 1.4;

        context.beginPath();
        for (let y = -8; y <= cssHeight + 8; y += yStep) {
          const wave1 = Math.sin(y * frequency + time * speed + seed + i * 0.9);
          const wave2 = Math.sin(
            y * (frequency * 0.52) -
              time * (speed * 0.63) +
              seed * 1.3 +
              i * 1.7,
          );
          const lissajous = Math.sin(
            (y * 0.0031 + seed * 0.2 + i * 0.15) * (1.8 + lissajousSpread) +
              Math.cos(time * 0.24 + i * 0.37),
          );

          const x =
            baseX +
            (wave1 * 0.62 + wave2 * 0.3 + lissajous * 0.42) * amplitude;

          if (y <= -8) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.strokeStyle = ribbons[i % ribbons.length];
        context.globalAlpha = alpha;
        context.lineWidth = 0.8 + edgeDistance * 1.4;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();

        context.globalAlpha = alpha * 0.5;
        context.lineWidth += 2.2;
        context.stroke();
      }

      context.globalAlpha = 1;

      const bandCount = 5;
      for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
        const yCenter =
          ((bandIndex + 0.5) / bandCount) * cssHeight +
          Math.sin(time * 0.16 + seed * 0.4 + bandIndex * 1.27) * cssHeight * 0.05;
        const bandHeight = cssHeight * (0.06 + (bandIndex % 2) * 0.02);
        const bandGradient = context.createLinearGradient(
          0,
          yCenter - bandHeight,
          0,
          yCenter + bandHeight,
        );
        bandGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
        bandGradient.addColorStop(0.5, palette.band);
        bandGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.fillStyle = bandGradient;
        context.fillRect(0, yCenter - bandHeight, cssWidth, bandHeight * 2);
      }

      const centerQuiet = context.createRadialGradient(
        centerX,
        centerY,
        minSide * 0.08,
        centerX,
        centerY,
        minSide * 0.56,
      );
      centerQuiet.addColorStop(0, palette.centerQuiet);
      centerQuiet.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = centerQuiet;
      context.fillRect(0, 0, cssWidth, cssHeight);

      const vignette = context.createRadialGradient(
        centerX,
        centerY,
        minSide * 0.3,
        centerX,
        centerY,
        maxSide * 0.85,
      );
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, palette.vignette);
      context.fillStyle = vignette;
      context.fillRect(0, 0, cssWidth, cssHeight);
    };

    const renderFrame = (timestamp: number) => {
      const time = timestamp * 0.001;
      drawScene(time);
      if (!reducedMotion) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    const stop = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = 0;
    };

    const start = () => {
      stop();
      if (reducedMotion) {
        drawScene(seed * 0.01);
      } else {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      start();
    });
    resizeObserver.observe(canvas);

    const removeReducedMotionListener = addReducedMotionListener((matches) => {
      reducedMotion = matches;
      start();
    });

    resize();
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      removeReducedMotionListener();
    };
  }, [resolvedTheme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ""}`}
    />
  );
}
