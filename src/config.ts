import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** A consumer project's `translate.config.js`. Every field is optional. */
export interface Config {
  paths?: {
    /** Where manifest entries live. Default: `"manifest"`. */
    manifestDir?: string;
    /** Where translation files live. Default: `"translations"`. */
    translationsDir?: string;
    /** Where the built site goes. Default: `"site"`. */
    siteDir?: string;
    /** Where fetched originals are cached. Default: `".cache/originals"`. */
    cacheDir?: string;
  };
  upstream?: {
    /** The upstream repository that `add-source` uses, such as `"owner/repo"`. `add-source` needs it. */
    defaultRepo?: string;
    /** The branch that `add-source` uses when it gets no `--commit`. Default: `"main"`. */
    defaultBranch?: string;
  };
  attribution?: {
    /** The license name for the site footer, such as `"CC BY-SA 4.0"`. The footer shows the license only when the name and the URL are both set. */
    licenseName?: string;
    licenseUrl?: string;
  };
}

export interface ResolvedConfig {
  /** The folder of the config file. Relative paths start here. */
  root: string;
  manifestDir: string;
  translationsDir: string;
  siteDir: string;
  cacheDir: string;
  defaultRepo?: string;
  defaultBranch: string;
  licenseName?: string;
  licenseUrl?: string;
}

const DEFAULT_CONFIG_FILENAME = "translate.config.js";

export function resolveConfig(config: Config, root: string): ResolvedConfig {
  return {
    root,
    manifestDir: config.paths?.manifestDir ?? "manifest",
    translationsDir: config.paths?.translationsDir ?? "translations",
    siteDir: config.paths?.siteDir ?? "site",
    cacheDir: config.paths?.cacheDir ?? ".cache/originals",
    defaultRepo: config.upstream?.defaultRepo,
    defaultBranch: config.upstream?.defaultBranch ?? "main",
    licenseName: config.attribution?.licenseName,
    licenseUrl: config.attribution?.licenseUrl,
  };
}

export async function loadConfig(configPath?: string): Promise<ResolvedConfig> {
  const root = process.cwd();
  const absolutePath = resolve(root, configPath ?? DEFAULT_CONFIG_FILENAME);

  if (!configPath && !existsSync(absolutePath)) {
    return resolveConfig({}, root);
  }

  const loaded = (await import(pathToFileURL(absolutePath).href)) as { default: Config };
  return resolveConfig(loaded.default, root);
}
