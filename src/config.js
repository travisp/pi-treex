import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  treeStyle: "nested",
  detailPane: true,
  detailPaneHeight: 4,
});

function clampDetailPaneHeight(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONFIG.detailPaneHeight;
  return Math.max(3, Math.min(8, Math.round(numeric)));
}

function normalizeConfig(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG };

  const treeStyle = value.treeStyle === "rail" ? "rail" : "nested";

  return {
    version: 1,
    treeStyle,
    detailPane: true,
    detailPaneHeight: clampDetailPaneHeight(value.detailPaneHeight),
  };
}

export function getTreeXPath() {
  return path.join(getAgentDir(), "treex.json");
}

export async function loadTreeXConfig() {
  try {
    const raw = await readFile(getTreeXPath(), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveTreeXConfig(config) {
  const filePath = getTreeXPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf8");
}

export function cycleViewMode(config) {
  const nextTreeStyle = config.treeStyle === "rail" ? "nested" : "rail";
  return normalizeConfig({ ...config, treeStyle: nextTreeStyle, detailPane: true });
}

export function getTreeStyleLabel(treeStyle) {
  return treeStyle === "rail" ? "rail" : "original";
}

export function formatViewMode(config) {
  return getTreeStyleLabel(config.treeStyle);
}
