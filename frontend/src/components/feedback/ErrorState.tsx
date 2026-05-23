import type { CSSProperties } from "react";

interface ErrorStateProps {
  description: string;
  title?: string;
}

export default function ErrorState({ description, title = "加载失败" }: ErrorStateProps) {
  return (
    <section style={cardStyle}>
      <p style={tagStyle}>异常</p>
      <h2 style={titleStyle}>{title}</h2>
      <p style={bodyStyle}>{description}</p>
    </section>
  );
}

const cardStyle: CSSProperties = {
  minHeight: "220px",
  padding: "28px",
  borderRadius: "24px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
};

const tagStyle: CSSProperties = {
  margin: 0,
  color: "#9a3412",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "12px",
};

const titleStyle: CSSProperties = {
  margin: "12px 0 10px",
  color: "#183153",
  fontSize: "28px",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  color: "#4b5d67",
  lineHeight: 1.7,
};
