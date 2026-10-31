import { Geist_Mono, Inter, Noto_Sans_SC, Noto_Sans_TC, Russo_One } from "next/font/google";

// Display (logo-style headlines and slogans).
export const russoOne = Russo_One({ weight: "400", subsets: ["latin"], variable: "--font-russo", display: "swap" });

// UI, body text and all numbers (with tabular figures).
export const inter = Inter({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

// One variable face per Unicode subset, rather than repeating every subset
// four times for separate weights. Font files still load only for used glyphs.
export const notoSC = Noto_Sans_SC({ weight: "variable", variable: "--font-noto-sc", display: "swap", preload: false });
export const notoTC = Noto_Sans_TC({ weight: "variable", variable: "--font-noto-tc", display: "swap", preload: false });

// Code snippets only.
export const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const fontVariables = [russoOne.variable, inter.variable, notoSC.variable, notoTC.variable, geistMono.variable].join(" ");
