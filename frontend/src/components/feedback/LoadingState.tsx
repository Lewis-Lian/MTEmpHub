import type { CSSProperties, ReactNode } from "react";

interface LoadingStateProps {
  message?: ReactNode;
}

export default function LoadingState({ message = "正在加载数据..." }: LoadingStateProps) {
  return <div style={stateStyle}>{message}</div>;
}

const stateStyle: CSSProperties = {
  minHeight: "220px",
  display: "grid",
  placeItems: "center",
  borderRadius: "24px",
  background: "#ffffff",
  color: "#4b5d67",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
};
