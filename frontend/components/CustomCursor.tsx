"use client";

import React, { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export const CustomCursor: React.FC = () => {
  const [isHovering, setIsHovering] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // useMotionValue avoids triggering React re-renders on every mouse pixel movement
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  // useSpring provides that highly polished, smooth lag effect directly to the DOM
  const springConfig = { damping: 25, stiffness: 400, mass: 0.2 };
  const springX = useSpring(cursorX, springConfig);
  const springY = useSpring(cursorY, springConfig);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(pointer: coarse)").matches) {
      setIsTouchDevice(true);
      return;
    }

    const updateMousePosition = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Check if hovering over a clickable element
      if (
        window.getComputedStyle(target).cursor === "pointer" ||
        target.tagName?.toLowerCase() === "a" ||
        target.tagName?.toLowerCase() === "button" ||
        target.closest("button") ||
        target.closest("a")
      ) {
        setIsHovering(true);
      } else {
        setIsHovering(false);
      }
    };

    window.addEventListener("mousemove", updateMousePosition);
    window.addEventListener("mouseover", handleMouseOver);

    return () => {
      window.removeEventListener("mousemove", updateMousePosition);
      window.removeEventListener("mouseover", handleMouseOver);
    };
  }, [cursorX, cursorY]);

  if (isTouchDevice) return null;

  return (
    <motion.div
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        x: springX,
        y: springY,
        pointerEvents: "none",
        zIndex: 99999,
        mixBlendMode: "difference",
        // The transform aligns the tip of the arrow/hand with the actual mouse pointer
        translateX: isHovering ? "-33%" : "-2px",
        translateY: isHovering ? "-4%" : "-2px",
      }}
      animate={{
        scale: isHovering ? 1.15 : 1,
      }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      {isHovering ? (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Solid Pointing Hand Path */}
          <path
            d="M21 12.5C21 11.12 19.88 10 18.5 10C18.22 10 17.95 10.05 17.7 10.13C17.39 8.92 16.29 8 15 8C14.72 8 14.45 8.05 14.2 8.13C13.89 6.92 12.79 6 11.5 6C11.22 6 10.95 6.05 10.7 6.13V3.5C10.7 2.12 9.58 1 8.2 1C6.82 1 5.7 2.12 5.7 3.5V13.8L4.35 12.63C3.47 11.87 2.15 11.96 1.39 12.83C0.63 13.7 0.72 15.03 1.59 15.79L6.5 20.06C7.9 21.28 9.68 22 11.53 22H15C18.31 22 21 19.31 21 16V12.5Z"
            fill="white"
          />
        </svg>
      ) : (
        <svg width="32" height="32" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* A beautiful, thick cursor arrow path */}
          <path
            d="M2.23438 1.48438L8.6875 25.1094L13.3438 15.6562L22.9531 11.2344L2.23438 1.48438Z"
            fill="white"
            stroke="white"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </motion.div>
  );
};
