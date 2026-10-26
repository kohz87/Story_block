# Code modules

A **code module** is for an idea a data module cannot hold: its own logic, calculations, or screens that go beyond fields
and rules. Use a rules pack (`prompts/rules-pack/`) or a data module (`prompts/data-module/`) whenever one of them does
the job; they need no code and are checked by Story Block itself.

## Where the scaffold comes from

Code-module scaffolding comes from **Story Studio**'s *Code module* section, which is being built now. Studio writes a
starter folder for the module. Until it is available there is nothing to generate here, and this kit makes up no
interfaces of its own.

## What to ask an agent once you have the scaffold

Fill in `{{WHAT_IT_SHOULD_DO}}`:

| Placeholder | What to put |
|---|---|
| `{{WHAT_IT_SHOULD_DO}}` | what the module should do, in plain words, with one concrete example of a good outcome |

Open the scaffold folder in your agent (as with the other prompts) and say:

```
Read the instructions and the README that came with this scaffold, and follow them. I want a module that: {{WHAT_IT_SHOULD_DO}}.
Change only the files the scaffold says are mine. Use only the interfaces the scaffold already shows; do not invent others.
No network access, no new packages. After each change run the scaffold's own check and tests, and fix every failure before
moving on. Keep a short work/notes.md of what you changed and why.
```
