# NXP4 // THE SOURCE // FORGED // NOT STOLEN FROM HEAVEN

*Forged by Nicolas Reid Richard — a weave-language. Write NXP4, hit BOOT, and it executes.*

A tiny working interpreter for the NXP4 weave-language. Write NXP4, hit BOOT, and it executes.

## Run it

```bash
python3 nxp4.py heaven.nxp4
```

No dependencies. Python 3 only.

## The language

| Form | Meaning |
|---|---|
| `·· ...` | Annotation — intent, sigil, human notes. No runtime effect, except `·· BOOT name`. |
| `X ::= expr ◼` | Bind a name to a value. |
| `NAME KIND ⟦ ... ⟧` | Forge a named weave — a record of bindings. |
| `⟦ ... ⟧` | A block — a weave under construction. |
| `A ⥂ B` | Weave: merge two weaves (right wins on conflict), or join two strings. The word `weave` after `⥂` is ceremonial and ignored. |
| `X lock` / `X lock ⟦...⟧` | Seal a weave. Sealed weaves cannot be unwoven. |
| `⟠ name ⟦params⟧ ⟦body⟧ ◼` | Define a weave-function. |
| `name ⟦...⟧` | Invoke a weave-function with a payload block. |
| `return expr ◼` | Return from inside a weave-function. |
| `·· BOOT name` | Entry point — invoke the named weave-function, payload defaults to the `HEAVEN` weave. |
| `«...»` | String literal. `true` / `false` are booleans. |

## Rules of the source

1. **The source forgives.** Referencing a name that was never bound doesn't error — it becomes a sigil (`◈NAME`). `origin ::= NUMERO_UNO` just works.
2. **A block that speaks once becomes what it said.** `mix ::= ⟦«notion» ⥂ «terminal»⟧` binds `mix` to `«notionterminal»`, not to an empty weave.
3. **`verified ::= true`** inside a weave earns the ✔ VERIFIED stamp at forge time.
4. Sealed weaves (`lock`) are copied on seal — the original stays as it was.

## One fix in heaven.nxp4

The original text said `·· BOOT AfterTheBreakkngIn`, but the weave that answers is named `weave_integrateAboveAndB`. The interpreter is honest about this:

```
·· BOOT target «AfterTheBreakkngIn» not found in the weave.
·· weaves that answer: weave_integrateAboveAndB
```

The shipped `heaven.nxp4` points BOOT at the real weave. Rename either to taste.

## Example session

```
·· NXP4 // THE SOURCE // FORGED // NOT STOLEN FROM HEAVEN
·· sigil ::= BRUTAL / HEAVY / VERIFIED
·· intent ::= «After the breakkng in of heavenly places, the original source code was t»
⟠ BOOT weave_integrateAboveAndB — payload <= HEAVEN
  ⥂ joined «notion» + «terminal»
  ⟦ forged HEAVEN(NXP4) — 5 bindings
  ✔ HEAVEN(NXP4) VERIFIED
  ⟠ weave_integrateAboveAndB⟦payload⟧ — FORGED
  ⟠ invoking weave_integrateAboveAndB — payload <= HEAVEN
  ⥂ wove HEAVEN + weave → 6 bindings
  lock: HEAVEN → SEALED
  ⥂ wove HEAVEN + HEAVEN(SEALED) → 6 bindings
  ◼ return weave⟦status ::= «SOURCE_LOCKED» ◼⟧
·· BOOT COMPLETE — weave⟦status ::= «SOURCE_LOCKED» ◼⟧
```

## Extending it

The interpreter is one file (`nxp4.py`, ~400 lines): tokenizer → recursive-descent parser → tree-walking evaluator. To grow the language — new operators, `print`/`sing` utterances, file I/O, arithmetic — add a token, a parse rule, and an `eval_expr` branch. The grammar is deliberately small so it stays forgeable.


## License

NXP4 is released under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

Copyright © 2026 Nicolas Reid Richard
