"use client";

import { useActionState, useState } from "react";
import { ask, saveAISettings } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import { tr } from "@/i18n/translate";
import { Button, Input, Label, Select } from "./ui";

type Preset = { kind: string; label: string; baseUrl: string; model: string };
type Current = { kind: string; baseUrl: string | null; model: string; allowedProviders: string[] | null; includeProfile: boolean; includeLabs: boolean; includeNames: boolean } | null;

export function AISettingsForm({ presets, current, sources }: { presets: readonly Preset[]; current: Current; sources: { id: string; name: string; restricted: boolean }[] }) {
  const { t } = useI18n();
  const x = t.dash.ai;
  const [state, action, pending] = useActionState(saveAISettings, undefined);
  const [kind, setKind] = useState(current?.kind ?? "anthropic");
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? presets[0].baseUrl);
  const [model, setModel] = useState(current?.model ?? presets[0].model);
  const allowed = current?.allowedProviders;

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <Label>{x.preset}</Label>
        <Select
          defaultValue=""
          onChange={(e) => {
            const p = presets[Number(e.target.value)];
            if (!p) return;
            setKind(p.kind);
            setBaseUrl(p.baseUrl);
            setModel(p.model);
          }}
        >
          <option value="">{x.presetPlaceholder}</option>
          {presets.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>{x.protocol}</Label>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="anthropic">Anthropic Messages API</option>
            <option value="openai_compatible">OpenAI-compatible</option>
          </Select>
        </label>
        <label className="block">
          <Label>{x.model}</Label>
          <Input name="model" value={model} onChange={(e) => setModel(e.target.value)} required />
        </label>
      </div>
      <label className="block">
        <Label>Base URL</Label>
        <Input name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="block">
        <Label hint={current ? x.keySaved : undefined}>{x.apiKey}</Label>
        <Input name="apiKey" type="password" autoComplete="off" placeholder={current ? "••••••••" : "sk-…"} />
      </label>
      <fieldset>
        <Label>{x.allowed}</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {sources.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="allowed" value={s.id} defaultChecked={allowed ? allowed.includes(s.id) : !s.restricted} />
              {s.name}
              {s.restricted && <span className="text-[11px] text-warn">{x.restricted}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <Label>{x.alsoShare}</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="includeProfile" defaultChecked={current?.includeProfile ?? true} />
            {x.shareProfile}
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="includeNames" defaultChecked={current?.includeNames ?? true} />
            {x.shareNames}
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="includeLabs" defaultChecked={current?.includeLabs ?? false} />
            {x.shareLabs}
          </label>
        </div>
      </fieldset>
      {state?.error && <p className="text-sm text-danger">{tr(t, state.error)}</p>}
      {state?.ok && <p className="text-sm text-accent">{tr(t, state.ok)}</p>}
      <Button disabled={pending}>{pending ? t.common.saving : t.common.save}</Button>
      <p className="text-xs text-muted">{x.keyNote}</p>
    </form>
  );
}


export function AskForm({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const x = t.dash.ai;
  const [state, action, pending] = useActionState(ask, undefined);
  const [q, setQ] = useState("");
  return (
    <div>
      <form action={action} className="space-y-2">
        <textarea
          name="question"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          rows={3}
          disabled={!enabled}
          placeholder={enabled ? x.placeholder : x.placeholderDisabled}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!enabled || pending}>{pending ? x.analysing : x.analyse}</Button>
          {x.suggestions.map((s) => (
            <button key={s} type="button" disabled={!enabled} onClick={() => setQ(s)} className="rounded-md bg-surface-2 px-2 py-1 text-left text-xs text-muted hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      </form>
      {state?.error && <p className="mt-4 text-sm text-danger">{tr(t, state.error)}</p>}
      {state?.answer && <div className="mt-5 whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-4 text-sm leading-relaxed">{state.answer}</div>}
    </div>
  );
}
