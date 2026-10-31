"use client";

import { useActionState, useState, useTransition } from "react";
import { addLabResult, confirmLabReport, deleteLabReport, deleteLabResult, uploadLabReport } from "@/app/lab-actions";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n/fill";
import { tr } from "@/i18n/translate";
import type { ExtractedMarker } from "@/lib/db/schema";
import { Button, Input, Label, Select } from "./ui";

export type MarkerOption = { code: string; name: string; units: string[] };

function ErrorText({ error }: { error?: string }) {
  const { t } = useI18n();
  return error ? <p className="text-xs text-danger">{tr(t, error)}</p> : null;
}

export function AddResultForm({ markers, initial, today }: { markers: MarkerOption[]; initial?: string; today: string }) {
  const { t } = useI18n();
  const x = t.dash.lab;
  const [state, action, pending] = useActionState(addLabResult, undefined);
  const [marker, setMarker] = useState(initial ?? "");
  const units = markers.find((m) => m.code === marker)?.units ?? [];
  return (
    <form action={action} className="max-w-xl space-y-4">
      <label className="block">
        <Label>{x.marker}</Label>
        <Select name="marker" value={marker} onChange={(e) => setMarker(e.target.value)} required>
          <option value="">{x.chooseMarker}</option>
          {markers.map((m) => (
            <option key={m.code} value={m.code}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <Label>{x.value}</Label>
          <Input name="value" inputMode="decimal" required />
        </label>
        <label className="block">
          <Label>{x.unit}</Label>
          <Select name="unit" key={marker} required>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </label>
      </div>
      <label className="block">
        <Label>{x.date}</Label>
        <Input name="takenOn" type="date" max={today} defaultValue={today} required />
      </label>
      <fieldset>
        <Label>{x.refRange}</Label>
        <div className="grid grid-cols-2 gap-3">
          <Input name="refLow" inputMode="decimal" placeholder={x.refLow} aria-label={x.refLow} />
          <Input name="refHigh" inputMode="decimal" placeholder={x.refHigh} aria-label={x.refHigh} />
        </div>
      </fieldset>
      <label className="block">
        <Label>{x.note}</Label>
        <Input name="note" maxLength={500} />
      </label>
      <ErrorText error={state?.error} />
      <Button disabled={pending}>{x.save}</Button>
    </form>
  );
}

export function UploadReportForm({ model }: { model: string | null }) {
  const { t } = useI18n();
  const x = t.dash.lab;
  const [state, action, pending] = useActionState(uploadLabReport, undefined);
  const [extract, setExtract] = useState(!!model);
  return (
    <form action={action} className="max-w-xl space-y-4">
      <label className="block">
        <Label>{x.kind}</Label>
        <Select name="kind" defaultValue="lab">
          {(["lab", "checkup", "doctor"] as const).map((k) => (
            <option key={k} value={k}>
              {x.kinds[k]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block">
        <Label>{x.reportTitle}</Label>
        <Input name="title" maxLength={120} placeholder={x.reportTitlePh} />
      </label>
      <label className="block">
        <Label>{x.date}</Label>
        <Input name="takenOn" type="date" />
      </label>
      <label className="block">
        <Label>{x.file}</Label>
        <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm" />
      </label>
      {model ? (
        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3 text-[13px]">
          <input type="checkbox" name="extract" checked={extract} onChange={(e) => setExtract(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">{x.extract}</span>
            <span className="mt-1 block text-muted">{fill(x.extractConsent, { model })}</span>
          </span>
        </label>
      ) : (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-muted">{x.extractNoModel}</p>
      )}
      <ErrorText error={state?.error} />
      <Button disabled={pending}>{pending ? x.uploading : x.upload}</Button>
    </form>
  );
}

export function ReviewForm({ reportId, rows, markers, takenOn }: { reportId: string; rows: ExtractedMarker[]; markers: MarkerOption[]; takenOn: string | null }) {
  const { t } = useI18n();
  const x = t.dash.lab;
  const [state, action, pending] = useActionState(confirmLabReport, undefined);
  const nameOf = new Map(markers.map((m) => [m.code, m]));
  return (
    <form action={action}>
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="count" value={rows.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-[13px]">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">{x.include}</th>
              <th className="py-2 pr-3 font-medium">{x.printed}</th>
              <th className="py-2 pr-3 font-medium">{x.marker}</th>
              <th className="py-2 pr-3 font-medium">{x.value}</th>
              <th className="py-2 pr-3 font-medium">{x.unit}</th>
              <th className="py-2 pr-3 font-medium">{x.refLow}</th>
              <th className="py-2 pr-3 font-medium">{x.refHigh}</th>
              <th className="py-2 font-medium">{x.date}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => {
              const units = nameOf.get(r.marker)?.units ?? [];
              const known = units.find((u) => u.replace(/\s+/g, "").toLowerCase().replace("μ", "µ") === r.unit.replace(/\s+/g, "").toLowerCase().replace("μ", "µ").replace(/^u/, "µ"));
              return (
                <tr key={i}>
                  <td className="py-2 pr-3">
                    <input type="checkbox" name={`include.${i}`} defaultChecked aria-label={x.include} />
                  </td>
                  <td className="max-w-40 py-2 pr-3 text-muted">
                    {r.printed}
                    <span className="block text-[11px] text-faint">
                      {r.value} {r.unit}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Select name={`marker.${i}`} defaultValue={r.marker} className="min-w-44">
                      {markers.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <Input name={`value.${i}`} defaultValue={String(r.value)} inputMode="decimal" className="w-24" />
                  </td>
                  <td className="py-2 pr-3">
                    <Select name={`unit.${i}`} defaultValue={known ?? ""} className="min-w-28">
                      {!known && <option value="">{r.unit || "—"}</option>}
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <Input name={`refLow.${i}`} defaultValue={r.refLow ?? ""} inputMode="decimal" className="w-20" />
                  </td>
                  <td className="py-2 pr-3">
                    <Input name={`refHigh.${i}`} defaultValue={r.refHigh ?? ""} inputMode="decimal" className="w-20" />
                  </td>
                  <td className="py-2">
                    <Input name={`takenOn.${i}`} type="date" defaultValue={r.takenOn ?? takenOn ?? ""} className="w-40" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={pending}>{x.confirm}</Button>
        <ErrorText error={state?.error} />
      </div>
    </form>
  );
}

export function DeleteResultButton({ id }: { id: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="ghost" disabled={pending} className="h-auto px-0 text-xs text-muted" onClick={() => start(() => deleteLabResult(id))}>
      {t.dash.lab.delete}
    </Button>
  );
}

export function DeleteReportButton({ id }: { id: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="secondary" disabled={pending} onClick={() => start(() => deleteLabReport(id))}>
      {t.dash.lab.deleteReport}
    </Button>
  );
}
