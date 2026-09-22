#!/usr/bin/env python3
"""
NXP4 // THE SOURCE // FORGED // NOT STOLEN FROM HEAVEN
A tiny working interpreter for the NXP4 weave-language.

Usage:
    python3 nxp4.py program.nxp4

The language:
    ·· lines are annotations (intent, sigil, human notes, BOOT).
    X ::= expr ◼            bind a name
    NAME KIND ⟦ ... ⟧       forge a named weave (a record of bindings)
    ⟦ ... ⟧                 a block — a weave under construction
    A ⥂ B                   weave two weaves (merge) or two strings (join)
    X lock / X lock ⟦...⟧   seal a weave — it cannot be unwoven after
    ⟠ name ⟦params⟧ ⟦body⟧ ◼  define a weave-function
    return expr ◼            return from inside a weave-function
    ·· BOOT name             entry point — invoke the named weave-function

Rules of the source:
    - Unbound names are forgiven: they become sigils (◈NAME), not errors.
    - A block that speaks only once becomes what it said.
    - The word `weave` after ⥂ is ceremonial and ignored.
    - `verified ::= true` inside a weave earns the ✔ VERIFIED stamp.
"""

import re
import sys

# ---------------------------------------------------------------- tokens ---

TT_ANNOT = 'ANNOT'
TT_IDENT = 'IDENT'
TT_STRING = 'STRING'
TT_BIND = '::='
TT_LBLOCK = '\u27e6'    # ⟦
TT_RBLOCK = '\u27e7'    # ⟧
TT_WEAVEDEF = '\u27e0'  # ⟠
TT_WEAVEOP = '\u2942'   # ⥂
TT_END = '\u25fc'       # ◼
TT_EOF = 'EOF'


def tokenize(src):
    toks = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in ' \t\r\n':
            i += 1
            continue
        if src.startswith('\u00b7\u00b7', i):          # ·· annotation
            j = src.find('\n', i)
            if j == -1:
                j = n
            toks.append((TT_ANNOT, src[i:j]))
            i = j
            continue
        if c == '\u00ab':                              # « string »
            j = src.find('\u00bb', i + 1)
            if j == -1:
                raise SyntaxError('unterminated «string»')
            toks.append((TT_STRING, src[i + 1:j]))
            i = j + 1
            continue
        if src.startswith('::=', i):
            toks.append((TT_BIND, '::='))
            i += 3
            continue
        if c in '\u27e6\u27e7\u27e0\u2942\u25fc':
            toks.append((c, c))
            i += 1
            continue
        if c.isalpha() or c == '_':
            j = i
            while j < n and (src[j].isalnum() or src[j] == '_'):
                j += 1
            toks.append((TT_IDENT, src[i:j]))
            i = j
            continue
        raise SyntaxError('unexpected character %r' % c)
    toks.append((TT_EOF, ''))
    return toks


# ---------------------------------------------------------------- parser ---

class Parser:
    def __init__(self, toks):
        self.toks = toks
        self.pos = 0

    def peek(self):
        return self.toks[self.pos]

    def peek2(self):
        return self.toks[self.pos + 1]

    def next(self):
        t = self.toks[self.pos]
        self.pos += 1
        return t

    def expect(self, typ):
        t = self.next()
        if t[0] != typ:
            raise SyntaxError('expected %s, got %s %r' % (typ, t[0], t[1]))
        return t

    # program := statement*
    def parse_program(self):
        stmts = []
        while self.peek()[0] != TT_EOF:
            stmts.append(self.parse_statement(in_block=False))
        return stmts

    def parse_params(self):
        self.expect(TT_LBLOCK)
        params = []
        while self.peek()[0] != TT_RBLOCK:
            params.append(self.expect(TT_IDENT)[1])
        self.expect(TT_RBLOCK)
        return params

    def parse_block(self):
        self.expect(TT_LBLOCK)
        stmts = []
        while self.peek()[0] != TT_RBLOCK:
            if self.peek()[0] == TT_EOF:
                raise SyntaxError('unterminated block \u27e6')
            stmts.append(self.parse_statement(in_block=True))
        self.expect(TT_RBLOCK)
        return stmts

    def parse_weavedef(self):
        self.expect(TT_WEAVEDEF)
        name = self.expect(TT_IDENT)[1]
        params = self.parse_params()
        body = self.parse_block()
        self.expect(TT_END)
        return ('weavedef', name, params, body)

    def _expect_end(self, in_block):
        # ◼ terminates a statement; inside a block it may be omitted
        # right before the closing ⟧.
        if self.peek()[0] == TT_END:
            self.next()
        elif not (in_block and self.peek()[0] == TT_RBLOCK):
            raise SyntaxError('expected \u25fc, got %s %r' % self.peek())

    def parse_statement(self, in_block):
        t = self.peek()
        if t[0] == TT_ANNOT:
            self.next()
            return ('annot', t[1])
        if t[0] == TT_WEAVEDEF:
            return self.parse_weavedef()
        if t[0] == TT_IDENT and t[1] == 'return':
            self.next()
            e = self.parse_expr()
            self._expect_end(in_block)
            return ('return', e)
        if t[0] == TT_IDENT:
            t2 = self.peek2()
            if t2[0] == TT_IDENT:
                # NAME KIND ⟦ ... ⟧
                name = self.next()[1]
                kind = self.next()[1]
                body = self.parse_block()
                if self.peek()[0] == TT_END:   # tolerated, not required
                    self.next()
                return ('named', name, kind, body)
            if t2[0] == TT_BIND:
                name = self.next()[1]
                self.next()
                e = self.parse_expr()
                self._expect_end(in_block)
                return ('bind', name, e)
        # expression statement
        e = self.parse_expr()
        self._expect_end(in_block)
        return ('exprstmt', e)

    # expr := lock_expr (⥂ [weave] lock_expr)*
    def parse_expr(self):
        left = self.parse_lock()
        while self.peek()[0] == TT_WEAVEOP:
            self.next()
            if self.peek()[0] == TT_IDENT and self.peek()[1] == 'weave':
                self.next()                      # ceremonial
            right = self.parse_lock()
            left = ('weave', left, right)
        return left

    # lock_expr := primary (lock [block])?
    def parse_lock(self):
        node = self.parse_primary()
        if self.peek()[0] == TT_IDENT and self.peek()[1] == 'lock':
            self.next()
            blk = self.parse_block() if self.peek()[0] == TT_LBLOCK else None
            node = ('lock', node, blk)
        return node

    def parse_primary(self):
        t = self.peek()
        if t[0] == TT_STRING:
            self.next()
            return ('str', t[1])
        if t[0] == TT_IDENT:
            if t[1] == 'true':
                self.next()
                return ('bool', True)
            if t[1] == 'false':
                self.next()
                return ('bool', False)
            self.next()
            name = t[1]
            if self.peek()[0] == TT_LBLOCK:
                return ('call', name, self.parse_block())
            return ('ident', name)
        if t[0] == TT_LBLOCK:
            return ('block', self.parse_block())
        raise SyntaxError('unexpected %s %r in expression' % (t[0], t[1]))


# --------------------------------------------------------------- values ---

class Sigil:
    """An unbound name, forgiven by the source."""
    def __init__(self, name):
        self.name = name


class Weave:
    def __init__(self, bindings=None, name=None, kind=None):
        self.bindings = dict(bindings or {})
        self.name = name
        self.kind = kind
        self.sealed = False


class Func:
    def __init__(self, name, params, body, closure):
        self.name = name
        self.params = params
        self.body = body
        self.closure = closure


class Env:
    def __init__(self, parent=None):
        self.parent = parent
        self.vars = {}

    def define(self, k, v):
        self.vars[k] = v

    def lookup(self, k):
        e = self
        while e is not None:
            if k in e.vars:
                return e.vars[k]
            e = e.parent
        return None

    def child(self):
        return Env(self)


class ReturnSignal(Exception):
    def __init__(self, value):
        self.value = value


_MISSING = object()


def fmt(v):
    if isinstance(v, str):
        return '\u00ab%s\u00bb' % v
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, Sigil):
        return '\u25c8%s' % v.name
    if isinstance(v, Weave):
        inner = ' '.join('%s ::= %s \u25fc' % (k, fmt(x))
                         for k, x in v.bindings.items())
        tag = '%s(%s)' % (v.name, v.kind) if v.name else 'weave'
        seal = ' SEALED' if v.sealed else ''
        return '%s\u27e6%s\u27e7%s' % (tag, inner, seal)
    if isinstance(v, Func):
        return '\u27e0%s\u27e6%s\u27e7' % (v.name, ', '.join(v.params))
    return str(v)


def label(v):
    if isinstance(v, Weave):
        base = v.name or 'weave'
        return base + '(SEALED)' if v.sealed else base
    if isinstance(v, str):
        return '\u00ab%s\u00bb' % v
    if isinstance(v, Sigil):
        return '\u25c8' + v.name
    return type(v).__name__


def weave_values(a, b, trace):
    if isinstance(a, Weave) and isinstance(b, Weave):
        merged = Weave(dict(a.bindings))
        merged.bindings.update(b.bindings)
        if a.name:
            merged.name, merged.kind = a.name, a.kind
        trace.append('\u2942 wove %s + %s \u2192 %d bindings'
                     % (label(a), label(b), len(merged.bindings)))
        return merged
    if isinstance(a, str) and isinstance(b, str):
        trace.append('\u2942 joined \u00ab%s\u00bb + \u00ab%s\u00bb' % (a, b))
        return a + b
    raise RuntimeError('cannot weave %s with %s' % (label(a), label(b)))


def seal_weave(v, trace):
    if not isinstance(v, Weave):
        raise RuntimeError('lock seals weaves, not %s' % label(v))
    w = Weave(dict(v.bindings), name=v.name, kind=v.kind)
    w.sealed = True
    trace.append('lock: %s \u2192 SEALED' % label(v))
    return w


def eval_expr(node, env, trace):
    k = node[0]
    if k == 'str':
        return node[1]
    if k == 'bool':
        return node[1]
    if k == 'ident':
        v = env.lookup(node[1])
        return v if v is not None else Sigil(node[1])   # the source forgives
    if k == 'block':
        return eval_block(node[1], env, trace)
    if k == 'weave':
        return weave_values(eval_expr(node[1], env, trace),
                            eval_expr(node[2], env, trace), trace)
    if k == 'lock':
        v = eval_expr(node[1], env, trace)
        if node[2] is not None:
            extra = eval_block(node[2], env, trace)
            if not isinstance(extra, Weave):
                raise RuntimeError('can only lock a weave with a weave')
            v = weave_values(v, extra, trace)
        return seal_weave(v, trace)
    if k == 'call':
        f = env.lookup(node[1])
        if not isinstance(f, Func):
            raise RuntimeError('\u00ab%s\u00bb is not a weave that answers'
                               % node[1])
        return call_func(f, eval_block(node[2], env, trace), trace)
    raise RuntimeError('unknown expression %r' % (node,))


def exec_stmts(stmts, env, trace, utterances):
    bound = {}
    last = _MISSING
    for s in stmts:
        k = s[0]
        if k == 'annot':
            continue
        elif k == 'bind':
            _, name, e = s
            v = eval_expr(e, env, trace)
            env.define(name, v)
            bound[name] = v
        elif k == 'named':
            _, name, kind, body = s
            w = eval_block(body, env, trace)
            if not isinstance(w, Weave):
                w = Weave({'value': w})
            w.name, w.kind = name, kind
            env.define(name, w)
            bound[name] = w
            trace.append('\u27e6 forged %s(%s) \u2014 %d bindings'
                         % (name, kind, len(w.bindings)))
            if w.bindings.get('verified') is True:
                trace.append('\u2714 %s(%s) VERIFIED' % (name, kind))
        elif k == 'weavedef':
            _, name, params, body = s
            f = Func(name, params, body, env)
            env.define(name, f)
            bound[name] = f
            trace.append('\u27e0 %s\u27e6%s\u27e7 \u2014 FORGED'
                         % (name, ', '.join(params)))
        elif k == 'return':
            raise ReturnSignal(eval_expr(s[1], env, trace))
        elif k == 'exprstmt':
            last = eval_expr(s[1], env, trace)
            if utterances is not None:
                utterances.append(last)
    return bound, last


def eval_block(stmts, env, trace):
    child = env.child()
    bound, last = exec_stmts(stmts, child, trace, None)
    if not bound and last is not _MISSING:
        return last            # a block that speaks once becomes what it said
    return Weave(bound)


def call_func(f, arg, trace):
    callenv = f.closure.child()
    if len(f.params) == 1:
        callenv.define(f.params[0], arg)
    elif f.params:
        if not isinstance(arg, Weave):
            raise RuntimeError('weave %s needs named payload bindings'
                               % f.name)
        for p in f.params:
            callenv.define(p, arg.bindings.get(p, Sigil(p)))
    trace.append('\u27e0 invoking %s \u2014 payload <= %s'
                 % (f.name, label(arg)))
    try:
        return eval_block(f.body, callenv, trace)
    except ReturnSignal as rs:
        trace.append('\u25fc return %s' % fmt(rs.value))
        return rs.value


# ------------------------------------------------------------------ driver ---

def apply_annot(text, meta):
    t = text[2:].strip() if text.startswith('\u00b7\u00b7') else text.strip()
    m = re.match(r'BOOT\s+([A-Za-z_]\w*)\s*$', t)
    if m:
        meta['boot'] = m.group(1)
        return
    m = re.match(r'([A-Za-z_]\w*)\s*::=\s*(.*)$', t, re.S)
    if m:
        name, val = m.group(1), m.group(2).strip()
        if val.endswith('\u25fc'):
            val = val[:-1].strip()
        val = val.strip('\u00ab\u00bb')
        if name == 'intent':
            meta['intent'] = val
        elif name == 'sigil':
            meta['sigil'] = [p.strip() for p in val.split('/') if p.strip()]


def main(argv):
    if len(argv) < 2:
        print('usage: python3 nxp4.py program.nxp4')
        return 1
    with open(argv[1], encoding='utf-8') as fh:
        src = fh.read()
    try:
        prog = Parser(tokenize(src)).parse_program()
    except SyntaxError as e:
        print('\u00b7\u00b7 GRAMMAR BREAK: %s' % e)
        return 1

    meta = {'intent': None, 'sigil': [], 'boot': None}
    for s in prog:
        if s[0] == 'annot':
            apply_annot(s[1], meta)

    env, trace, utterances = Env(), [], []
    try:
        try:
            exec_stmts(prog, env, trace, utterances)
        except ReturnSignal as rs:
            utterances.append(rs.value)
    except RuntimeError as e:
        print('\u00b7\u00b7 the weave broke: %s' % e)
        return 1

    print('\u00b7\u00b7 NXP4 // THE SOURCE // FORGED // NOT STOLEN FROM HEAVEN')
    if meta['sigil']:
        print('\u00b7\u00b7 sigil ::= ' + ' / '.join(meta['sigil']))
    if meta['intent']:
        print('\u00b7\u00b7 intent ::= \u00ab%s\u00bb' % meta['intent'])
    for u in utterances:
        print('\u00b7\u00b7 %s' % fmt(u))

    if not meta['boot']:
        print('\u00b7\u00b7 no BOOT directive \u2014 the source idles.')
        return 0
    f = env.lookup(meta['boot'])
    if not isinstance(f, Func):
        avail = sorted(k for k, v in env.vars.items() if isinstance(v, Func))
        print('\u00b7\u00b7 BOOT target \u00ab%s\u00bb not found in the weave.'
              % meta['boot'])
        print('\u00b7\u00b7 weaves that answer: %s'
              % (', '.join(avail) if avail else 'none'))
        return 1
    payload = env.lookup('HEAVEN')
    if payload is None:
        payload = Weave()
    print('\u27e0 BOOT %s \u2014 payload <= %s' % (f.name, label(payload)))
    try:
        result = call_func(f, payload, trace)
    except RuntimeError as e:
        print('\u00b7\u00b7 the weave broke: %s' % e)
        return 1
    for line in trace:
        print('  ' + line)
    print('\u00b7\u00b7 BOOT COMPLETE \u2014 %s' % fmt(result))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
