import type { Locale } from "../config";
import en, { type LabCopy } from "./en";
import es from "./es";
import fr from "./fr";
import zhCN from "./zh-CN";
import zhTW from "./zh-TW";

export type { LabCopy };
const LAB: Record<Locale, LabCopy> = { en, "zh-CN": zhCN, "zh-TW": zhTW, fr, es };
export const getLabCopy = (locale: Locale): LabCopy => LAB[locale] ?? en;
