"use client";

import React, { useState } from "react";
import { useTheme, THEME_PRESETS, ThemePreset } from "@/context/ThemeContext";
import { Sliders, Palette, Image as ImageIcon, Video, RotateCcw, Upload, Check, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

const PRESET_WALLPAPERS = [
  {
    name: "Obsidian Deep Mesh",
    type: "glow" as const,
    url: "",
    preview: "from-emerald-950 via-slate-900 to-indigo-950",
  },
  {
    name: "Cosmic Nebula",
    type: "image" as const,
    url: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1920&q=80",
    preview: "from-purple-900 via-indigo-950 to-black",
  },
  {
    name: "Cyber Tokyo Rain",
    type: "image" as const,
    url: "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=1920&q=80",
    preview: "from-blue-900 via-teal-950 to-slate-950",
  },
  {
    name: "Nordic Minimalist Dark",
    type: "image" as const,
    url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80",
    preview: "from-cyan-950 via-slate-900 to-black",
  },
];

export const SettingsTab: React.FC = () => {
  const { theme, updateTheme, resetTheme, accentColors } = useTheme();
  const [customUrl, setCustomUrl] = useState(theme.bgUrl || "");
  const [activeMediaType, setActiveMediaType] = useState<"image" | "video">("image");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const blobUrl = URL.createObjectURL(file);
    updateTheme({
      bgType: isVideo ? "video" : "image",
      bgUrl: blobUrl,
    });
  };

  const handleApplyUrl = () => {
    if (!customUrl.trim()) return;
    updateTheme({
      bgType: activeMediaType,
      bgUrl: customUrl.trim(),
    });
  };

  return (
    <div className="h-full w-full overflow-y-auto pr-2 space-y-6">
      {/* Studio Banner */}
      <div className="p-6 rounded-3xl glass-panel relative overflow-hidden flex items-center justify-between">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.08] text-white/70 uppercase tracking-wider font-semibold border border-white/10">
              Spatial Glassmorphism Studio
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Appearance & Wallpaper Engine
          </h2>
          <p className="text-xs text-white/50 max-w-lg mt-1">
            Fine-tune tactile glass opacity, backdrop blur, ambient laser lighting, or set custom looping wallpapers with dynamic glass tinting.
          </p>
        </div>

        <button
          onClick={resetTheme}
          className="relative z-10 px-4 py-2 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white/80 flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to Default
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Glass Transparency & Blur Sliders */}
        <div className="p-6 rounded-3xl glass-panel space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.06]">
            <div className="h-8 w-8 rounded-xl bg-white/[0.06] flex items-center justify-center text-emerald-400">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Glass Physics & Optics</h3>
              <p className="text-[11px] text-white/40">Adjust physical card transparency and blur density</p>
            </div>
          </div>

          {/* Opacity Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-white/70 font-medium">Card Glass Opacity</span>
              <span className="font-mono text-emerald-400 font-bold">{Math.round(theme.glassOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.95"
              step="0.02"
              value={theme.glassOpacity}
              onChange={(e) => updateTheme({ glassOpacity: parseFloat(e.target.value) })}
              className="w-full accent-emerald-400 h-1.5 bg-white/10 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-white/30 font-mono">
              <span>Ultra-Clear (10%)</span>
              <span>Solid Matte (95%)</span>
            </div>
          </div>

          {/* Blur Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-white/70 font-medium">Backdrop Blur Intensity</span>
              <span className="font-mono text-emerald-400 font-bold">{theme.glassBlur}px</span>
            </div>
            <input
              type="range"
              min="8"
              max="48"
              step="2"
              value={theme.glassBlur}
              onChange={(e) => updateTheme({ glassBlur: parseInt(e.target.value) })}
              className="w-full accent-emerald-400 h-1.5 bg-white/10 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-white/30 font-mono">
              <span>Subtle (8px)</span>
              <span>Ultra Frosted (48px)</span>
            </div>
          </div>

          {/* Glass Tint Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-white/70 font-medium">Dark Background Tint Level</span>
              <span className="font-mono text-emerald-400 font-bold">{Math.round(theme.tintOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="0.95"
              step="0.05"
              value={theme.tintOpacity}
              onChange={(e) => updateTheme({ tintOpacity: parseFloat(e.target.value) })}
              className="w-full accent-emerald-400 h-1.5 bg-white/10 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-white/30 font-mono">
              <span>Vibrant Media (20%)</span>
              <span>High Contrast Dark (95%)</span>
            </div>
          </div>
        </div>

        {/* 2. Ambient Theme Accent Presets */}
        <div className="p-6 rounded-3xl glass-panel space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.06]">
            <div className="h-8 w-8 rounded-xl bg-white/[0.06] flex items-center justify-center text-purple-400">
              <Palette className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Ambient Glow & Accent Hue</h3>
              <p className="text-[11px] text-white/40">Select your luminous background orb colors</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((key) => {
              const preset = THEME_PRESETS[key];
              const isSelected = theme.preset === key;
              return (
                <button
                  key={key}
                  onClick={() => updateTheme({ preset: key })}
                  className={`p-3 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col justify-between h-20 ${
                    isSelected
                      ? "bg-white/[0.1] border-white/40 shadow-[0_0_20px_rgba(255,255,255,0.15)] scale-[1.02]"
                      : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.08]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: preset.primary }} />
                    {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                  <span className="text-xs font-semibold text-white/90">{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Custom Wallpaper Media (Images & Videos) */}
      <div className="p-6 rounded-3xl glass-panel space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.06]">
          <div className="h-8 w-8 rounded-xl bg-white/[0.06] flex items-center justify-center text-cyan-400">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Custom Spatial Wallpaper (Images & Looping Video)</h3>
            <p className="text-[11px] text-white/40">Upload from local device, select curated presets, or input direct URL</p>
          </div>
        </div>

        {/* Curated Preset Wallpapers */}
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-white/50 block mb-2.5">
            Curated Presets
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PRESET_WALLPAPERS.map((wp) => {
              const isCurrent =
                (wp.type === "glow" && theme.bgType === "glow") ||
                (wp.type === "image" && theme.bgUrl === wp.url);

              return (
                <button
                  key={wp.name}
                  onClick={() =>
                    updateTheme({
                      bgType: wp.type,
                      bgUrl: wp.url,
                    })
                  }
                  className={`p-3 rounded-2xl border text-left transition-all h-24 flex flex-col justify-between bg-gradient-to-br ${
                    wp.preview
                  } ${
                    isCurrent
                      ? "ring-2 ring-emerald-400 border-transparent shadow-[0_0_20px_rgba(52,211,153,0.3)]"
                      : "border-white/10 hover:border-white/30 opacity-75 hover:opacity-100"
                  }`}
                >
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/40 text-white/80 self-start border border-white/10">
                    {wp.type.toUpperCase()}
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white drop-shadow">{wp.name}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Upload or Link Custom Wallpaper */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* File Picker */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col items-center justify-center text-center">
            <Upload className="h-6 w-6 text-white/40 mb-2" />
            <span className="text-xs font-semibold text-white">Upload from Computer</span>
            <p className="text-[11px] text-white/40 mb-3">Supports JPG, PNG, WEBP, and looping MP4/WEBM videos</p>
            <label className="px-4 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/10 text-xs font-medium cursor-pointer transition-colors text-white">
              Choose File
              <input
                type="file"
                accept="image/*,video/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* URL Input */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Paste Online Media URL</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveMediaType("image")}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    activeMediaType === "image" ? "bg-white/20 text-white" : "text-white/40"
                  }`}
                >
                  IMAGE
                </button>
                <button
                  onClick={() => setActiveMediaType("video")}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    activeMediaType === "video" ? "bg-white/20 text-white" : "text-white/40"
                  }`}
                >
                  VIDEO
                </button>
              </div>
            </div>

            <input
              type="text"
              placeholder={activeMediaType === "image" ? "https://example.com/wallpaper.jpg" : "https://example.com/loop.mp4"}
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400"
            />

            <button
              onClick={handleApplyUrl}
              className="w-full py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs tracking-wide transition-all shadow-md active:scale-[0.98]"
            >
              Apply Background
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
