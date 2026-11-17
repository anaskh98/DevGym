import { useState } from "react";
import type { ExportResponse } from "@ftc/shared";
import { api, ApiError } from "../api/client";
import { apiConfig } from "../api/config";
import { useApi } from "../api/useApi";
import { ErrorState, Loading } from "../components/States";
import { plural } from "../lib/fork";
import { useTitle } from "../lib/useTitle";
import { buildExport, downloadFile, TABLE_INFO, tablesOf, totalRecords } from "../lib/myData";

type Notice =
  | { kind: "exported"; filename: string; records: number }
  | { kind: "deleted"; records: number }
  | { kind: "failed"; message: string };

function Stored({ response, onDeleted }: { response: ExportResponse; onDeleted: (records: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const total = totalRecords(response);
  const sample = apiConfig.mode === "mock";

  const exportJson = () => {
    const file = buildExport(response);
    downloadFile(file);
    setNotice({ kind: "exported", filename: file.filename, records: total });
  };

  const deleteAll = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteAll();
      const removed = Object.values(result.deleted).reduce((sum, n) => sum + n, 0);
      onDeleted(removed);
    } catch (error) {
      setNotice({
        kind: "failed",
        message: error instanceof ApiError ? error.message : "The delete request failed.",
      });
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <p className="data__where">
        {total === 0
          ? "Nothing is stored about you."
          : `${plural(total, "record")}, all in one SQLite file on this computer, outside any repository.`}
      </p>

      <div className="data__actions">
        <button type="button" className="button" onClick={exportJson}>
          Export as JSON
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={total === 0 || confirming}
          onClick={() => {
            setNotice(null);
            setConfirming(true);
          }}
        >
          Delete everything
        </button>
      </div>

      {confirming && (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
          <h2 id="confirm-title">Delete all {plural(total, "record")}?</h2>
          <p id="confirm-text">
            This removes every ticket, question, decision, explanation, observation and growth plan
            from this computer. It cannot be undone.
            {sample ? " This is sample data, so it comes back when you reload the page." : ""}
          </p>
          <div className="confirm__actions">
            <button type="button" className="button button--danger-solid" disabled={deleting} onClick={deleteAll}>
              {deleting ? "Deleting" : "Delete everything"}
            </button>
            <button type="button" className="button" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep my data
            </button>
          </div>
        </div>
      )}

      <p className="data__notice" role="status">
        {notice?.kind === "exported" &&
          `Exported ${plural(notice.records, "record")} to ${notice.filename}.`}
        {notice?.kind === "failed" && `Nothing was deleted. ${notice.message}`}
      </p>

      <h2 className="data__heading">What is stored</h2>
      <ul className="data__kinds">
        {tablesOf(response).map((kind) => {
          const records = response.data[kind] ?? [];
          const info = TABLE_INFO[kind] ?? { label: kind, what: "" };
          return (
            <li key={kind}>
              <details className="kind" {...(records.length === 0 ? { "data-empty": "" } : {})}>
                <summary>
                  <span className="kind__label">{info.label}</span>
                  <span className="kind__what">{info.what}</span>
                  <span className="kind__count">{records.length}</span>
                </summary>
                {records.length === 0 ? (
                  <p className="kind__none">None stored.</p>
                ) : (
                  <pre className="kind__records" tabIndex={0}>
                    {JSON.stringify(records, null, 2)}
                  </pre>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** FE-6: everything stored on this computer, with export and delete. */
export function MyDataPage() {
  useTitle("My data");
  const [version, setVersion] = useState(0);
  const [deleted, setDeleted] = useState<number | null>(null);
  const data = useApi(`data:${version}`, (signal) => api.getExport(signal));

  return (
    <article className="data-page">
      <h1 className="page-title">My data</h1>
      <p className="data__intro">
        Everything this tool knows about you is listed here. It is kept on this computer and is
        not sent anywhere. Only the Decisions section of a pull request is shared with your team.
      </p>

      {deleted !== null && (
        <p className="data__deleted" role="status">
          Deleted {plural(deleted, "record")}.
        </p>
      )}

      {data.status === "loading" && <Loading what="your data" />}
      {data.status === "error" && <ErrorState error={data.error} what="your data" />}
      {data.status === "ready" && (
        <Stored
          key={version}
          response={data.data}
          onDeleted={(records) => {
            setDeleted(records);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </article>
  );
}
