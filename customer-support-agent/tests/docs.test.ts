import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chunkPage, parseLlmsFull } from '../lib/docs'

const SAMPLE = `# Site, Full Content
> preamble

## Product
- not a page: no Source line

## Quickstart
Source: https://example.com/docs/quickstart
Documentation > Getting started

Install the SDK.

#### Send a request
Point the client at the base URL.

## A blog post
Source: https://example.com/blog/post
Text.
`

describe('parseLlmsFull', () => {
  it('keeps pages with a Source line, under the prefix', () => {
    const pages = parseLlmsFull(SAMPLE, ['https://example.com/docs'])
    assert.deepEqual(pages.map((p) => p.url), ['https://example.com/docs/quickstart'])
    assert.equal(pages[0].title, 'Quickstart')
    assert.ok(!pages[0].text.includes('Source:'))
  })

  it('keeps pages under any of several prefixes', () => {
    const pages = parseLlmsFull(SAMPLE, ['https://example.com/docs', 'https://example.com/blog'])
    assert.deepEqual(pages.map((p) => p.url), ['https://example.com/docs/quickstart', 'https://example.com/blog/post'])
  })

  it('keeps every page without a prefix', () => {
    assert.equal(parseLlmsFull(SAMPLE).length, 2)
  })
})

describe('chunkPage', () => {
  it('splits at section headings and labels each passage with its page and section', () => {
    const [page] = parseLlmsFull(SAMPLE, ['https://example.com/docs'])
    const passages = chunkPage(page)
    assert.deepEqual(passages.map((p) => p.heading), ['Quickstart', 'Quickstart > Send a request'])
    assert.equal(passages[1].text, 'Point the client at the base URL.')
  })

  it('packs paragraphs up to the limit without cutting one', () => {
    const page = { title: 'T', url: 'u', text: ['a'.repeat(900), 'b'.repeat(900), 'c'.repeat(50)].join('\n\n') }
    const passages = chunkPage(page, 1000)
    assert.equal(passages.length, 2)
    assert.equal(passages[0].text, 'a'.repeat(900))
  })

  it('leaves out navigation sections such as Related', () => {
    const page = { title: 'T', url: 'u', text: 'Body.\n\n### Related\n\n- [A](/a)\n- [B](/b)' }
    assert.deepEqual(chunkPage(page).map((p) => p.heading), ['T'])
  })
})
