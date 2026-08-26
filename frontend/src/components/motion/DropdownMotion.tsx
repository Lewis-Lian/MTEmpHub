import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

interface DropdownMotionProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 弹层统一进出场包装：fade + scale + 轻微下移入场，退场反向 120ms。
 * 曲线与时长继承 App 级 MotionConfig（180ms, [0.16, 1, 0.3, 1]）。
 * transformOrigin 固定 top left——本项目弹层均自触发器下方展开。
 */
export default function DropdownMotion({ isOpen, children, className, style }: DropdownMotionProps) {
  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className={className}
          exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12 } }}
          initial={{ opacity: 0, scale: 0.97, y: 4 }}
          style={{ ...style, transformOrigin: "top left" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
