import { readFileSync } from 'node:fs';
import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { Project } from 'ts-morph';

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

type LanguageMetadata = { name?: string; 'local-name'?: string };

export const i18nImporter = () => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync(['src/i18n/resources/*.json']).map((path) => {
    const nameWithExt = basename(path);
    const name = nameWithExt.replace(extname(nameWithExt), '');

    return { name, path };
  });

  // Language display names are needed by the menu. Extract them at build time
  // so the menu does not have to parse every translation bundle at runtime.
  const metadata = Object.fromEntries(
    plugins.map(({ name, path }) => {
      const parsed = JSON.parse(
        readFileSync(resolve(srcPath, '..', path), 'utf-8'),
      ) as { language?: LanguageMetadata };
      return [name, parsed.language ?? {}];
    }),
  );

  const src = globalProject.createSourceFile(
    'vm:i18n',
    (writer) => {
      // Virtual modules are parsed as JavaScript, so no TypeScript annotations
      // may appear in the generated source. Types live in virtual-module.d.ts.
      writer.writeLine('const loaders = {');
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');
        writer.writeLine(`  "${name}": () => import('${absolutePath}'),`);
      }
      writer.writeLine('};');
      writer.blankLine();
      writer.writeLine(
        `export const languageCodes = ${JSON.stringify(plugins.map((p) => p.name))};`,
      );
      writer.blankLine();
      writer.writeLine(
        `export const languageMetadata = ${JSON.stringify(metadata)};`,
      );
      writer.blankLine();
      writer.writeLine(
        'export const languageResources = async (language = "en") => {',
      );
      writer.writeLine(
        '  const languages = Array.from(new Set(["en", language])).filter((code) => code in loaders);',
      );
      writer.writeLine(
        '  const entries = await Promise.all(languages.map(async (code) => [code, { translation: (await loaders[code]()).default }]));',
      );
      writer.writeLine('  return Object.fromEntries(entries);');
      writer.writeLine('};');
    },
    { overwrite: true },
  );

  return src.getText();
};
