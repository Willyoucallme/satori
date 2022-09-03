import { Dict, Awaitable, valueMap, isNullable } from 'cosmokit'

export const kElement = Symbol('element')

type Fragment = string | Element | (string | Element)[]

function isElement(source: any): source is Element {
  return source && typeof source === 'object' && source[kElement]
}

function isFragment(value: any): value is Fragment {
  return value && typeof value === 'object' && !Array.isArray(value) && !isElement(value)
}

function toString(value: any) {
  return isNullable(value) ? '' : '' + value
}

function toElement(content: string | Element) {
  if (typeof content !== 'string') return content
  return h('text', { content })
}

function toElementArray(input: Fragment) {
  if (typeof input === 'string' || isElement(input)) {
    return [toElement(input)]
  } else if (Array.isArray(input)) {
    return input.map(toElement)
  }
}

export interface Element {
  [kElement]: true
  type: string
  attrs: Dict<string>
  children: Element[]
}

interface ElementConstructor extends Element {}

class ElementConstructor {
  toString() {
    if (!this.type) return this.children.join('')
    if (this.type === 'text') return Element.escape(this.attrs.content)
    const attrs = Object.entries(this.attrs).map(([key, value]) => ` ${key}="${Element.escape(value, true)}"`).join('')
    return `<${this.type}${attrs}>${this.children.join('')}</${this.type}>`
  }
}

export function Element(type: string, children?: Fragment): Element
export function Element(type: string, attrs: Dict<any>, children?: Fragment): Element
export function Element(type: string, ...args: any[]) {
  const el = Object.create(ElementConstructor.prototype)
  let attrs: Dict<string> = {}, children: Element[] = []
  if (args[0] && !isFragment(args[0])) {
    attrs = valueMap(args.shift(), toString)
  }
  if (args[0]) children = toElementArray(args[0])
  return Object.assign(el, { type, attrs, children })
}

export namespace Element {
  export type Transformer = boolean | Fragment | ((element: Element, index: number, array: Element[]) => boolean | Fragment)
  export type AsyncTransformer = boolean | Fragment | ((element: Element, index: number, array: Element[]) => Awaitable<boolean | Fragment>)

  export function escape(source: any, inline = false) {
    const result = toString(source)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return inline
      ? result.replace(/"/g, '&quot;')
      : result
  }

  export function unescape(source: string) {
    return toString(source)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
  }

  const tagRegExp = /<(\/?)\s*(\S+)([^>]*)>/
  const attrRegExp = /([^\s=]+)="([^"]*)"/g

  interface Token {
    tag: string
    close: string
    attrs: Dict<string>
  }

  export function parse(source: string) {
    const tokens: (string | Token)[] = []
    let tagCap: RegExpExecArray
    while ((tagCap = tagRegExp.exec(source))) {
      if (tagCap.index) {
        tokens.push(unescape(source.slice(0, tagCap.index)))
      }
      const [_, tag, close, attrs] = tagCap
      const token: Token = { tag, close, attrs: {} }
      let cap: RegExpExecArray
      while ((cap = attrRegExp.exec(attrs))) {
        const [_, key, value] = cap
        token.attrs[key] = unescape(value)
      }
      tokens.push(token)
      source = source.slice(tagCap.index + tagCap[0].length)
    }
    if (source) tokens.push(source)
    const stack = [h(null)]
    for (const token of tokens) {
      if (typeof token === 'string') {
        stack[0].children.push(toElement(token))
      } else if (token.close) {
        stack.shift()
      } else {
        const element = h(token.tag, token.attrs)
        stack[0].children.push(element)
        stack.unshift(element)
      }
    }
    return stack[stack.length - 1].children
  }

  export function transform(source: string | Element[], rules: Dict<Transformer>) {
    const elements = typeof source === 'string' ? parse(source) : source
    const children: Element[] = []
    elements.forEach((element, index, elements) => {
      let result = rules[element.type] ?? rules.default ?? true
      if (typeof result === 'function') {
        result = result(element, index, elements)
      }
      if (result === true) {
        const { type, attrs, children } = element
        children.push(h(type, attrs, transform(children, rules)))
      } else if (result !== false) {
        children.push(...toElementArray(result))
      }
    })
    return children
  }

  export async function transformAsync(source: string | Element[], rules: Dict<AsyncTransformer>): Promise<Element[]> {
    const elements = typeof source === 'string' ? parse(source) : source
    return (await Promise.all(elements.map(async (element, index, elements) => {
      let result = rules[element.type] ?? rules.default ?? true
      if (typeof result === 'function') {
        result = await result(element, index, elements)
      }
      if (result === true) {
        const { type, attrs, children } = element
        return [h(type, attrs, await transformAsync(children, rules))]
      } else if (result !== false) {
        return toElementArray(result)
      } else {
        return []
      }
    }))).flat(1)
  }
}

import h = Element

export { h }