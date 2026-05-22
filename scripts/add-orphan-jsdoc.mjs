#!/usr/bin/env node
// Add a `/** @deprecated ... */` JSDoc above every Meteor.methods entry that
// the audit flagged as an orphan (no caller). Reads docs/ddp-audit.json for
// the orphan list and walks each registration file.
//
// Idempotent: if the previous line already contains "@deprecated", skip.
//
// Usage:
//   node scripts/add-orphan-jsdoc.mjs --dry-run     # default
//   node scripts/add-orphan-jsdoc.mjs --apply

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = join(ROOT, 'docs/ddp-audit.json');
const argv = process.argv.slice(2);
const flags = { apply: argv.includes('--apply') };

const COMMENT = '\t/**\n\t * @deprecated Scheduled for removal in 9.0.0. No caller found in this repository — kept for external DDP clients only.\n\t */\n';

function loadAudit() {
	return JSON.parse(readFileSync(AUDIT, 'utf8'));
}

// Find every `Meteor.methods({...})` body span in the source file.
function methodsBodySpans(src) {
	const spans = [];
	const needle = 'Meteor.methods';
	let i = 0;
	while ((i = src.indexOf(needle, i)) !== -1) {
		let j = i + needle.length;
		while (j < src.length && /\s/.test(src[j])) j++;
		if (src[j] === '<') {
			let td = 1;
			j++;
			while (j < src.length && td > 0) {
				if (src[j] === '<') td++;
				else if (src[j] === '>') td--;
				j++;
			}
			while (j < src.length && /\s/.test(src[j])) j++;
		}
		if (src[j] !== '(') { i = j + 1; continue; }
		j++;
		while (j < src.length && /\s/.test(src[j])) j++;
		if (src[j] !== '{') { i = j; continue; }
		const bodyStart = j + 1;
		let depth = 1;
		let k = bodyStart;
		while (k < src.length && depth > 0) {
			const c = src[k];
			if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k === -1) k = src.length; continue; }
			if (c === '/' && src[k + 1] === '*') { const end = src.indexOf('*/', k + 2); k = end === -1 ? src.length : end + 2; continue; }
			if (c === '"' || c === "'" || c === '`') {
				const q = c;
				k++;
				while (k < src.length) {
					if (src[k] === '\\') { k += 2; continue; }
					if (src[k] === q) { k++; break; }
					k++;
				}
				continue;
			}
			if (c === '{') depth++;
			else if (c === '}') depth--;
			k++;
		}
		spans.push({ bodyStart, bodyEnd: k - 1 });
		i = k;
	}
	return spans;
}

// Find the registration line for `method` only inside a Meteor.methods body so
// we don't match the ServerMethods interface declaration above it.
function findRegistrationLine(src, method) {
	const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`^[\\t ]*(?:async\\s+)?['"]${escaped}['"]\\s*[:(]`, 'm'),
		new RegExp(`^[\\t ]*(?:async\\s+)?${escaped}\\s*[:(]`, 'm'),
	];
	for (const span of methodsBodySpans(src)) {
		const body = src.slice(span.bodyStart, span.bodyEnd);
		for (const re of patterns) {
			const m = re.exec(body);
			if (m) return span.bodyStart + m.index;
		}
	}
	return -1;
}

function alreadyHasJsdoc(src, regOffset) {
	// Look at the lines immediately above the registration; if a JSDoc end (`*/`)
	// appears within 5 lines and contains `@deprecated`, consider it already
	// annotated.
	const before = src.slice(0, regOffset);
	const tail = before.split('\n').slice(-6).join('\n');
	return tail.includes('@deprecated');
}

function indentMatching(src, regOffset) {
	let s = regOffset;
	while (s > 0 && src[s - 1] !== '\n') s--;
	const lineStart = s;
	let indent = '';
	let i = lineStart;
	while (i < src.length && (src[i] === '\t' || src[i] === ' ')) {
		indent += src[i];
		i++;
	}
	return { lineStart, indent };
}

function main() {
	const audit = loadAudit();
	const orphans = audit.orphans;
	const summary = { annotated: 0, skipped: 0, missing: 0, perFile: [] };

	// Group orphans by file.
	const byFile = new Map();
	for (const o of orphans) {
		for (const reg of o.registrations) {
			const fileAbs = join(ROOT, reg.file);
			if (!byFile.has(fileAbs)) byFile.set(fileAbs, []);
			byFile.get(fileAbs).push(o.method);
		}
	}

	for (const [fileAbs, names] of byFile) {
		let src;
		try { src = readFileSync(fileAbs, 'utf8'); } catch {
			summary.missing += names.length;
			continue;
		}

		// Sort target methods by their position in the file, descending, so
		// inserting comments doesn't shift subsequent offsets.
		const positioned = names
			.map((name) => ({ name, offset: findRegistrationLine(src, name) }))
			.filter((p) => p.offset !== -1)
			.sort((a, b) => b.offset - a.offset);

		const notFound = names.filter((n) => !positioned.some((p) => p.name === n));
		summary.missing += notFound.length;
		for (const n of notFound) console.error(`MISSING: ${relative(ROOT, fileAbs)} :: ${n}`);

		const annotated = [];
		for (const { name, offset } of positioned) {
			if (alreadyHasJsdoc(src, offset)) {
				summary.skipped++;
				continue;
			}
			const { lineStart, indent } = indentMatching(src, offset);
			const comment = `${indent}/**\n${indent} * @deprecated Scheduled for removal in 9.0.0. No caller found in this repository — kept for external DDP clients only.\n${indent} */\n`;
			src = src.slice(0, lineStart) + comment + src.slice(lineStart);
			summary.annotated++;
			annotated.push(name);
		}

		if (annotated.length) {
			summary.perFile.push({ file: relative(ROOT, fileAbs), annotated });
			if (flags.apply) writeFileSync(fileAbs, src);
		}
	}

	console.error('');
	console.error(`Annotated: ${summary.annotated}`);
	console.error(`Skipped (already had @deprecated): ${summary.skipped}`);
	console.error(`Missing (could not locate registration): ${summary.missing}`);
	console.error('');
	for (const f of summary.perFile.slice(0, 30)) {
		console.error(`  ${f.file}`);
		for (const n of f.annotated) console.error(`    + ${n}`);
	}
	if (summary.perFile.length > 30) console.error(`  ... and ${summary.perFile.length - 30} more`);
	if (!flags.apply) console.error('\nDry run only. Pass --apply to write changes.');
}

main();
