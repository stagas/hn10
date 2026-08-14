import { $ } from "bun";
import { existsSync } from "node:fs";

export async function findChrome(): Promise<string> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const paths = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const installedPath = paths.find((path) => existsSync(path));
  if (installedPath) return installedPath;

  for (const command of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ]) {
    const commandPath = await $`which ${command}`
      .quiet()
      .text()
      .then((text) => text.trim())
      .catch(() => "");
    if (commandPath) return commandPath;
  }

  throw new Error("Chrome was not found. Set CHROME_PATH to your Chrome executable.");
}
