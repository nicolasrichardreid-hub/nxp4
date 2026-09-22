// NXP4 // THE SOURCE // FORGED // NOT STOLEN FROM HEAVEN
// JavaScript port of nxp4.py — tokenizer → recursive-descent parser →
// tree-walking evaluator. Faithful to the Python original, line for line
// where the languages allow.
//
// Browser:  NXP4.run(source) -> { ok, lines }
// Node:     module.exports = { runNXP4 }

const TT_ANNOT = 'ANNOT';
const TT_IDENT = 'IDENT';
const TT_STRING = 'STRING';
const TT_BIND = '::=';
const TT_LBLOCK = '⟦';
const TT_RBLOCK = '⟧';
const TT_WEAVEDEF = '⟠';
const TT_WEAVEOP = '⥂';
const TT_END = '◼';
const TT_EOF = 'EOF';

const MISSING = {};

// ---------------------------------------------------------------- tokens ---

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const isIdStart = (c) => c === '_' || /\p{L}/u.test(c);
  const isIdCont = (c) => c === '_' || /[\p{L}\p{N}]/u.test(c);
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (src.startsWith('··', i)) {                       // ·· annotation
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      toks.push([TT_ANNOT, src.slice(i, j)]);
      i = j;
      continue;
    }
    if (c === '«') {                                     // « string »
      const j = src.indexOf('»', i + 1);
      if (j === -1) throw new SyntaxError('unterminated «string»');
      toks.push([TT_STRING, src.slice(i + 1, j)]);
      i = j + 1;
      continue;
    }
    if (src.startsWith('::=', i)) {
      toks.push([TT_BIND, '::=']);
      i += 3;
      continue;
    }
    if ('⟦⟧⟠⥂◼'.includes(c)) {
      toks.push([c, c]);
      i += 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdCont(src[j])) j++;
      toks.push([TT_IDENT, src.slice(i, j)]);
      i = j;
      continue;
    }
    throw new SyntaxError('unexpected character ' + JSON.stringify(c));
  }
  toks.push([TT_EOF, '']);
  return toks;
}

// ---------------------------------------------------------------- parser ---

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.pos = 0;
  }
  peek() { return this.toks[this.pos]; }
  peek2() { return this.toks[this.pos + 1]; }
  next() { return this.toks[this.pos++]; }
  expect(typ) {
    const t = this.next();
    if (t[0] !== typ) throw new SyntaxError('expected ' + typ + ', got ' + t[0] + ' ' + JSON.stringify(t[1]));
    return t;
  }

  // program := statement*
  parse_program() {
    const stmts = [];
    while (this.peek()[0] !== TT_EOF) stmts.push(this.parse_statement(false));
    return stmts;
  }

  parse_params() {
    this.expect(TT_LBLOCK);
    const params = [];
    while (this.peek()[0] !== TT_RBLOCK) params.push(this.expect(TT_IDENT)[1]);
    this.expect(TT_RBLOCK);
    return params;
  }

  parse_block() {
    this.expect(TT_LBLOCK);
    const stmts = [];
    while (this.peek()[0] !== TT_RBLOCK) {
      if (this.peek()[0] === TT_EOF) throw new SyntaxError('unterminated block ⟦');
      stmts.push(this.parse_statement(true));
    }
    this.expect(TT_RBLOCK);
    return stmts;
  }

  parse_weavedef() {
    this.expect(TT_WEAVEDEF);
    const name = this.expect(TT_IDENT)[1];
    const params = this.parse_params();
    const body = this.parse_block();
    this.expect(TT_END);
    return ['weavedef', name, params, body];
  }

  _expect_end(in_block) {
    // ◼ terminates a statement; inside a block it may be omitted
    // right before the closing ⟧.
    if (this.peek()[0] === TT_END) {
      this.next();
    } else if (!(in_block && this.peek()[0] === TT_RBLOCK)) {
      throw new SyntaxError('expected ◼, got ' + this.peek()[0] + ' ' + JSON.stringify(this.peek()[1]));
    }
  }

  parse_statement(in_block) {
    const t = this.peek();
    if (t[0] === TT_ANNOT) {
      this.next();
      return ['annot', t[1]];
    }
    if (t[0] === TT_WEAVEDEF) return this.parse_weavedef();
    if (t[0] === TT_IDENT && t[1] === 'return') {
      this.next();
      const e = this.parse_expr();
      this._expect_end(in_block);
      return ['return', e];
    }
    if (t[0] === TT_IDENT) {
      const t2 = this.peek2();
      if (t2[0] === TT_IDENT) {
        // NAME KIND ⟦ ... ⟧
        const name = this.next()[1];
        const kind = this.next()[1];
        const body = this.parse_block();
        if (this.peek()[0] === TT_END) this.next();   // tolerated, not required
        return ['named', name, kind, body];
      }
      if (t2[0] === TT_BIND) {
        const name = this.next()[1];
        this.next();
        const e = this.parse_expr();
        this._expect_end(in_block);
        return ['bind', name, e];
      }
    }
    // expression statement
    const e = this.parse_expr();
    this._expect_end(in_block);
    return ['exprstmt', e];
  }

  // expr := lock_expr (⥂ [weave] lock_expr)*
  parse_expr() {
    let left = this.parse_lock();
    while (this.peek()[0] === TT_WEAVEOP) {
      this.next();
      if (this.peek()[0] === TT_IDENT && this.peek()[1] === 'weave') this.next();  // ceremonial
      const right = this.parse_lock();
      left = ['weave', left, right];
    }
    return left;
  }

  // lock_expr := primary (lock [block])?
  parse_lock() {
    let node = this.parse_primary();
    if (this.peek()[0] === TT_IDENT && this.peek()[1] === 'lock') {
      this.next();
      const blk = this.peek()[0] === TT_LBLOCK ? this.parse_block() : null;
      node = ['lock', node, blk];
    }
    return node;
  }

  parse_primary() {
    const t = this.peek();
    if (t[0] === TT_STRING) {
      this.next();
      return ['str', t[1]];
    }
    if (t[0] === TT_IDENT) {
      if (t[1] === 'true') { this.next(); return ['bool', true]; }
      if (t[1] === 'false') { this.next(); return ['bool', false]; }
      this.next();
      const name = t[1];
      if (this.peek()[0] === TT_LBLOCK) return ['call', name, this.parse_block()];
      return ['ident', name];
    }
    if (t[0] === TT_LBLOCK) return ['block', this.parse_block()];
    throw new SyntaxError('unexpected ' + t[0] + ' ' + JSON.stringify(t[1]) + ' in expression');
  }
}

// --------------------------------------------------------------- values ---

class Sigil {
  // An unbound name, forgiven by the source.
  constructor(name) { this.name = name; }
}

class Weave {
  constructor(bindings, name, kind) {
    this.bindings = Object.assign({}, bindings || {});
    this.name = name == null ? null : name;
    this.kind = kind == null ? null : kind;
    this.sealed = false;
  }
}

class Func {
  constructor(name, params, body, closure) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
  }
}

class Env {
  constructor(parent) {
    this.parent = parent || null;
    this.vars = {};
  }
  define(k, v) { this.vars[k] = v; }
  lookup(k) {
    let e = this;
    while (e !== null) {
      if (Object.prototype.hasOwnProperty.call(e.vars, k)) return e.vars[k];
      e = e.parent;
    }
    return null;
  }
  child() { return new Env(this); }
}

class ReturnSignal extends Error {
  constructor(value) {
    super('return');
    this.value = value;
  }
}

function fmt(v) {
  if (typeof v === 'string') return '«' + v + '»';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Sigil) return '◈' + v.name;
  if (v instanceof Weave) {
    const inner = Object.entries(v.bindings).map(([k, x]) => k + ' ::= ' + fmt(x) + ' ◼').join(' ');
    const tag = v.name ? v.name + '(' + v.kind + ')' : 'weave';
    const seal = v.sealed ? ' SEALED' : '';
    return tag + '⟦' + inner + '⟧' + seal;
  }
  if (v instanceof Func) return '⟠' + v.name + '⟦' + v.params.join(', ') + '⟧';
  return String(v);
}

function label(v) {
  if (v instanceof Weave) {
    const base = v.name || 'weave';
    return v.sealed ? base + '(SEALED)' : base;
  }
  if (typeof v === 'string') return '«' + v + '»';
  if (v instanceof Sigil) return '◈' + v.name;
  return typeof v;
}

function weave_values(a, b, trace) {
  if (a instanceof Weave && b instanceof Weave) {
    const merged = new Weave(a.bindings);
    Object.assign(merged.bindings, b.bindings);
    if (a.name) { merged.name = a.name; merged.kind = a.kind; }
    trace.push('⥂ wove ' + label(a) + ' + ' + label(b) + ' → ' + Object.keys(merged.bindings).length + ' bindings');
    return merged;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    trace.push('⥂ joined «' + a + '» + «' + b + '»');
    return a + b;
  }
  throw new Error('cannot weave ' + label(a) + ' with ' + label(b));
}

function seal_weave(v, trace) {
  if (!(v instanceof Weave)) throw new Error('lock seals weaves, not ' + label(v));
  const w = new Weave(v.bindings, v.name, v.kind);
  w.sealed = true;
  trace.push('lock: ' + label(v) + ' → SEALED');
  return w;
}

function eval_expr(node, env, trace) {
  const k = node[0];
  if (k === 'str') return node[1];
  if (k === 'bool') return node[1];
  if (k === 'ident') {
    const v = env.lookup(node[1]);
    return v !== null ? v : new Sigil(node[1]);   // the source forgives
  }
  if (k === 'block') return eval_block(node[1], env, trace);
  if (k === 'weave') return weave_values(eval_expr(node[1], env, trace), eval_expr(node[2], env, trace), trace);
  if (k === 'lock') {
    let v = eval_expr(node[1], env, trace);
    if (node[2] !== null) {
      const extra = eval_block(node[2], env, trace);
      if (!(extra instanceof Weave)) throw new Error('can only lock a weave with a weave');
      v = weave_values(v, extra, trace);
    }
    return seal_weave(v, trace);
  }
  if (k === 'call') {
    const f = env.lookup(node[1]);
    if (!(f instanceof Func)) throw new Error('«' + node[1] + '» is not a weave that answers');
    return call_func(f, eval_block(node[2], env, trace), trace);
  }
  throw new Error('unknown expression ' + JSON.stringify(node));
}

function exec_stmts(stmts, env, trace, utterances) {
  const bound = {};
  let last = MISSING;
  for (const s of stmts) {
    const k = s[0];
    if (k === 'annot') {
      continue;
    } else if (k === 'bind') {
      const v = eval_expr(s[2], env, trace);
      env.define(s[1], v);
      bound[s[1]] = v;
    } else if (k === 'named') {
      let w = eval_block(s[3], env, trace);
      if (!(w instanceof Weave)) w = new Weave({ value: w });
      w.name = s[1];
      w.kind = s[2];
      env.define(s[1], w);
      bound[s[1]] = w;
      trace.push('⟦ forged ' + s[1] + '(' + s[2] + ') — ' + Object.keys(w.bindings).length + ' bindings');
      if (w.bindings['verified'] === true) trace.push('✔ ' + s[1] + '(' + s[2] + ') VERIFIED');
    } else if (k === 'weavedef') {
      const f = new Func(s[1], s[2], s[3], env);
      env.define(s[1], f);
      bound[s[1]] = f;
      trace.push('⟠ ' + s[1] + '⟦' + s[2].join(', ') + '⟧ — FORGED');
    } else if (k === 'return') {
      throw new ReturnSignal(eval_expr(s[1], env, trace));
    } else if (k === 'exprstmt') {
      last = eval_expr(s[1], env, trace);
      if (utterances !== null) utterances.push(last);
    }
  }
  return [bound, last];
}

function eval_block(stmts, env, trace) {
  const child = env.child();
  const [bound, last] = exec_stmts(stmts, child, trace, null);
  if (Object.keys(bound).length === 0 && last !== MISSING) return last;  // a block that speaks once becomes what it said
  return new Weave(bound);
}

function call_func(f, arg, trace) {
  const callenv = f.closure.child();
  if (f.params.length === 1) {
    callenv.define(f.params[0], arg);
  } else if (f.params.length) {
    if (!(arg instanceof Weave)) throw new Error('weave ' + f.name + ' needs named payload bindings');
    for (const p of f.params) {
      callenv.define(p, Object.prototype.hasOwnProperty.call(arg.bindings, p) ? arg.bindings[p] : new Sigil(p));
    }
  }
  trace.push('⟠ invoking ' + f.name + ' — payload <= ' + label(arg));
  try {
    return eval_block(f.body, callenv, trace);
  } catch (e) {
    if (e instanceof ReturnSignal) {
      trace.push('◼ return ' + fmt(e.value));
      return e.value;
    }
    throw e;
  }
}

// ------------------------------------------------------------------ driver ---

function apply_annot(text, meta) {
  const t = text.startsWith('··') ? text.slice(2).trim() : text.trim();
  let m = t.match(/^BOOT\s+([A-Za-z_]\w*)\s*$/);
  if (m) {
    meta.boot = m[1];
    return;
  }
  m = t.match(/^([A-Za-z_]\w*)\s*::=\s*(.*)$/s);
  if (m) {
    const name = m[1];
    let val = m[2].trim();
    if (val.endsWith('◼')) val = val.slice(0, -1).trim();
    val = val.replace(/^«|»$/g, '');
    if (name === 'intent') meta.intent = val;
    else if (name === 'sigil') meta.sigil = val.split('/').map((p) => p.trim()).filter(Boolean);
  }
}

function runNXP4(src) {
  const lines = [];
  const out = (s) => lines.push(s);
  let prog;
  try {
    prog = new Parser(tokenize(src)).parse_program();
  } catch (e) {
    out('·· GRAMMAR BREAK: ' + e.message);
    return { ok: false, lines };
  }

  const meta = { intent: null, sigil: [], boot: null };
  for (const s of prog) if (s[0] === 'annot') apply_annot(s[1], meta);

  const env = new Env(), trace = [], utterances = [];
  try {
    try {
      exec_stmts(prog, env, trace, utterances);
    } catch (e) {
      if (e instanceof ReturnSignal) utterances.push(e.value);
      else throw e;
    }
  } catch (e) {
    out('·· the weave broke: ' + e.message);
    return { ok: false, lines };
  }

  out('·· NXP4 // THE SOURCE // FORGED // NOT STOLEN FROM HEAVEN');
  if (meta.sigil.length) out('·· sigil ::= ' + meta.sigil.join(' / '));
  if (meta.intent) out('·· intent ::= «' + meta.intent + '»');
  for (const u of utterances) out('·· ' + fmt(u));

  if (!meta.boot) {
    out('·· no BOOT directive — the source idles.');
    return { ok: true, lines };
  }
  const f = env.lookup(meta.boot);
  if (!(f instanceof Func)) {
    const avail = Object.keys(env.vars).filter((k) => env.vars[k] instanceof Func).sort();
    out('·· BOOT target «' + meta.boot + '» not found in the weave.');
    out('·· weaves that answer: ' + (avail.length ? avail.join(', ') : 'none'));
    return { ok: false, lines };
  }
  let payload = env.lookup('HEAVEN');
  if (payload === null) payload = new Weave();
  out('⟠ BOOT ' + f.name + ' — payload <= ' + label(payload));
  let result;
  try {
    result = call_func(f, payload, trace);
  } catch (e) {
    out('·· the weave broke: ' + e.message);
    return { ok: false, lines };
  }
  for (const line of trace) out('  ' + line);
  out('·· BOOT COMPLETE — ' + fmt(result));
  return { ok: true, lines };
}

// Exports: browser global + Node module.
var NXP4 = { run: runNXP4 };
if (typeof window !== 'undefined') window.NXP4 = NXP4;
if (typeof module !== 'undefined' && module.exports) module.exports = NXP4;
