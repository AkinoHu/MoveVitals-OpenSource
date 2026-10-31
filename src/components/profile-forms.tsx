"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { saveBodyProfile, updateAvatar } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n/fill";
import { tr } from "@/i18n/translate";
import { ageFrom, type AttributeKey } from "@/lib/attributes";
import { providerName } from "@/lib/providers/catalog";
import { cmToFeetInches, type UnitSystem } from "@/lib/units";
import { Avatar } from "./avatar";
import { Button, Input, Label, Select } from "./ui";

const AVATAR_PX = 256;

// Centre-crop to a square and resize in the browser, so the server only ever
// stores a small image.
async function toSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_PX;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
}

export function AvatarUploader({ updatedAt }: { updatedAt: Date | null }) {
  const { t } = useI18n();
  const x = t.dash.settings;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (value: string | null) =>
    start(async () => {
      const res = await updateAvatar(value);
      setError(res?.error ? tr(t, res.error) : null);
      router.refresh();
    });

  return (
    <div className="flex items-center gap-4">
      <Avatar updatedAt={updatedAt} size={64} />
      <div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
            {updatedAt ? x.avatarChange : x.avatarUpload}
          </Button>
          {updatedAt && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(null)}>
              {x.avatarRemove}
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-faint">{x.avatarHint}</p>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              run(await toSquareDataUrl(file));
            } catch {
              setError(x.avatarInvalid);
            }
          }}
        />
      </div>
    </div>
  );
}

type Attr = { value: string; source: string };

export function BodyProfileForm({ attrs, units }: { attrs: Partial<Record<AttributeKey, Attr>>; units: UnitSystem }) {
  const { t } = useI18n();
  const x = t.dash.settings;
  const [state, action, pending] = useActionState(saveBodyProfile, undefined);
  const age = ageFrom(attrs.birth_date?.value);
  const feet = attrs.height_cm ? cmToFeetInches(Number(attrs.height_cm.value)) : null;

  const source = (key: AttributeKey) => {
    const s = attrs[key]?.source;
    if (!s) return undefined;
    return s === "manual" ? x.sourceManual : fill(x.sourceDevice, { p: providerName(s) });
  };

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Label hint={source("height_cm")}>{x.height}</Label>
          {units === "imperial" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <Input name="height_ft" type="number" inputMode="numeric" min={1} max={8} defaultValue={feet?.ft} className="tnum pr-8" />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">ft</span>
              </div>
              <div className="relative">
                <Input name="height_in" type="number" inputMode="decimal" step="0.5" min={0} max={11.5} defaultValue={feet?.inch} className="tnum pr-8" />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">in</span>
              </div>
            </div>
          ) : (
            <div className="relative">
              <Input name="height_cm" type="number" inputMode="decimal" step="0.5" min={50} max={260} defaultValue={attrs.height_cm?.value} className="tnum pr-10" />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">cm</span>
            </div>
          )}
        </label>
        <label className="block">
          <Label hint={[source("birth_date"), age != null ? fill(x.age, { n: age }) : null].filter(Boolean).join(" · ") || undefined}>{x.birthDate}</Label>
          <Input name="birth_date" type="date" defaultValue={attrs.birth_date?.value} className="tnum" />
        </label>
        <label className="block">
          <Label hint={source("sex")}>{x.sex}</Label>
          <Select name="sex" defaultValue={attrs.sex?.value ?? ""}>
            <option value="">{x.notSet}</option>
            <option value="female">{x.sexFemale}</option>
            <option value="male">{x.sexMale}</option>
            <option value="other">{x.sexOther}</option>
          </Select>
        </label>
        <label className="block">
          <Label hint={source("blood_type")}>{x.bloodType}</Label>
          <Select name="blood_type" defaultValue={attrs.blood_type?.value ?? ""}>
            <option value="">{x.notSet}</option>
            {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label hint={source("max_hr")}>{x.maxHr}</Label>
          <div className="relative">
            <Input name="max_hr" type="number" inputMode="numeric" min={100} max={240} defaultValue={attrs.max_hr?.value} className="tnum pr-12" />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">bpm</span>
          </div>
        </label>
        <label className="block">
          <Label hint={source("ftp_w")}>{x.ftp}</Label>
          <div className="relative">
            <Input name="ftp_w" type="number" inputMode="numeric" min={50} max={600} defaultValue={attrs.ftp_w?.value} className="tnum pr-9" />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">W</span>
          </div>
        </label>
      </div>
      {state?.error && <p className="text-sm text-danger">{tr(t, state.error)}</p>}
      {state?.ok && <p className="text-sm text-accent">{tr(t, state.ok)}</p>}
      <Button disabled={pending}>{pending ? t.common.saving : t.common.save}</Button>
    </form>
  );
}
