type ModernPageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  status?: string;
};

export function ModernPageHeader({
  eyebrow,
  title,
  description,
  status,
}: ModernPageHeaderProps) {
  return (
    <div className="seoi-page-hero">
      <div className="seoi-page-hero__content">
        <span className="seoi-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {status ? <span className="seoi-status">{status}</span> : null}
    </div>
  );
}
