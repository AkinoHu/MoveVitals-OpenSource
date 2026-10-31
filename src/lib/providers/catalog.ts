// Catalogue of every health / fitness data source we know of, with how it can
// be connected. This is the single source of truth for the Integrations page
// and for which adapters are wired up. Access terms change; `verifiedAt`
// records when the entry was last checked.

export type Access =
  | "public" // self-serve developer portal, OAuth, anyone can register
  | "approval" // public API, but the app must be reviewed / approved
  | "partner" // business partnership only
  | "device" // no cloud API; data lives on the phone (HealthKit, Health Connect, BLE)
  | "none"; // no known official access

export type Status =
  | "live" // adapter implemented; needs client credentials in env
  | "planned" // feasible, adapter not written yet
  | "mobile" // will come through the MoveVitals iOS / Android app
  | "relay" // reaches us through another connected platform
  | "blocked"; // no viable official path today

export type ProviderCategory = "wearable" | "ring" | "chest_strap" | "trainer" | "cycling" | "app" | "scale" | "cgm" | "platform";

export type CatalogEntry = {
  id: string;
  name: string;
  category: ProviderCategory;
  access: Access;
  status: Status;
  data: string[];
  // Path the data takes today / our plan, zh-CN.
  path: string;
  // For status "relay": the platform the data currently arrives through.
  via?: string;
  // Data from this source must not be sent to an LLM by default (API terms).
  aiRestricted?: boolean;
  // API terms require deleting a user's data when they deauthorise us at the source.
  purgeOnDeauth?: boolean;
  docs?: string;
  color: string;
  owned?: boolean; // a device the project owner uses today
};

export const CATALOG: CatalogEntry[] = [
  // ---- Live adapters -------------------------------------------------------
  {
    id: "whoop",
    name: "WHOOP",
    category: "wearable",
    access: "public",
    status: "live",
    data: ["恢复", "HRV", "静息心率", "睡眠分期", "Strain", "训练", "体测"],
    path: "官方 Developer API v2，OAuth2 + Webhook",
    docs: "https://developer.whoop.com",
    color: "#e11d48",
    owned: true,
  },
  {
    id: "strava",
    name: "Strava",
    category: "platform",
    access: "approval",
    status: "live",
    data: ["训练", "逐秒心率/功率/踏频/GPS"],
    path: "官方 API v3，OAuth2 + Webhook。新应用默认仅 1 名运动员，扩容需审核",
    aiRestricted: true,
    purgeOnDeauth: true,
    docs: "https://developers.strava.com",
    color: "#fc4c02",
    owned: true,
  },
  {
    id: "polar",
    name: "Polar",
    category: "chest_strap",
    access: "public",
    status: "live",
    data: ["训练（含 H10 心率）", "睡眠", "Nightly Recharge / HRV", "日常活动"],
    path: "官方 AccessLink API v3，OAuth2 + Webhook。H10 原始 RR/ECG 由 iOS App 经 BLE 采集",
    docs: "https://www.polar.com/accesslink-api/",
    color: "#d10027",
    owned: true,
  },
  {
    id: "oura",
    name: "Oura",
    category: "ring",
    access: "public",
    status: "live",
    data: ["准备度", "睡眠", "HRV", "体温偏差", "血氧", "步数", "训练"],
    path: "官方 API v2，OAuth2 + Webhook",
    docs: "https://cloud.ouraring.com/v2/docs",
    color: "#7c6f5b",
  },
  {
    id: "withings",
    name: "Withings",
    category: "scale",
    access: "public",
    status: "live",
    data: ["体重", "体脂", "肌肉量", "血压", "睡眠", "步数", "体温"],
    path: "官方 Public Health Data API，OAuth2 + Notify",
    docs: "https://developer.withings.com",
    color: "#00a3a6",
  },
  // ---- Mobile app (device-only data) --------------------------------------
  {
    id: "apple_health",
    name: "Apple Health / Apple Watch",
    category: "wearable",
    access: "device",
    status: "mobile",
    data: ["几乎所有健康指标", "训练", "心率", "HRV", "睡眠", "血氧", "VO2max"],
    path: "无云端 API。由 MoveVitals iOS App 读 HealthKit 后台同步到 /api/ingest",
    docs: "https://developer.apple.com/documentation/healthkit",
    color: "#111827",
    owned: true,
  },
  {
    id: "polar_ble",
    name: "Polar H10 (BLE)",
    category: "chest_strap",
    access: "device",
    status: "mobile",
    data: ["实时心率", "RR 间期", "ECG", "加速度"],
    path: "iOS App 集成 Polar BLE SDK 直连胸带",
    docs: "https://github.com/polarofficial/polar-ble-sdk",
    color: "#d10027",
    owned: true,
  },
  {
    id: "magene",
    name: "Magene T600",
    category: "trainer",
    access: "none",
    status: "relay",
    via: "Strava",
    data: ["功率", "踏频", "速度"],
    path: "无云 API。当前经 Zwift → Strava 进入；iOS App 阶段经 BLE FTMS 直连",
    color: "#0ea5e9",
    owned: true,
  },
  {
    id: "health_connect",
    name: "Android Health Connect",
    category: "app",
    access: "device",
    status: "mobile",
    data: ["Android 设备健康数据汇总"],
    path: "无云端 API，需 Android App",
    docs: "https://developer.android.com/health-and-fitness/guides/health-connect",
    color: "#34a853",
  },
  {
    id: "samsung_health",
    name: "Samsung Health",
    category: "wearable",
    access: "device",
    status: "mobile",
    data: ["Galaxy Watch 健康数据"],
    path: "Samsung Health Data SDK（设备端），或经 Health Connect",
    color: "#1428a0",
  },
  // ---- Need approval / partnership ----------------------------------------
  {
    id: "garmin",
    name: "Garmin Connect",
    category: "wearable",
    access: "approval",
    status: "planned",
    data: ["训练", "睡眠", "HRV", "Body Battery", "压力", "步数", "体重/体脂"],
    path: "官方 Health + Activity API（OAuth2 PKCE，推送模式）。需通过 Garmin Connect Developer Program 企业审核",
    docs: "https://developer.garmin.com/gc-developer-program/",
    color: "#007cc3",
  },
  {
    id: "coros",
    name: "COROS",
    category: "wearable",
    access: "public",
    status: "live",
    data: ["训练", "睡眠", "HRV", "静息心率", "压力", "步数", "最大摄氧量"],
    path: "官方 COROS MCP，OAuth2（自助注册，无需审核），按账号地区连接；需要 webhook/双向同步时再申请 Partner API",
    docs: "https://github.com/coroslab/coros-mcp",
    color: "#ef4444",
    owned: true,
  },
  {
    id: "zwift",
    name: "Zwift",
    category: "cycling",
    access: "partner",
    status: "relay",
    via: "Strava",
    data: ["室内骑行功率/心率/踏频"],
    path: "无公开 API。经 Zwift → Strava 自动同步进入（非官方协议违反条款，不采用）",
    color: "#fc6719",
    owned: true,
  },
  {
    id: "suunto",
    name: "Suunto",
    category: "wearable",
    access: "approval",
    status: "planned",
    data: ["训练（距离/心率/功率/爬升）"],
    path: "官方 Cloud API，OAuth2 + Webhook。需在 API Zone 申请并获批",
    docs: "https://apizone.suunto.com",
    color: "#222222",
  },
  {
    id: "wahoo",
    name: "Wahoo",
    category: "cycling",
    access: "approval",
    status: "planned",
    data: ["ELEMNT / KICKR 骑行训练", "功率", "NP", "心率"],
    path: "官方 Cloud API，OAuth2 + Webhook。需申请开发者权限",
    docs: "https://developers.wahooligan.com",
    color: "#0f172a",
  },
  {
    id: "concept2",
    name: "Concept2 Logbook",
    category: "app",
    access: "public",
    status: "live",
    data: ["划船机/滑雪机/BikeErg 训练"],
    path: "官方 Logbook API，OAuth2 + Webhook，自助注册",
    docs: "https://log.concept2.com/developers/documentation/",
    color: "#1e3a8a",
  },
  {
    id: "google_health",
    name: "Google Health (Fitbit)",
    category: "wearable",
    access: "approval",
    status: "planned",
    data: ["Fitbit / Pixel Watch 健康数据"],
    path: "旧 Fitbit Web API 于 2026 年 9 月下线，改接 Google Health API",
    color: "#00b0b9",
  },
  {
    id: "dexcom",
    name: "Dexcom CGM",
    category: "cgm",
    access: "approval",
    status: "live",
    data: ["每日平均血糖", "血糖达标时间（70–180）"],
    path: "官方 API v3，OAuth2。沙盒自助，正式环境需审核",
    docs: "https://developer.dexcom.com",
    color: "#58a618",
  },
  {
    id: "huawei",
    name: "Huawei Health",
    category: "wearable",
    access: "approval",
    status: "planned",
    data: ["训练", "睡眠", "心率", "血氧"],
    path: "Huawei Health Kit（云侧 REST），需开发者资质审核",
    docs: "https://developer.huawei.com/consumer/cn/hms/huaweihealth/",
    color: "#cf0a2c",
  },
  {
    id: "zepp",
    name: "Amazfit / Zepp",
    category: "wearable",
    access: "partner",
    status: "planned",
    data: ["训练", "睡眠", "心率"],
    path: "需与 Zepp 合作；可经 Strava 中转训练",
    color: "#f97316",
  },
  {
    id: "ultrahuman",
    name: "Ultrahuman Ring",
    category: "ring",
    access: "partner",
    status: "planned",
    data: ["睡眠", "HRV", "体温", "血糖（M1）"],
    path: "合作伙伴 API",
    color: "#4b5563",
  },
  {
    id: "trainingpeaks",
    name: "TrainingPeaks",
    category: "platform",
    access: "partner",
    status: "planned",
    data: ["训练", "计划课表"],
    path: "Partner API，需合作",
    color: "#1e88e5",
  },
  {
    id: "rouvy",
    name: "Rouvy / MyWhoosh",
    category: "cycling",
    access: "partner",
    status: "relay",
    via: "Strava",
    data: ["室内骑行"],
    path: "无公开 API，经 Strava 中转",
    color: "#6d28d9",
  },
  {
    id: "peloton",
    name: "Peloton",
    category: "cycling",
    access: "none",
    status: "relay",
    via: "Strava",
    data: ["骑行/跑步/力量课程", "功率", "心率"],
    path: "无公开 API。在 Peloton 中开启分享到 Strava 后经 Strava 中转",
    color: "#181a1d",
  },
  {
    id: "intervals_icu",
    name: "Intervals.icu",
    category: "platform",
    access: "public",
    status: "planned",
    data: ["训练", "训练负荷", "HRV", "静息心率", "体重", "睡眠"],
    path: "公开 REST API（OAuth2 / API Key），可直接对接",
    docs: "https://forum.intervals.icu/t/api-access-to-intervals-icu/609",
    color: "#e5242a",
  },
  {
    id: "hevy",
    name: "Hevy",
    category: "app",
    access: "public",
    status: "planned",
    data: ["力量训练", "动作/组数/重量"],
    path: "官方 API（用户在 Hevy Pro 中生成 API Key），可直接对接",
    docs: "https://api.hevyapp.com/docs",
    color: "#2563eb",
  },
  {
    id: "ihealth",
    name: "iHealth",
    category: "scale",
    access: "approval",
    status: "planned",
    data: ["血压", "体重", "血氧", "血糖"],
    path: "iHealth Open API，OAuth2，需开发者审核",
    docs: "https://developer.ihealthlabs.com",
    color: "#0096d6",
  },
  {
    id: "xiaomi",
    name: "Xiaomi / Mi Fitness",
    category: "wearable",
    access: "none",
    status: "blocked",
    data: ["手环/手表数据"],
    path: "无公开云 API；可写入 Apple Health / Health Connect 后经 App 采集",
    color: "#ff6900",
  },
];

export const CATALOG_MAP: Record<string, CatalogEntry> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export const ACCESS_LABELS: Record<Access, string> = {
  public: "公开 API",
  approval: "需审核",
  partner: "仅合作方",
  device: "仅设备端",
  none: "无接口",
};

export const STATUS_LABELS: Record<Status, string> = {
  live: "已接入",
  planned: "规划中",
  mobile: "随 App 上线",
  relay: "经其他平台中转",
  blocked: "暂无路径",
};

export function providerName(id: string): string {
  return CATALOG_MAP[id]?.name ?? id;
}

export function providerColor(id: string): string {
  return CATALOG_MAP[id]?.color ?? "#64748b";
}

// Status text for a catalogue entry; relayed sources name the platform.
export function statusText(c: CatalogEntry, labels: Record<Status, string>, via: string): string {
  return c.status === "relay" && c.via ? via.replace("{p}", c.via) : labels[c.status];
}
