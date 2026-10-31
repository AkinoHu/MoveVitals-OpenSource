"use client";

import { useActionState, useState, useTransition } from "react";
import { createApiToken, deleteAccount, setCloudSync, setPassword, updateProfile } from "@/app/actions";
import { fill } from "@/i18n/fill";
import { useI18n } from "@/i18n/client";
import { tr } from "@/i18n/translate";
import { Button, Input, Label, Select } from "./ui";

export function ProfileForm({ name, timezone, units }: { name: string | null; timezone: string; units: "metric" | "imperial" }) {
  const { t } = useI18n();
  const x = t.dash.settings;
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <Label>{x.name}</Label>
        <Input name="name" defaultValue={name ?? ""} />
      </label>
      <label className="block">
        <Label hint={x.tzHint}>{x.timezone}</Label>
        <Input name="timezone" defaultValue={timezone} placeholder="Asia/Shanghai" />
      </label>
      <label className="block">
        <Label hint={x.unitsHint}>{x.units}</Label>
        <Select name="units" defaultValue={units}>
          <option value="metric">{x.unitsMetric}</option>
          <option value="imperial">{x.unitsImperial}</option>
        </Select>
      </label>
      {state?.error && <p className="text-sm text-danger">{tr(t, state.error)}</p>}
      {state?.ok && <p className="text-sm text-accent">{tr(t, state.ok)}</p>}
      <Button disabled={pending}>{t.common.save}</Button>
    </form>
  );
}

export function TokenForm() {
  const { t } = useI18n();
  const x = t.dash.settings;
  const [state, action, pending] = useActionState(createApiToken, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <Input name="name" placeholder={x.tokenName} />
        <Button disabled={pending} className="shrink-0">
          {x.generate}
        </Button>
      </div>
      {state?.token && (
        <p className="break-all rounded-lg bg-surface-2 p-2 font-mono text-xs">
          {state.token}
          <span className="mt-1 block font-sans text-warn">{x.tokenOnce}</span>
        </p>
      )}
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const { t } = useI18n();
  const x = t.dash.settings;
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  return (
    <form action={action} className="space-y-2">
      <p className="text-sm text-muted">{x.deleteDesc}</p>
      <Input name="confirm" placeholder={fill(x.deleteConfirm, { e: email })} />
      {state?.error && <p className="text-sm text-danger">{tr(t, state.error)}</p>}
      <Button variant="danger" disabled={pending}>
        {x.deleteBtn}
      </Button>
    </form>
  );
}

// Cross-device cloud sync switch (applies to on-device sources like HealthKit).
export function CloudSyncSwitch({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const x = t.dash.settings;
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{on ? x.syncOnLabel : x.syncOffLabel}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{on ? x.syncOnDesc : x.syncOffDesc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={x.sync}
        disabled={pending}
        onClick={() => {
          const next = !on;
          setOn(next);
          start(async () => {
            await setCloudSync(next);
          });
        }}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-surface-3 ring-1 ring-line"} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function SetPasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useI18n();
  const x = t.dash.settings;
  const [state, action, pending] = useActionState(setPassword, undefined);
  return (
    <form action={action} className="space-y-2">
      <Label hint={t.auth.passwordHint}>{hasPassword ? x.changePassword : x.addPassword}</Label>
      <div className="flex gap-2">
        <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
        <Button disabled={pending} variant="secondary" className="shrink-0">
          {t.common.save}
        </Button>
      </div>
      {state?.error && <p className="text-sm text-danger">{tr(t, state.error)}</p>}
      {state?.ok && <p className="text-sm text-accent">{tr(t, state.ok)}</p>}
    </form>
  );
}
