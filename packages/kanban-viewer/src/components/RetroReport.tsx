import ReactMarkdown from 'react-markdown';

interface RetroReportProps {
  retroReport?: string | null;
}

export function RetroReport({ retroReport }: RetroReportProps) {
  if (!retroReport) {
    return null;
  }

  return (
    <section>
      <ReactMarkdown>{retroReport}</ReactMarkdown>
    </section>
  );
}
