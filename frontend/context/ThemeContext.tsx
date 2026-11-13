"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type ThemePreset = "emerald" | "purple" | "blue" | "red" | "amber" | "obsidian";

export interface ThemeConfig {
  preset: ThemePreset;
  glassOpacity: number; // 0.1 to 0.95
  glassBlur: number;    // 8 to 48
  bgType: "glow" | "image" | "video";
  bgUrl: string;
  tintOpacity: number;  // 0.2 to 0.9
}

const DEFAULT_THEME: ThemeConfig = {
  preset: "emerald",
  glassOpacity: 0.78,
  glassBlur: 24,
  bgType: "glow",
  bgUrl: "",
  tintOpacity: 0.7,
};

interface ThemeContextType {
  theme: ThemeConfig;
  updateTheme: (partial: Partial<ThemeConfig>) => void;
  resetTheme: () => void;
  accentColors: {
    primary: string;
    border: string;
    glow: string;
    gradient: string;
    badge: string;
    radialOrb1: string;
    radialOrb2: string;
  };
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEME_PRESETS: Record<
  ThemePreset,
  {
    name: string;
    primary: string;
    border: string;
    glow: string;
    gradient: string;
    badge: string;
    radialOrb1: string;
    radialOrb2: string;
  }
> = {
  emerald: {
    name: "Emerald Mint",
    primary: "#10b981",
    border: "rgba(52, 211, 153, 0.4)",
    glow: "rgba(16, 185, 129, 0.35)",
    gradient: "from-emerald-400 via-teal-400 to-cyan-500",
    badge: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
    radialOrb1: "#064E3B",
    radialOrb2: "#1E1B4B",
  },
  purple: {
    name: "Royal Purple",
    primary: "#a855f7",
    border: "rgba(192, 132, 252, 0.4)",
    glow: "rgba(168, 85, 247, 0.35)",
    gradient: "from-purple-400 via-fuchsia-400 to-indigo-500",
    badge: "bg-purple-500/15 border-purple-500/30 text-purple-300",
    radialOrb1: "#3B0764",
    radialOrb2: "#1E1B4B",
  },
  blue: {
    name: "Electric Blue",
    primary: "#3b82f6",
    border: "rgba(96, 165, 250, 0.4)",
    glow: "rgba(59, 130, 246, 0.35)",
    gradient: "from-blue-400 via-cyan-400 to-teal-400",
    badge: "bg-blue-500/15 border-blue-500/30 text-blue-300",
    radialOrb1: "#1E3A8A",
    radialOrb2: "#0F172A",
  },
  red: {
    name: "Crimson Red",
    primary: "#f43f5e",
    border: "rgba(251, 113, 133, 0.4)",
    glow: "rgba(244, 63, 94, 0.35)",
    gradient: "from-rose-400 via-pink-400 to-red-500",
    badge: "bg-rose-500/15 border-rose-500/30 text-rose-300",
    radialOrb1: "#881337",
    radialOrb2: "#1E1B4B",
  },
  amber: {
    name: "Warm Amber",
    primary: "#f59e0b",
    border: "rgba(251, 191, 36, 0.4)",
    glow: "rgba(245, 158, 11, 0.35)",
    gradient: "from-amber-400 via-orange-400 to-yellow-500",
    badge: "bg-amber-500/15 border-amber-500/30 text-amber-300",
    radialOrb1: "#78350F",
    radialOrb2: "#1E1B4B",
  },
  obsidian: {
    name: "Midnight Obsidian",
    primary: "#64748b",
    border: "rgba(148, 163, 184, 0.3)",
    glow: "rgba(100, 116, 139, 0.25)",
    gradient: "from-slate-300 via-gray-400 to-zinc-500",
    badge: "bg-slate-500/15 border-slate-500/30 text-slate-300",
    radialOrb1: "#0F172A",
    radialOrb2: "#020617",
  },
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("khataflow_theme_config");
      if (stored) {
        setTheme({ ...DEFAULT_THEME, ...JSON.parse(stored) });
      }
    } catch (e) {
      console.warn("Could not load theme from localStorage:", e);
    }
  }, []);

  const updateTheme = (partial: Partial<ThemeConfig>) => {
    setTheme((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem("khataflow_theme_config", JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const resetTheme = () => {
    setTheme(DEFAULT_THEME);
    try {
      localStorage.removeItem("khataflow_theme_config");
    } catch (e) {}
  };

  const currentPreset = THEME_PRESETS[theme.preset] || THEME_PRESETS.emerald;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        updateTheme,
        resetTheme,
        accentColors: currentPreset,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
