import NumberFlow from "@number-flow/react";

interface KpiNumberProps {
  value: number | string;
  testId?: string;
}

// KPI 数字滚动：只动数值本身，单位由调用方渲染，不参与动画
export default function KpiNumber({ value, testId }: KpiNumberProps) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  return (
    <span data-testid={testId}>
      <NumberFlow value={Number.isFinite(numeric) ? numeric : 0} />
    </span>
  );
}
