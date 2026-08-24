import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const TRANSLATIONS_DIR = path.join(__dirname, '../src/localization/translations');
const LANGUAGES_FILE = path.join(__dirname, '../src/localization/supported-languages.json');

type Translations = Record<string, string>;

const read = (file: string): Translations =>
  JSON.parse(fs.readFileSync(path.join(TRANSLATIONS_DIR, file), 'utf8'));

const supportedCodes: string[] = JSON.parse(fs.readFileSync(LANGUAGES_FILE, 'utf8')).map(
  (lang: { code: string }) => lang.code.toLowerCase()
);

const translationFiles = fs.readdirSync(TRANSLATIONS_DIR).filter((file) => file.endsWith('.json'));
const reference = read('en.json');
const referenceKeys = Object.keys(reference);

/** Placeholders such as {babyName} must survive translation untouched. */
const placeholders = (value: string): string[] =>
  Array.from(value.matchAll(/\{[^}]*\}/g), (match) => match[0]).sort();

describe('translation files', () => {
  it('has a translation file for every supported language', () => {
    const missing = supportedCodes.filter(
      (code) => !fs.existsSync(path.join(TRANSLATIONS_DIR, `${code}.json`))
    );
    expect(missing).toEqual([]);
  });

  it('lists Hindi as a supported language', () => {
    expect(supportedCodes).toContain('hi');
  });

  it.each(translationFiles)('%s covers every key in en.json', (file) => {
    const translations = read(file);
    expect(referenceKeys.filter((key) => !(key in translations))).toEqual([]);
  });

  it.each(translationFiles)('%s preserves the placeholders of en.json', (file) => {
    const translations = read(file);
    const mismatched = referenceKeys.filter(
      (key) =>
        translations[key] &&
        placeholders(translations[key]).join(',') !== placeholders(reference[key]).join(',')
    );
    expect(mismatched).toEqual([]);
  });

  // Fork note: keys added by this fork are deliberately left blank in every
  // non-English locale (scripts/check-missing-translations.js adds them empty,
  // and t() falls back to the English key). Hindi is therefore held to the same
  // bar as its sibling locales rather than a stricter, upstream-only one: it must
  // not be missing anything the other locales have all managed to translate.
  it('hi.json is as fully translated as its sibling locales', () => {
    const hindi = read('hi.json');
    const siblings = translationFiles
      .filter((file) => file !== 'en.json' && file !== 'hi.json')
      .map(read);
    const missing = referenceKeys.filter(
      (key) =>
        !(hindi[key] ?? '').trim() &&
        siblings.every((sibling) => (sibling[key] ?? '').trim())
    );
    expect(missing).toEqual([]);
  });
});
