"use client";

import { motion, useMotionValue, useSpring, useTransform, Variants, HTMLMotionProps } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";

export const springConfig = {
  soft: { type: "spring", stiffness: 180, damping: 24 },
  snappy: { type: "spring", stiffness: 350, damping: 25 },
  tactile: { type: "spring", stiffness: 450, damping: 30 },
} as const;

export const fadeInVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" },
  },
};

export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
};

export type StaggerContainerProps = Omit<HTMLMotionProps<"div">, "children"> & {
  children?: React.ReactNode;
  delay?: number;
};

export function StaggerContainer({
  children,
  className = "",
  delay = 0,
  ...props
}: StaggerContainerProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.08,
            delayChildren: delay,
          },
        },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export type StaggerItemProps = Omit<HTMLMotionProps<"div">, "children"> & {
  children?: React.ReactNode;
};

export function StaggerItem({
  children,
  className = "",
  ...props
}: StaggerItemProps) {
  return (
    <motion.div variants={fadeInVariants} className={className} {...props}>
      {children}
    </motion.div>
  );
}

export type MotionCardProps = Omit<HTMLMotionProps<"div">, "children"> & {
  children?: React.ReactNode;
  enableSpotlight?: boolean;
};

export function MotionCard({
  children,
  className = "",
  enableSpotlight = true,
  ...props
}: MotionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!enableSpotlight || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      whileHover={{ y: -3, scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`relative overflow-hidden ${className}`}
      {...props}
    >
      {enableSpotlight && (
        <motion.div
          className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: useTransform(
              [mouseX, mouseY],
              ([x, y]) =>
                `radial-gradient(400px circle at ${x}px ${y}px, var(--red-glow), transparent 70%)`
            ),
          }}
        />
      )}
      {children}
    </motion.div>
  );
}

export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  className = "",
}: {
  value: string;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const numericMatch = value.match(/[\d.]+/);
  const targetNumber = numericMatch ? parseFloat(numericMatch[0]) : null;
  const nonNumericPrefix = value.replace(/[\d.]+.*/, "");
  const nonNumericSuffix = value.replace(/.*?[\d.]+/, "");

  const [hasEntered, setHasEntered] = useState(false);
  const motionVal = useMotionValue(0);
  const springVal = useSpring(motionVal, { stiffness: 60, damping: 18 });
  const [displayVal, setDisplayVal] = useState("0");

  useEffect(() => {
    if (hasEntered && targetNumber !== null) {
      motionVal.set(targetNumber);
    }
  }, [hasEntered, targetNumber, motionVal]);

  useEffect(() => {
    if (targetNumber === null) return;
    return springVal.on("change", (latest) => {
      if (targetNumber % 1 === 0) {
        setDisplayVal(Math.round(latest).toLocaleString());
      } else {
        setDisplayVal(latest.toFixed(1));
      }
    });
  }, [springVal, targetNumber]);

  if (targetNumber === null) {
    return <span className={className}>{value}</span>;
  }

  return (
    <motion.span
      onViewportEnter={() => setHasEntered(true)}
      viewport={{ once: true }}
      className={className}
    >
      {prefix || nonNumericPrefix}
      {displayVal}
      {suffix || nonNumericSuffix}
    </motion.span>
  );
}

export type MagneticButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  children?: React.ReactNode;
};

export function MagneticButton({
  children,
  className = "",
  ...props
}: MagneticButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springX = useSpring(x, { stiffness: 250, damping: 20 });
  const springY = useSpring(y, { stiffness: 250, damping: 20 });

  function handleMouseMove(e: React.MouseEvent<HTMLButtonElement>) {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) * 0.15);
    y.set((e.clientY - centerY) * 0.15);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.button
      ref={btnRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={className}
      {...props}
    >
      {children}
    </motion.button>
  );
}
