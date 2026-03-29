import ReactMarkdown from 'react-markdown';

interface RetroReportProps {
  retroReport?: string | null;
}

export function RetroReport({ retroReport }: RetroReportProps) {
  if (!retroReport) {
    return null;
  }

  const normalized = retroReport.replace(/\\n/g, '\n');

  return (
    <section>
      <ReactMarkdown>{normalized}</ReactMarkdown>
    </section>
  );
}
