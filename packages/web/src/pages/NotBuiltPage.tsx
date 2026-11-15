import { EmptyState } from "../components/States";

interface Props {
  title: string;
  /** What the page will show, in one sentence. */
  willShow: string;
  /** Build-plan task and week, e.g. "FE-3, week 2". */
  planned: string;
}

/** A page from the plan that is not built yet. Says so, instead of a blank screen. */
export function NotBuiltPage({ title, willShow, planned }: Props) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <EmptyState title="Not built yet">
        <p>{willShow}</p>
        <p className="state__meta">Planned: {planned}.</p>
      </EmptyState>
    </>
  );
}
