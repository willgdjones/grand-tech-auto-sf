import { expect, it } from 'vitest';
import { parseInline } from './inline';

// parseInline is the pure half of the safe inline-markdown renderer (M6). renderInline's DOM
// output is a trivial mapping of these tokens; the logic worth pinning is the tokenising.

it('splits bold spans out of surrounding text', () => {
  expect(parseInline('raise with **H** now')).toEqual([
    { kind: 'text', text: 'raise with ' },
    { kind: 'bold', text: 'H' },
    { kind: 'text', text: ' now' },
  ]);
});

it('renders a root-relative link as an internal link', () => {
  expect(parseInline('see [gtasf.com/changelog](/changelog)')).toEqual([
    { kind: 'text', text: 'see ' },
    { kind: 'link', text: 'gtasf.com/changelog', href: '/changelog', external: false },
  ]);
});

it('marks http(s) links external', () => {
  expect(parseInline('[site](https://example.com/x)')).toEqual([
    { kind: 'link', text: 'site', href: 'https://example.com/x', external: true },
  ]);
});

it('never builds a link for an unsafe scheme — only the visible label survives', () => {
  expect(parseInline('[x](javascript:alert1)')).toEqual([{ kind: 'text', text: 'x' }]);
  expect(parseInline('[x](//evil.example)')).toEqual([{ kind: 'text', text: 'x' }]);
  expect(parseInline('[x](data:text/html,oops)')).toEqual([{ kind: 'text', text: 'x' }]);
});

it('leaves unmatched markers as literal text (no false bold/link)', () => {
  expect(parseInline('a ** b and [c] without a target')).toEqual([
    { kind: 'text', text: 'a ** b and [c] without a target' },
  ]);
});

it('passes plain text straight through', () => {
  expect(parseInline('nothing to see here')).toEqual([{ kind: 'text', text: 'nothing to see here' }]);
});

it('handles a bullet that is only a link', () => {
  expect(parseInline('[all updates](/changelog)')).toEqual([
    { kind: 'link', text: 'all updates', href: '/changelog', external: false },
  ]);
});
