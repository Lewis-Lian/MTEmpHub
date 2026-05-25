interface ErrorStateProps {
  description: string;
  title?: string;
}

export default function ErrorState({ description, title = "加载失败" }: ErrorStateProps) {
  return (
    <section className="legacy-feedback-block legacy-error-state" role="alert">
      <p className="legacy-feedback-kicker">系统提示</p>
      <h2 className="legacy-feedback-title">{title}</h2>
      <p className="legacy-feedback-body">{description}</p>
    </section>
  );
}
